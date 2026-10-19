import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ChatRequestSchema, EventRequestSchema, ModerationRequestSchema, PlayerActionSchema, SpawnRequestSchema } from '@crusaders/shared';
import { HttpError, json, readJson } from '../http/api.ts';
import type { AccountRecord } from '../persistence/accounts.ts';
import { AdminError, type AdminService } from './admin_service.ts';

const IdSchema = z.object({ id: z.uuid() });

async function body<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, 'invalid_request', issue ? `${issue.path.join('.') || 'request'}: ${issue.message}` : 'invalid request');
  }
  return parsed.data;
}

/**
 * Admin panel routes (admin accounts only; api.ts checks the session first):
 *   GET  /api/admin/me | overview | players | chat | stream (server-sent chat) | accounts?q= | events | catalog | spawns | log
 *   POST /api/admin/chat {mode, text, zone?, to?}            POST /api/admin/moderate {action, target, minutes?, reason?}
 *   POST /api/admin/player {action, target, amount?, ...}     POST /api/admin/events {name, rates, startsAt?, minutes, announce}
 *   POST /api/admin/events/cancel {id}                        POST /api/admin/rates/reset
 *   POST /api/admin/spawns {zone, archetype, at, ...}         POST /api/admin/spawns/remove {id}
 */
export function createAdminApi(admin: AdminService) {
  return async (req: IncomingMessage, res: ServerResponse, path: string, url: URL, account: AccountRecord): Promise<boolean> => {
    const who = account.username;
    try {
      switch (`${req.method} ${path}`) {
        case 'GET /api/admin/me':
          json(res, 200, { username: who });
          return true;
        case 'GET /api/admin/overview':
          json(res, 200, admin.overview());
          return true;
        case 'GET /api/admin/players':
          json(res, 200, { players: await admin.players() });
          return true;
        case 'GET /api/admin/chat':
          json(res, 200, { lines: admin.chatHistory(Number(url.searchParams.get('after') ?? 0) || 0) });
          return true;
        case 'GET /api/admin/stream':
          admin.stream(res);
          return true;
        case 'POST /api/admin/chat': {
          const d = await body(req, ChatRequestSchema);
          await admin.say(who, d.mode, d.text, d.zone, d.to);
          json(res, 200, { ok: true });
          return true;
        }
        case 'POST /api/admin/moderate':
          json(res, 200, { message: await admin.moderate(account, await body(req, ModerationRequestSchema)) });
          return true;
        case 'GET /api/admin/accounts':
          json(res, 200, { accounts: await admin.accounts(url.searchParams.get('q') ?? '') });
          return true;
        case 'POST /api/admin/player':
          json(res, 200, { message: await admin.player(who, await body(req, PlayerActionSchema)) });
          return true;
        case 'GET /api/admin/events':
          json(res, 200, { events: await admin.listEvents(), rates: admin.overview().rates });
          return true;
        case 'POST /api/admin/events':
          json(res, 201, { event: await admin.createEvent(who, await body(req, EventRequestSchema)) });
          return true;
        case 'POST /api/admin/events/cancel':
          await admin.cancelEvent(who, (await body(req, IdSchema)).id);
          json(res, 200, { ok: true });
          return true;
        case 'POST /api/admin/rates/reset':
          await admin.resetRates(who);
          json(res, 200, { ok: true });
          return true;
        case 'GET /api/admin/catalog':
          json(res, 200, admin.catalog());
          return true;
        case 'GET /api/admin/spawns':
          json(res, 200, { spawns: await admin.listSpawns() });
          return true;
        case 'POST /api/admin/spawns':
          json(res, 201, { spawn: await admin.spawn(who, await body(req, SpawnRequestSchema)) });
          return true;
        case 'POST /api/admin/spawns/remove':
          await admin.despawn(who, (await body(req, IdSchema)).id);
          json(res, 200, { ok: true });
          return true;
        case 'GET /api/admin/log':
          json(res, 200, { actions: await admin.auditLog() });
          return true;
        default:
          return false;
      }
    } catch (err) {
      if (err instanceof AdminError) throw new HttpError(400, 'refused', err.message);
      throw err;
    }
  };
}
