/**
 * pnpm admin <grant|revoke> <username> — gives or takes the admin panel (client /admin.html) on
 * DATABASE_URL. A server holding a PGlite directory must be stopped first, with `pnpm stop:server`
 * (never Stop-Process: a hard kill loses unsaved progress); ADMIN_USERS does it at start instead.
 */
import { REPO_ROOT, loadConfig } from '../config.ts';
import { isProcessAlive, readControlFile } from '../control.ts';
import { AccountRepository } from '../persistence/accounts.ts';
import { migrateToLatest, openDatabase } from '../persistence/db.ts';

const [action, username] = process.argv.slice(2);
if ((action !== 'grant' && action !== 'revoke') || !username) {
  console.error('usage: pnpm admin <grant|revoke> <username>');
  process.exit(2);
}
const config = loadConfig();
const running = readControlFile();
if (config.databaseUrl.startsWith('pglite:') && running && running.databaseUrl === config.databaseUrl && isProcessAlive(running.pid)) {
  console.error(`[admin] a server (pid ${running.pid}) holds ${config.databaseUrl}; stop it first with \`pnpm stop:server\` (it saves characters), then run this again`);
  process.exit(1);
}
const database = await openDatabase(config.databaseUrl, REPO_ROOT);
try {
  await migrateToLatest(database.db);
  const ok = await new AccountRepository(database.db).setAdmin(username, action === 'grant');
  console.log(ok ? `[admin] ${username}: ${action === 'grant' ? 'administrator' : 'no longer an administrator'}` : `[admin] no account named ${username}`);
  if (!ok) process.exitCode = 1;
} finally {
  await database.close();
}
