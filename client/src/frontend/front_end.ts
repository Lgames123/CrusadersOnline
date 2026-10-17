import { CHARACTER_NAME_RE, LEVEL_PREFIX, type CharacterDetails, type RealmInfo, type CharacterLook } from '@crusaders/shared';
import { outfitFor } from '../assets/item_models.ts';
import type { MusicPlayer } from '../audio/music.ts';
import type { GameFilesPanel } from '../ui/game_files_panel.ts';
import * as api from './api.ts';
import type { TitleScene } from './title_scene.ts';

/** How the player chose to enter the game. */
export type FrontEndChoice = { kind: 'account'; username: string; characterId: string; look?: CharacterLook } | { kind: 'guest' } | { kind: 'offline' };

export interface FrontEndContext {
  title: TitleScene;
  music: MusicPlayer;
  gameFiles: GameFilesPanel;
  /** Opens the options dialog (settings, controls); `onClose` runs when it is closed. */
  openOptions(onClose: () => void): void;
}

const ACCOUNT_KEY = 'co-account-name';
const REALM_KEY = 'co-realm';
/** Set by "Change character" in the game's options: the next start goes to the character screen. */
export const CHARACTER_SCREEN_FLAG = 'co-screen';

/**
 * Regions by act prefix, as the game's own strings name them (quest givers "at Citadel", "of
 * Duskwood", "in the Glaciers", "of Cador Sul", "Map Catacombs"). Other acts show their code.
 */
const REGIONS: Record<string, string> = { ci: 'Citadel', ca: 'Catacombs', du: 'Duskwood', gl: 'Glaciers', cs: 'Cador Sul' };

export function locationName(zone: string): string {
  if (!zone.startsWith(LEVEL_PREFIX)) return 'Test arena';
  const act = zone.slice(LEVEL_PREFIX.length);
  const region = REGIONS[act.slice(0, 2).toLowerCase()];
  const code = act.charAt(0).toUpperCase() + act.slice(1);
  return region ? `${region}` : code;
}

export function playTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function lastPlayed(iso: string | null, now = Date.now()): string {
  if (!iso) return 'Never';
  const s = (now - Date.parse(iso)) / 1000;
  if (s < 90) return 'Just now';
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'} ago`;
  if (s < 3600) return unit(Math.round(s / 60), 'minute');
  if (s < 86400) return unit(Math.round(s / 3600), 'hour');
  if (s < 86400 * 30) return unit(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString();
}

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Not remembered; still works.
    }
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Builds an element from markup. */
function html<T extends HTMLElement = HTMLElement>(markup: string): T {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild as T;
}

/**
 * The Citadel hall's track (CD track 14) is near-silent for its first ~3.4 s; the title screen
 * starts past that so the music is heard as soon as it loads.
 */
const TITLE_MUSIC_START = 3.5;

/**
 * Login, server selection and character selection over the title scene. Resolves when the
 * player enters the world (or plays offline / as a guest); the screens are removed then.
 */
