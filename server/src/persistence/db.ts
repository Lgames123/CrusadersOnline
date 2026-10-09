import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Migrator, type Migration, type MigrationProvider, type MigrationResult } from 'kysely/migration';
import type { DB } from './schema.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

export interface Database {
  db: Kysely<DB>;
  /** "postgres" for a real server, "pglite" for the embedded WASM build. */
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

/**
 * Opens the database named by `url`:
 * - `postgres://...` / `postgresql://...` -> PostgreSQL server via `pg` (production)
 * - `pglite:memory`                       -> in-memory PGlite (tests)
 * - `pglite:<dir>`                        -> PGlite persisted to <dir> (local development)
 */
export async function openDatabase(url: string, baseDir = process.cwd()): Promise<Database> {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    return { db, kind: 'postgres', close: () => db.destroy() };
  }
  if (url.startsWith('pglite:')) {
    const target = url.slice('pglite:'.length);
    const { PGlite } = await import('@electric-sql/pglite');
    const { PGliteDialect } = await import('./pglite_dialect.ts');
    let pg;
    if (target === 'memory') {
      pg = new PGlite();
    } else {
      const dir = path.resolve(baseDir, target);
      await mkdir(dir, { recursive: true });
      pg = new PGlite(dir);
    }
    const db = new Kysely<DB>({ dialect: new PGliteDialect(pg) });
    return { db, kind: 'pglite', close: () => db.destroy() };
  }
  throw new Error(`unsupported DATABASE_URL scheme: ${url.split(':')[0]}`);
}

/** Plain .sql files applied in name order; each runs exactly once (tracked by Kysely). */
class SqlFileMigrationProvider implements MigrationProvider {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async getMigrations(): Promise<Record<string, Migration>> {
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.sql')).sort();
    const out: Record<string, Migration> = {};
    for (const f of files) {
      const text = await readFile(path.join(this.dir, f), 'utf-8');
      out[f] = { up: async (db) => void (await sql.raw(text).execute(db)) };
    }
    return out;
  }
}

export async function migrateToLatest(db: Kysely<DB>): Promise<MigrationResult[]> {
  const migrator = new Migrator({ db, provider: new SqlFileMigrationProvider(MIGRATIONS_DIR) });
  const { error, results } = await migrator.migrateToLatest();
  if (error) throw error;
  return results ?? [];
}
