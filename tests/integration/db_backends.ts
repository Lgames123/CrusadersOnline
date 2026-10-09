import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';

/** A throwaway database for one test group. `url` survives server restarts until dispose(). */
export interface TestDatabase {
  url: string;
  dispose(): Promise<void>;
}

export interface Backend {
  name: string;
  create(): Promise<TestDatabase>;
}

const pglite: Backend = {
  name: 'pglite',
  async create() {
    const dir = await mkdtemp(path.join(tmpdir(), 'crusaders-pglite-'));
    return { url: `pglite:${dir}`, dispose: () => rm(dir, { recursive: true, force: true }) };
  },
};

/**
 * Real PostgreSQL, enabled by TEST_POSTGRES_URL (an account allowed to CREATE DATABASE), e.g.
 * postgresql://crusaders:crusaders_dev@127.0.0.1:5432/crusaders_online (deployment/docker-compose.dev.yml).
 * Each group gets its own database, dropped afterwards.
 */
function postgres(adminUrl: string): Backend {
  return {
    name: 'postgres',
    async create() {
      const name = `co_test_${randomBytes(6).toString('hex')}`;
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${name}`);
      await admin.end();
      const url = new URL(adminUrl);
      url.pathname = `/${name}`;
      return {
        url: url.toString(),
        async dispose() {
          const c = new pg.Client({ connectionString: adminUrl });
          await c.connect();
          await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
          await c.end();
        },
      };
    },
  };
}

const pgUrl = process.env['TEST_POSTGRES_URL'];
export const backends: Backend[] = [pglite, ...(pgUrl ? [postgres(pgUrl)] : [])];