export async function runFrontEnd(ctx: FrontEndContext): Promise<FrontEndChoice> {
  const root = html(`<div id="frontend"><div class="fe-shade"></div></div>`);
  document.body.appendChild(root);
  const shade = root.querySelector<HTMLElement>('.fe-shade')!;
  let screen: HTMLElement | null = null;
  let finish!: (c: FrontEndChoice) => void;
  const done = new Promise<FrontEndChoice>((r) => (finish = r));
  /** Per-screen key handler (Enter / Escape / arrows); dialogs take the keys while open. */
  let keys: ((e: KeyboardEvent) => void) | null = null;
  let dialogOpen = false;
  let activeAccount: string | null = null;

  // Browsers only start audio after a gesture: the first click or key brings the music in.
  const unlock = () => {
    ctx.music.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  void ctx.music.play(ctx.title.music, TITLE_MUSIC_START);
  const onKey = (e: KeyboardEvent) => {
    if (!dialogOpen) keys?.(e);
  };
  window.addEventListener('keydown', onKey);
  ctx.gameFiles.visible = !ctx.title.original;
  ctx.title.start();

  const show = (el: HTMLElement, mode: 'title' | 'character') => {
    screen?.remove();
    screen = el;
    keys = null;
    shade.dataset['mode'] = mode;
    ctx.title.setShot(mode);
    root.appendChild(el);
  };

  /** Bottom-right utility buttons shared by the screens. */
  const utilityMenu = (extra: string) => {
    const menu = html(`<nav class="fe-menu" aria-label="Options">
        ${extra}
        <button type="button" class="fe-link" data-act="options">Options</button>
        <button type="button" class="fe-link" data-act="files">Game files</button>
      </nav>`);
    menu.querySelector('[data-act="options"]')!.addEventListener('click', () => {
      dialogOpen = true;
      ctx.openOptions(() => (dialogOpen = false));
    });
    menu.querySelector('[data-act="files"]')!.addEventListener('click', () => {
      const panel = document.getElementById('game-files')!;
      ctx.gameFiles.visible = !!panel.hidden;
    });
    return menu;
  };

  /** A modal dialog over the current screen; resolves with the button pressed (null: cancelled). */
  const dialog = (markup: string, setup: (el: HTMLElement, close: (v: string | null) => void) => void): Promise<string | null> =>
    new Promise((resolve) => {
      dialogOpen = true;
      const back = html(`<div class="fe-dialog-back"><div class="fe-dialog" role="dialog" aria-modal="true">${markup}</div></div>`);
      const close = (v: string | null) => {
        back.remove();
        window.removeEventListener('keydown', escKey, true);
        dialogOpen = false;
        resolve(v);
      };
      const escKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(null);
        }
      };
      window.addEventListener('keydown', escKey, true);
      back.addEventListener('pointerdown', (e) => {
        if (e.target === back) close(null);
      });
      for (const b of back.querySelectorAll<HTMLButtonElement>('button[data-cancel]')) b.addEventListener('click', () => close(null));
      root.appendChild(back);
      setup(back.querySelector('.fe-dialog')!, close);
    });

  // ---- Login ----------------------------------------------------------------------------------
  const loginScreen = (serverDown: boolean, notice = '') => {
    const remembered = store.get(ACCOUNT_KEY) ?? activeAccount ?? '';
    const el = html(`<div class="fe-screen fe-login-screen">
      <header class="fe-logo"><div class="fe-logo-main">Crusaders</div><div class="fe-logo-sub">Online</div></header>
      <form class="fe-login" autocomplete="on" novalidate>
        <label class="fe-field"><span>Account name</span>
          <input name="username" autocomplete="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" value="${esc(remembered)}" spellcheck="false" />
        </label>
        <label class="fe-field"><span>Password</span>
          <input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" />
        </label>
        <label class="fe-check"><input type="checkbox" name="remember"${remembered ? ' checked' : ''} /> Remember account name</label>
        <button type="submit" class="fe-primary" data-act="submit">Log in</button>
        <button type="button" class="fe-link fe-switch" data-act="switch">Create a new account</button>
        <div class="fe-error" role="alert"></div>
      </form>
      <div class="fe-status"><span class="fe-dot"></span><span class="fe-status-text">Connecting…</span></div>
      <p class="fe-footer">A fan project. Requires your own copy of <i>Crusaders of Might and Magic</i>.</p>
    </div>`);
    const menu = utilityMenu(`<button type="button" class="fe-link" data-act="offline">Play offline</button>
      ${import.meta.env.PROD ? '' : '<button type="button" class="fe-link" data-act="guest">Play as guest <small>dev</small></button>'}`);
    el.appendChild(menu);
    menu.querySelector('[data-act="offline"]')!.addEventListener('click', () => finish({ kind: 'offline' }));
    menu.querySelector('[data-act="guest"]')?.addEventListener('click', () => finish({ kind: 'guest' }));

    const form = el.querySelector('form')!;
    const user = form.elements.namedItem('username') as HTMLInputElement;
    const pass = form.elements.namedItem('password') as HTMLInputElement;
    const remember = form.elements.namedItem('remember') as HTMLInputElement;
    const submit = form.querySelector<HTMLButtonElement>('[data-act="submit"]')!;
    const switcher = form.querySelector<HTMLButtonElement>('[data-act="switch"]')!;
    const error = form.querySelector<HTMLElement>('.fe-error')!;
    let creating = false;

    const updatePassRequirement = () => {
      const isCurrent = !creating && !!activeAccount && user.value.trim().toLowerCase() === activeAccount.toLowerCase();
      pass.required = !isCurrent;
      if (isCurrent && !pass.value) {
        pass.placeholder = 'Session active — click Log in to enter';
      } else if (!creating) {
        pass.placeholder = '';
      }
    };
    user.addEventListener('input', updatePassRequirement);
    updatePassRequirement();

    switcher.addEventListener('click', () => {
      creating = !creating;
      submit.textContent = creating ? 'Create account' : 'Log in';
      switcher.textContent = creating ? 'I already have an account' : 'Create a new account';
      pass.autocomplete = creating ? 'new-password' : 'current-password';
      pass.placeholder = creating ? 'At least 8 characters' : '';
      error.textContent = '';
      updatePassRequirement();
    });
    error.textContent = notice;
    const status = el.querySelector<HTMLElement>('.fe-status')!;
    const setStatus = (players: number | null) => {
      status.dataset['up'] = players === null ? 'false' : 'true';
      status.querySelector('.fe-status-text')!.textContent =
        players === null ? 'Server unreachable — you can still play offline' : `Server online · ${players} ${players === 1 ? 'player' : 'players'} in the world`;
      form.querySelectorAll<HTMLElement>('input, button').forEach((b) => ((b as HTMLButtonElement).disabled = players === null));
    };
    if (serverDown) setStatus(null);
    void api.serverStatus().then((s) => setStatus(s?.players ?? null));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const typedUser = user.value.trim();
      if (!creating && activeAccount && typedUser.toLowerCase() === activeAccount.toLowerCase() && !pass.value) {
        store.set(ACCOUNT_KEY, remember.checked ? activeAccount : null);
        await realmScreen(activeAccount);
        return;
      }
      if (!form.reportValidity()) return;
      error.textContent = '';
      submit.disabled = switcher.disabled = true;
      try {
        const name = await api.login(typedUser, pass.value, creating);
        pass.value = '';
        store.set(ACCOUNT_KEY, remember.checked ? name : null);
        activeAccount = name;
        await realmScreen(name);
      } catch (err) {
        error.textContent = (err as Error).message;
        submit.disabled = switcher.disabled = false;
      }
    });
    show(el, 'title');
    (remembered ? (pass.required ? pass : submit) : user).focus();
  };

  // ---- Server selection -----------------------------------------------------------------------
  const realmScreen = async (username: string) => {
    const el = html(`<div class="fe-screen fe-realm-screen">
      <section class="fe-panel fe-realms" aria-labelledby="fe-realms-title">
        <h2 id="fe-realms-title">Select a server</h2>
        <table>
          <thead><tr><th>Server</th><th>Type</th><th>Characters</th><th>Population</th><th>Latency</th></tr></thead>
          <tbody><tr><td colspan="5" class="fe-muted">Loading…</td></tr></tbody>
        </table>
        <div class="fe-error" role="alert"></div>
        <div class="fe-actions">
          <button type="button" class="fe-secondary" data-act="back">Log out</button>
          <button type="button" class="fe-primary" data-act="enter" disabled>Enter server</button>
        </div>
      </section>
      <div class="fe-account">Logged in as <b>${esc(username)}</b></div>
    </div>`);
    el.appendChild(utilityMenu(''));
    const body = el.querySelector('tbody')!;
    const enter = el.querySelector<HTMLButtonElement>('[data-act="enter"]')!;
    const error = el.querySelector<HTMLElement>('.fe-error')!;
    let list: RealmInfo[] = [];
    let chosen: RealmInfo | null = null;
    const back = async () => {
      await api.logout();
      activeAccount = null;
      loginScreen(false);
    };
    const go = () => {
      if (!chosen) return;
      store.set(REALM_KEY, chosen.id);
      void characterScreen(username, chosen);
    };
    el.querySelector('[data-act="back"]')!.addEventListener('click', () => void back());
    enter.addEventListener('click', go);
    const select = (r: RealmInfo) => {
      chosen = r;
      enter.disabled = false;
      body.querySelectorAll('tr').forEach((tr) => tr.setAttribute('aria-selected', String(tr.dataset['id'] === r.id)));
    };
    show(el, 'title');
    keys = (e) => {
      if (e.key === 'Enter') go();
      else if (e.key === 'Escape') void back();
    };
    try {
      const started = performance.now();
      list = (await api.realms()).realms;
      const ping = Math.round(performance.now() - started);
      body.innerHTML = '';
      for (const r of list) {
        const tr = html<HTMLTableRowElement>(`<tr data-id="${esc(r.id)}" tabindex="0" aria-selected="false">
          <td class="fe-realm-name">${esc(r.name)}</td><td>${esc(r.type)}</td><td>${r.characters}</td>
          <td class="fe-pop" data-pop="${r.population}">${r.population.charAt(0).toUpperCase()}${r.population.slice(1)}</td><td>${ping} ms</td></tr>`);
        tr.addEventListener('click', () => select(r));
        tr.addEventListener('dblclick', () => (select(r), go()));
        body.appendChild(tr);
      }
      const remembered = list.find((r) => r.id === store.get(REALM_KEY)) ?? list[0];
      if (remembered) select(remembered);
      enter.focus();
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 401) return loginScreen(false, err.message);
      body.innerHTML = '';
      error.textContent = (err as Error).message;
    }
  };

  // ---- Character selection --------------------------------------------------------------------
  const characterScreen = async (username: string, realm: RealmInfo | null) => {
    const el = html(`<div class="fe-screen fe-char-screen">
      <div class="fe-realm-tag">${realm ? esc(realm.name) : ''} <button type="button" class="fe-link" data-act="realms">Change server</button></div>
      <aside class="fe-panel fe-roster" aria-label="Characters">
        <h2>Characters <span class="fe-count"></span></h2>
        <ul role="listbox" aria-label="Your characters"></ul>
      </aside>
      <section class="fe-charinfo" aria-live="polite">
        <div class="fe-charname"></div>
        <div class="fe-charline"></div>
        <dl class="fe-charmeta"></dl>
        <button type="button" class="fe-primary fe-enter" data-act="enter" disabled>Enter World</button>
        <div class="fe-error" role="alert"></div>
      </section>
      <div class="fe-drag-hint">Drag to turn</div>
      <nav class="fe-left-menu">
        <button type="button" class="fe-link" data-act="logout">Log out</button>
      </nav>
    </div>`);
    el.appendChild(utilityMenu('<button type="button" class="fe-link fe-danger" data-act="delete" disabled>Delete character</button>'));
    const listEl = el.querySelector('ul')!;
    const count = el.querySelector<HTMLElement>('.fe-count')!;
    const nameEl = el.querySelector<HTMLElement>('.fe-charname')!;
    const lineEl = el.querySelector<HTMLElement>('.fe-charline')!;
    const metaEl = el.querySelector<HTMLElement>('.fe-charmeta')!;
    const enter = el.querySelector<HTMLButtonElement>('[data-act="enter"]')!;
    const del = el.querySelector<HTMLButtonElement>('[data-act="delete"]')!;
    const error = el.querySelector<HTMLElement>('.fe-error')!;
    let chars: CharacterDetails[] = [];
    let max = 3;
    let chosen: CharacterDetails | null = null;
    /** Latest preview request (a newer selection wins over a slower model load). */
    let previewToken = 0;

    const choose = (c: CharacterDetails | null) => {
      chosen = c;
      enter.disabled = del.disabled = !c;
      listEl.querySelectorAll<HTMLElement>('li[data-id]').forEach((li) => li.setAttribute('aria-selected', String(li.dataset['id'] === c?.id)));
      nameEl.textContent = c?.name ?? '';
      lineEl.textContent = c ? `Level ${c.level} · ${locationName(c.zone)}` : chars.length < max ? 'Create a character to begin.' : '';
      metaEl.innerHTML = c
        ? `<div><dt>Played</dt><dd>${playTime(c.playSeconds)}</dd></div><div><dt>Last played</dt><dd>${lastPlayed(c.lastPlayedAt)}</dd></div><div><dt>Gold</dt><dd>${c.gold.toLocaleString()}</dd></div>`
        : '';
      const token = ++previewToken;
      if (!c) {
        ctx.title.setPreview(null);
        return;
      }
      ctx.title.previewYaw = 0;
      void outfitFor(c.look)
        .then((outfit) => ctx.title.drake(outfit))
        .then((avatar) => {
          if (token === previewToken) ctx.title.setPreview(avatar);
          else avatar.dispose();
        });
    };

    const render = () => {
      count.textContent = `${chars.length} / ${max}`;
      listEl.innerHTML = '';
      for (const c of chars) {
        const li = html(`<li data-id="${esc(c.id)}" role="option" tabindex="0" aria-selected="false">
          <span class="fe-slot-name">${esc(c.name)}</span>
          <span class="fe-slot-line">Level ${c.level} · ${esc(locationName(c.zone))}</span></li>`);
        li.addEventListener('click', () => choose(c));
        li.addEventListener('dblclick', () => (choose(c), play()));
        listEl.appendChild(li);
      }
      for (let i = chars.length; i < max; i++) {
        const li = html(`<li class="fe-slot-empty"><button type="button" class="fe-create">+ Create new character</button></li>`);
        li.querySelector('button')!.addEventListener('click', () => void create());
        listEl.appendChild(li);
      }
    };

    const load = async (select?: string) => {
      try {
        const r = await api.characters();
        chars = r.characters;
        max = r.max;
        render();
        // The given one, else the last played (as MMOs open on it).
        const recent = [...chars].sort((a, b) => Date.parse(b.lastPlayedAt ?? b.createdAt) - Date.parse(a.lastPlayedAt ?? a.createdAt))[0];
        choose(chars.find((c) => c.id === select) ?? recent ?? null);
      } catch (err) {
        if (err instanceof api.ApiError && err.status === 401) return loginScreen(false, err.message);
        error.textContent = (err as Error).message;
      }
    };

    const play = () => {
      if (!chosen) return;
      finish({ kind: 'account', username, characterId: chosen.id, look: chosen.look });
    };

    const create = async () => {
      if (chars.length >= max) return;
      let createdId = '';
      const r = await dialog(
        `<h2>New character</h2>
         <p class="fe-muted">Every crusader is Drake, the hero of the original game. Choose the name this one is known by.</p>
         <form novalidate>
           <label class="fe-field"><span>Name</span><input name="name" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" spellcheck="false" autocomplete="off" /></label>
           <p class="fe-hint">3–20 letters, digits or _</p>
           <div class="fe-error" role="alert"></div>
           <div class="fe-actions"><button type="button" class="fe-secondary" data-cancel>Cancel</button><button type="submit" class="fe-primary">Create</button></div>
         </form>`,
        (d, close) => {
          const form = d.querySelector('form')!;
          const input = form.elements.namedItem('name') as HTMLInputElement;
          const err = form.querySelector<HTMLElement>('.fe-error')!;
          const ok = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
          input.focus();
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = input.value.trim();
            if (!CHARACTER_NAME_RE.test(name)) {
              err.textContent = 'Names are 3–20 letters, digits or _.';
              return;
            }
            ok.disabled = true;
            try {
              createdId = (await api.createCharacter(name)).id;
              close('created');
            } catch (e2) {
              err.textContent = (e2 as Error).message;
              ok.disabled = false;
            }
          });
        },
      );
      if (r === 'created') await load(createdId);
    };

    const remove = async () => {
      const c = chosen;
      if (!c) return;
      const r = await dialog(
        `<h2>Delete ${esc(c.name)}?</h2>
         <p class="fe-muted">Level ${c.level} · ${esc(locationName(c.zone))} · played ${playTime(c.playSeconds)}.<br />This cannot be undone. Type the character's name to confirm.</p>
         <form novalidate>
           <label class="fe-field"><span>Name</span><input name="name" spellcheck="false" autocomplete="off" /></label>
           <div class="fe-error" role="alert"></div>
           <div class="fe-actions"><button type="button" class="fe-secondary" data-cancel>Cancel</button><button type="submit" class="fe-primary fe-danger-btn" disabled>Delete</button></div>
         </form>`,
        (d, close) => {
          const form = d.querySelector('form')!;
          const input = form.elements.namedItem('name') as HTMLInputElement;
          const ok = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
          const err = form.querySelector<HTMLElement>('.fe-error')!;
          input.focus();
          input.addEventListener('input', () => (ok.disabled = input.value.trim().toLowerCase() !== c.name.toLowerCase()));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (ok.disabled) return;
            ok.disabled = true;
            try {
              await api.deleteCharacter(c.id, input.value.trim());
              close('deleted');
            } catch (e2) {
              err.textContent = (e2 as Error).message;
              ok.disabled = false;
            }
          });
        },
      );
      if (r === 'deleted') await load();
    };

    enter.addEventListener('click', play);
    del.addEventListener('click', () => void remove());
    el.querySelector('[data-act="realms"]')!.addEventListener('click', () => {
      ctx.title.setPreview(null);
      void realmScreen(username);
    });
    el.querySelector('[data-act="logout"]')!.addEventListener('click', async () => {
      ctx.title.setPreview(null);
      await api.logout();
      loginScreen(false);
    });
    // Drag anywhere off the panels turns Drake.
    let drag: number | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target !== el) return;
      drag = e.clientX;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (drag === null) return;
      ctx.title.previewYaw += (e.clientX - drag) * 0.01;
      drag = e.clientX;
    });
    el.addEventListener('pointerup', () => (drag = null));
    el.addEventListener('pointercancel', () => (drag = null));
    show(el, 'character');
    keys = (e) => {
      if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') play();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = chars.findIndex((c) => c.id === chosen?.id);
        const next = chars[(i + (e.key === 'ArrowDown' ? 1 : chars.length - 1)) % Math.max(1, chars.length)];
        if (next) choose(next);
      } else if (e.key === 'Escape') {
        ctx.title.setPreview(null);
        void realmScreen(username);
      }
    };
    enter.focus();
    await load();
  };

  // ---- Start: always default to the login screen on refresh -------------------------------------
  let serverDown = false;
  try {
    activeAccount = await api.currentAccount();
  } catch {
    serverDown = true;
  }
  let toCharacters = false;
  try {
    toCharacters = sessionStorage.getItem(CHARACTER_SCREEN_FLAG) === 'characters';
    sessionStorage.removeItem(CHARACTER_SCREEN_FLAG);
  } catch {
    // No session storage.
  }
  if (activeAccount && toCharacters) {
    const realm = await api.realms().then((r) => r.realms.find((x) => x.id === store.get(REALM_KEY)) ?? r.realms[0] ?? null).catch(() => null);
    void characterScreen(activeAccount, realm);
  } else {
    loginScreen(serverDown);
  }

  const choice = await done;
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
  root.remove();
  ctx.gameFiles.visible = false;
  return choice;
}
