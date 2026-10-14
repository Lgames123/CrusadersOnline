import type { CharacterListResponse, RealmListResponse } from '@crusaders/shared';

/** The game server's HTTP API (server/src/http/api.ts), same origin, session cookie. */

const MESSAGES: Record<string, string> = {
  invalid_login: 'Wrong account name or password.',
  username_taken: 'That account name is already taken.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  invalid_credentials_format: 'Account name: 3–20 letters, digits or _. Password: at least 8 characters.',
  invalid_name: 'Names are 3–20 letters, digits or _.',
  name_taken: 'That name is already taken.',
  character_limit: 'This account already has the most characters it can have.',
  name_mismatch: 'The name typed does not match the character.',
  character_online: 'That character is in the world right now.',
  character_not_found: 'That character no longer exists.',
  not_authenticated: 'Your session has ended. Log in again.',
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'unreachable', 'The game server is not reachable.');
  }
  if (res.ok) return (await res.json()) as T;
  const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  const code = err.error ?? 'unknown';
  throw new ApiError(res.status, code, MESSAGES[code] ?? err.message ?? `Request failed (${res.status}).`);
}

/** The logged-in account name from the session cookie, or null. Throws ApiError if the server is unreachable. */
export async function currentAccount(): Promise<string | null> {
  try {
    return (await request<{ username: string }>('GET', '/api/auth/me')).username;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function login(username: string, password: string, create: boolean): Promise<string> {
  return (await request<{ username: string }>('POST', create ? '/api/auth/register' : '/api/auth/login', { username, password })).username;
}

export async function logout(): Promise<void> {
  await request('POST', '/api/auth/logout').catch(() => {});
}

export const realms = () => request<RealmListResponse>('GET', '/api/realms');
export const characters = () => request<CharacterListResponse>('GET', '/api/characters');
export const createCharacter = (name: string) => request<{ id: string }>('POST', '/api/characters', { name });
export const deleteCharacter = (id: string, name: string) => request<{ ok: true }>('DELETE', `/api/characters/${encodeURIComponent(id)}`, { name });

/** Server status for the login screen: players online, or null when it cannot be reached. */
export async function serverStatus(): Promise<{ players: number } | null> {
  try {
    const res = await fetch('/healthz', { cache: 'no-store' });
    if (!res.ok) return null;
    return { players: Number(((await res.json()) as { players?: number }).players ?? 0) };
  } catch {
    return null;
  }
}
