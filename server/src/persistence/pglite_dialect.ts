import type { PGlite } from '@electric-sql/pglite';
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryCompiler,
  type QueryResult,
} from 'kysely';

/**
 * Minimal Kysely dialect for PGlite (PostgreSQL compiled to WASM, in-process).
 * PGlite has a single connection, so connections are handed out one at a time; this also
 * serialises transactions. Used for development without a PostgreSQL server and for tests.
 */
export class PGliteDialect implements Dialect {
  private readonly pg: PGlite;

  constructor(pg: PGlite) {
    this.pg = pg;
  }

  createAdapter(): DialectAdapter {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new PGliteDriver(this.pg);
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler(): QueryCompiler {
    return new PostgresQueryCompiler();
  }
}

class PGliteConnection implements DatabaseConnection {
  private readonly pg: PGlite;

  constructor(pg: PGlite) {
    this.pg = pg;
  }

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    if (compiled.parameters.length === 0) {
      // Simple protocol: allows multi-statement SQL (migrations). Result of the last statement.
      const results = await this.pg.exec(compiled.sql);
      const last = results[results.length - 1];
      return {
        rows: (last?.rows ?? []) as R[],
        ...(last?.affectedRows !== undefined ? { numAffectedRows: BigInt(last.affectedRows) } : {}),
      };
    }
    const r = await this.pg.query<R>(compiled.sql, compiled.parameters as unknown[]);
    return {
      rows: r.rows,
      ...(r.affectedRows !== undefined ? { numAffectedRows: BigInt(r.affectedRows) } : {}),
    };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming is not supported by the PGlite dialect');
  }
}

class PGliteDriver implements Driver {
  private readonly pg: PGlite;
  private readonly connection: PGliteConnection;
  private queue: Promise<void> = Promise.resolve();
  private release: (() => void) | null = null;

  constructor(pg: PGlite) {
    this.pg = pg;
    this.connection = new PGliteConnection(pg);
  }

  async init(): Promise<void> {
    await this.pg.waitReady;
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    const previous = this.queue;
    let unlock!: () => void;
    this.queue = new Promise<void>((r) => (unlock = r));
    await previous;
    this.release = unlock;
    return this.connection;
  }

  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw('begin'));
  }

  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw('rollback'));
  }

  async releaseConnection(): Promise<void> {
    const r = this.release;
    this.release = null;
    r?.();
  }

  async destroy(): Promise<void> {
    await this.pg.close();
  }
}
