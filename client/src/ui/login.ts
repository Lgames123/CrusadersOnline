/** Login / registration panel. Resolves with how the player chose to enter the game. */
export type AuthChoice = { kind: 'account'; username: string } | { kind: 'guest' } | { kind: 'offline' };

interface ApiError {
  error: string;
  message?: string;
}

const MESSAGES: Record<string, string> = {
  invalid_login: 'Wrong username or password.',
  username_taken: 'That username is already taken.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  invalid_credentials_format: 'Username: 3–20 letters, digits or _. Password: at least 8 characters.',
};

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
}

/** Returns the logged-in username from the session cookie, or null. Throws if the server is unreachable. */
async function currentAccount(): Promise<string | null> {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`server unavailable (HTTP ${res.status})`);
  return ((await res.json()) as { username: string }).username;
}

export async function logout(): Promise<void> {
  await post('/api/auth/logout').catch(() => {});
}

export async function chooseAuth(): Promise<AuthChoice> {
  let serverDown = false;
  try {
    const username = await currentAccount();
    if (username) return { kind: 'account', username };
  } catch {
    serverDown = true;
  }

  const panel = document.getElementById('login')!;
  const form = document.getElementById('login-form') as HTMLFormElement;
  const user = document.getElementById('login-username') as HTMLInputElement;
  const pass = document.getElementById('login-password') as HTMLInputElement;
  const errorEl = document.getElementById('login-error')!;
  const buttons = ['btn-login', 'btn-register', 'btn-guest'].map((id) => document.getElementById(id) as HTMLButtonElement);
  panel.classList.remove('hidden');
  if (import.meta.env.PROD) document.getElementById('btn-guest')!.hidden = true; // dev-only endpoint
  if (serverDown) {
    errorEl.textContent = 'Game server is not reachable. You can still play offline.';
    for (const b of buttons) b.disabled = true;
  } else {
    user.focus();
  }

  return new Promise<AuthChoice>((resolve) => {
    const done = (choice: AuthChoice) => {
      panel.classList.add('hidden');
      resolve(choice);
    };

    const submit = async (path: '/api/auth/login' | '/api/auth/register') => {
      if (!form.reportValidity()) return;
      errorEl.textContent = '';
      for (const b of buttons) b.disabled = true;
      try {
        const res = await post(path, { username: user.value.trim(), password: pass.value });
        if (res.ok) {
          const { username } = (await res.json()) as { username: string };
          pass.value = '';
          return done({ kind: 'account', username });
        }
        const err = (await res.json().catch(() => ({ error: 'unknown' }))) as ApiError;
        errorEl.textContent = MESSAGES[err.error] ?? err.message ?? `Request failed (${res.status}).`;
      } catch {
        errorEl.textContent = 'Game server is not reachable.';
      } finally {
        for (const b of buttons) b.disabled = false;
      }
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit('/api/auth/login');
    });
    document.getElementById('btn-register')!.addEventListener('click', () => void submit('/api/auth/register'));
    document.getElementById('btn-guest')!.addEventListener('click', () => done({ kind: 'guest' }));
    document.getElementById('btn-offline')!.addEventListener('click', () => done({ kind: 'offline' }));
  });
}
