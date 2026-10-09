/** pnpm db:migrate — applies pending SQL migrations to DATABASE_URL (also done at server startup). */
import { REPO_ROOT, loadConfig } from '../config.ts';
import { migrateToLatest, openDatabase } from '../persistence/db.ts';

const config = loadConfig();
const database = await openDatabase(config.databaseUrl, REPO_ROOT);
try {
  const results = await migrateToLatest(database.db);
  if (results.length === 0) console.log('[migrate] database is up to date');
  for (const r of results) console.log(`[migrate] ${r.migrationName}: ${r.status}`);
} finally {
  await database.close();
}
