import { ClientSession, type ArenaDef, type ClientSessionEvents, type Rapier } from '@crusaders/shared';

/** Covers ticket redemption and loading the first zone's level. */
const CONNECT_TIMEOUT_MS = 60_000;

/**
 * Obtains a single-use WebSocket ticket (account session cookie, or the development guest
 * endpoint) and joins the world. Returns null if the server cannot be reached.
 */
export async function connectToWorld(
  rapier: Rapier,
  arena: ArenaDef,
  mode: 'account' | 'guest',
  /** Account play: the character chosen on the character screen. */
  characterId: string | null,
  events: ClientSessionEvents,
  /** Receives the session as soon as it exists (zone events arrive before connect resolves). */
  onCreate?: (session: ClientSession) => void,
): Promise<ClientSession | null> {
  try {
    const res = await fetch(mode === 'account' ? '/api/ws-ticket' : '/api/dev/guest-ticket', {
      method: 'POST',
      credentials: 'same-origin',
      ...(mode === 'account' && characterId ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ characterId }) } : {}),
    });
    if (!res.ok) throw new Error(`ticket request failed: HTTP ${res.status}`);
    const { ticket } = (await res.json()) as { ticket: string };
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const session = new ClientSession(rapier, arena, events);
    onCreate?.(session);
    await session.connect(`${scheme}://${location.host}/ws`, ticket, CONNECT_TIMEOUT_MS);
    return session;
  } catch (err) {
    console.warn('[net] could not join the world, running offline:', err);
    return null;
  }
}
