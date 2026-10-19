/**
 * The admin panel (admin.html, not original): live chat log and staff lines, moderation, player
 * tools, rate events, custom creature spawns and the audit log. Talks to /api/admin/* with the
 * account's session cookie; the server refuses accounts that are not administrators.
 */
import {
  DEFAULT_EVENT_MINUTES,
  PERMANENT_UNTIL,
  type AdminAccountView,
  type AdminChatLine,
  type AdminEvent,
  type AdminPlayerView,
  type CustomSpawnView,
  type WorldRates,
} from '@crusaders/shared';

// --- Small DOM helpers -------------------------------------------------------------------

type Child = Node | string | number | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

function toast(text: string, error = false): void {
  const box = $('#toast');
  const el = h('div', { class: error ? 'err' : '' }, text);
  box.append(el);
  setTimeout(() => el.remove(), error ? 7000 : 3500);
}

class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Runs an action, shows its message (or its refusal). */
async function act(run: () => Promise<{ message?: string } | unknown>, done?: string): Promise<boolean> {
  try {
    const r = (await run()) as { message?: string } | undefined;
    toast(r && typeof r === 'object' && 'message' in r && r.message ? r.message : done ?? 'Done.');
    return true;
  } catch (err) {
    toast((err as Error).message, true);
    return false;
  }
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dateTime = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const until = (ms: number | null) => (ms === null || ms <= Date.now() ? null : ms >= PERMANENT_UNTIL ? 'permanent' : `until ${dateTime(ms)}`);
const left = (ms: number) => {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60_000));
  return m >= 120 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
const ratesText = (r: WorldRates) =>
  (['xp', 'gold', 'drops', 'respawn'] as const).filter((k) => r[k] !== 1).map((k) => `${k === 'xp' ? 'XP' : k[0]!.toUpperCase() + k.slice(1)} ×${r[k]}`).join(', ') || 'default';
const num = (el: HTMLInputElement) => (el.value.trim() === '' ? undefined : Number(el.value));

// --- Data the sections share -----------------------------------------------------------

interface Catalog {
  creatures: { id: string; name: string; hp: number; xp: number; goldMin: number; goldMax: number; passive: boolean; loot: { itemId: string; chance: number }[] }[];
  items: { id: string; name: string; type: string }[];
  arenas: string[];
  running: string[];
}
interface Overview {
  startedAt: number;
  now: number;
  online: number;
  connections: number;
  rates: WorldRates;
  events: AdminEvent[];
  zones: { name: string; players: number; tick: number; metrics: { p50: number; p99: number; max: number; late: number } | null; spawns: number }[];
  arenas: string[];
}

let catalog: Catalog = { creatures: [], items: [], arenas: [], running: [] };
let players: AdminPlayerView[] = [];
let me = '';

// --- Shell -------------------------------------------------------------------------------

const TABS = ['Dashboard', 'Players', 'Chat', 'Moderation', 'Events', 'Spawns', 'Audit log'] as const;
type TabName = (typeof TABS)[number];
const sections = new Map<TabName, HTMLElement>();
const tabButtons = new Map<TabName, HTMLButtonElement>();
const refreshers = new Map<TabName, () => Promise<void> | void>();
let current: TabName = 'Dashboard';
let unreadChat = 0;

function show(tab: TabName): void {
  current = tab;
  for (const [t, s] of sections) s.hidden = t !== tab;
  for (const [t, b] of tabButtons) b.classList.toggle('on', t === tab);
  if (tab === 'Chat') {
    unreadChat = 0;
    updateChatBadge();
    const log = $('#chat-log');
    log.scrollTop = log.scrollHeight;
  }
  try {
    localStorage.setItem('crusaders.admin.tab', tab);
  } catch {
    /* storage unavailable */
  }
  void refreshers.get(tab)?.();
}

function updateChatBadge(): void {
  const b = tabButtons.get('Chat')!;
  b.replaceChildren('Chat', ...(unreadChat ? [h('span', { class: 'badge' }, unreadChat > 99 ? '99+' : unreadChat)] : []));
}

function shell(): void {
  const nav = h('nav');
  for (const t of TABS) {
    const b = h('button', { onclick: () => show(t) }, t);
    tabButtons.set(t, b);
    nav.append(b);
  }
  const main = h('main');
  $('#app').replaceChildren(
    h('header', {}, h('h1', {}, 'CrusadersOnline · Admin'), nav, h('span', { class: 'who' }, `Signed in as ${me} · `, h('a', { href: '/' }, 'Game'))),
    main,
  );
  const builders: Record<TabName, () => HTMLElement> = {
    Dashboard: dashboard, Players: playersSection, Chat: chatSection, Moderation: moderation, Events: eventsSection, Spawns: spawnsSection, 'Audit log': auditSection,
  };
  for (const t of TABS) {
    const s = builders[t]();
    s.hidden = true;
    sections.set(t, s);
    main.append(s);
  }
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('crusaders.admin.tab');
  } catch {
    /* storage unavailable */
  }
  show(TABS.includes(saved as TabName) ? (saved as TabName) : 'Dashboard');
  // The open section refreshes itself; the chat streams.
  setInterval(() => {
    if (current === 'Dashboard' || current === 'Players' || current === 'Spawns') void refreshers.get(current)?.();
  }, 5000);
}

// --- Dashboard ---------------------------------------------------------------------------

function dashboard(): HTMLElement {
  const stats = h('div', { class: 'stats' });
  const zones = h('tbody');
  const events = h('div');
  const s = h('section', {},
    stats,
    h('div', { class: 'grid' },
      h('div', { class: 'card' }, h('h2', {}, 'Zones'), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Zone'), h('th', { class: 'num' }, 'Players'), h('th', { class: 'num' }, 'Tick p50 / p99 ms'), h('th', { class: 'num' }, 'Late'), h('th', { class: 'num' }, 'Spawns'))), zones))),
      h('div', { class: 'card' }, h('h2', {}, 'Running events'), events, h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { onclick: () => show('Events') }, 'Manage events'), h('button', { class: 'danger', onclick: resetRates }, 'Reset all rates'))),
    ),
  );
  refreshers.set('Dashboard', async () => {
    const o = await api<Overview>('overview').catch((e: Error) => (toast(e.message, true), null));
    if (!o) return;
    const up = Math.round((o.now - o.startedAt) / 60_000);
    stats.replaceChildren(
      ...[
        [o.online, 'Players in the world'],
        [o.connections, 'Connections'],
        [o.zones.length, 'Zones running'],
        [up >= 120 ? `${Math.floor(up / 60)} h` : `${up} min`, 'Uptime'],
        [ratesText(o.rates), 'World rates'],
      ].map(([v, l]) => h('div', { class: 'stat' }, h('b', {}, v as string), h('span', {}, l as string))),
    );
    zones.replaceChildren(
      ...o.zones.map((z) =>
        h('tr', {},
          h('td', {}, z.name),
          h('td', { class: 'num' }, z.players),
          h('td', { class: 'num' }, z.metrics ? `${z.metrics.p50.toFixed(2)} / ${z.metrics.p99.toFixed(2)}` : '…'),
          h('td', { class: `num ${z.metrics?.late ? 'warn' : ''}` }, z.metrics?.late ?? 0),
          h('td', { class: 'num' }, z.spawns),
        ),
      ),
    );
    events.replaceChildren(
      ...(o.events.length
        ? o.events.map((e) => h('p', {}, h('b', {}, e.name), ` — ${ratesText(e.rates)} `, h('span', { class: 'muted' }, `(${left(e.endsAt)} left)`)))
        : [h('p', { class: 'muted' }, 'None: the original rates.')]),
    );
  });
  return s;
}

async function resetRates(): Promise<void> {
  if (!confirm('End every running and scheduled event and go back to the original rates?')) return;
  if (await act(() => api('rates/reset', {}), 'All rates back to default.')) void refreshers.get(current)?.();
}

// --- Players -----------------------------------------------------------------------------

let selectedPlayer = '';

function playersSection(): HTMLElement {
  const body = h('tbody');
  const target = h('input', { placeholder: 'Character name' });
  const amount = h('input', { type: 'number', placeholder: 'Amount' });
  const item = h('select');
  const itemQty = h('input', { type: 'number', value: '1', min: '1' });
  const summonTo = h('input', { placeholder: 'Character to bring him to' });
  const whisper = h('input', { placeholder: 'Private line from the staff' });
  const select = (name: string) => {
    selectedPlayer = name;
    target.value = name;
    for (const tr of body.querySelectorAll('tr')) tr.classList.toggle('sel', (tr as HTMLElement).dataset.name === name);
  };
  const tool = (action: string, extra: Record<string, unknown> = {}) => {
    if (!target.value.trim()) return toast('Pick a player first.', true);
    void act(() => api('player', { action, target: target.value.trim(), ...extra })).then(() => refreshers.get('Players')?.());
  };
  const s = h('section', {},
    h('div', { class: 'card' },
      h('h2', {}, 'Online'),
      h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['Character', 'Account', 'Zone', 'Lvl', 'HP', 'Gold', 'Position', 'State', ''].map((t, i) => h('th', { class: i >= 3 && i <= 5 ? 'num' : '' }, t)))),
        body,
      )),
    ),
    h('div', { class: 'grid', style: 'margin-top:14px' },
      h('div', { class: 'card' },
        h('h2', {}, 'Player tools'),
        h('div', { class: 'row' }, h('label', {}, 'Player', target)),
        h('div', { class: 'actions', style: 'margin-bottom:10px' },
          h('button', { onclick: () => tool('heal') }, 'Heal / revive'),
          h('button', { onclick: () => tool('unstuck') }, 'Unstuck'),
          h('button', { onclick: () => target.value && moderate('kick', target.value) }, 'Kick'),
          h('button', { onclick: () => target.value && moderate('mute', target.value, 15) }, 'Mute 15 min'),
          h('button', { class: 'danger', onclick: () => target.value && moderate('timeout', target.value, 10) }, 'Timeout 10 min'),
        ),
        h('div', { class: 'row' }, h('label', {}, 'Gold / XP amount', amount), h('button', { onclick: () => tool('gold', { amount: num(amount) }) }, 'Give gold'), h('button', { onclick: () => tool('xp', { amount: num(amount) }) }, 'Give XP')),
        h('p', { class: 'hint' }, 'A negative gold amount takes gold away.'),
        h('div', { class: 'row' }, h('label', {}, 'Item', item), h('label', { class: 'narrow' }, 'Qty', itemQty), h('button', { onclick: () => tool('item', { itemId: item.value, amount: num(itemQty) ?? 1 }) }, 'Give item')),
        h('div', { class: 'row' }, h('label', {}, 'Bring to (same zone)', summonTo), h('button', { onclick: () => tool('summon', { to: summonTo.value.trim() }) }, 'Summon')),
        h('div', { class: 'row' }, h('label', {}, 'Whisper', whisper), h('button', {
          onclick: () => {
            if (!whisper.value.trim() || !target.value.trim()) return;
            void act(() => api('chat', { mode: 'whisper', to: target.value.trim(), text: whisper.value.trim() }), 'Sent.').then((ok) => ok && (whisper.value = ''));
          },
        }, 'Send')),
      ),
    ),
  );
  refreshers.set('Players', async () => {
    if (!item.options.length && catalog.items.length) item.replaceChildren(...catalog.items.map((i) => h('option', { value: i.id }, `${i.name} (${i.type})`)));
    const r = await api<{ players: AdminPlayerView[] }>('players').catch((e: Error) => (toast(e.message, true), null));
    if (!r) return;
    players = r.players;
    body.replaceChildren(
      ...(players.length
        ? players.map((p) => {
          const tr = h('tr', { class: p.character === selectedPlayer ? 'sel' : '', onclick: () => select(p.character) },
            h('td', {}, p.character || h('span', { class: 'muted' }, '—'), p.admin && h('span', { class: 'pill', style: 'margin-left:6px' }, 'admin'), p.guest && h('span', { class: 'pill', style: 'margin-left:6px' }, 'guest')),
            h('td', {}, p.account),
            h('td', {}, p.zone),
            h('td', { class: 'num' }, p.level ?? ''),
            h('td', { class: `num ${p.dead ? 'bad' : ''}` }, p.hp !== undefined ? `${p.hp}/${p.maxHp}` : ''),
            h('td', { class: 'num' }, p.gold ?? ''),
            h('td', { class: 'muted' }, p.x !== undefined ? `${p.x}, ${p.y}, ${p.z}` : ''),
            h('td', {}, p.dead ? h('span', { class: 'bad' }, 'dead') : p.state.replace('_', ' '), p.mutedUntil && h('span', { class: 'pill bad', style: 'margin-left:6px' }, 'muted')),
            h('td', {}, h('div', { class: 'actions' },
              h('button', { class: 'small', onclick: (e: Event) => (e.stopPropagation(), select(p.character), spawnNear(p.character)) }, 'Spawn here'),
              h('button', { class: 'small', onclick: (e: Event) => (e.stopPropagation(), moderate('kick', p.character)) }, 'Kick'),
            )),
          );
          tr.dataset.name = p.character;
          return tr;
        })
        : [h('tr', {}, h('td', { colspan: 9, class: 'muted' }, 'Nobody is online.'))]),
    );
  });
  return s;
}

// --- Chat --------------------------------------------------------------------------------

function chatSection(): HTMLElement {
  const log = h('div', { id: 'chat-log' });
  const filters = { local: true, global: true, private: true, admin: true } as Record<AdminChatLine['channel'], boolean>;
  const search = h('input', { placeholder: 'Filter by name or text' });
  const mode = h('select', {}, h('option', { value: 'announce' }, 'Announce to everyone'), h('option', { value: 'zone' }, 'To one zone'), h('option', { value: 'whisper' }, 'Whisper a character'));
  const zone = h('select');
  const to = h('input', { placeholder: 'Character' });
  const text = h('input', { placeholder: 'Message (shown in gold on every chat tab)', maxLength: 256 });
  const zoneLabel = h('label', { class: 'narrow', style: 'flex-basis:160px' }, 'Zone', zone);
  const toLabel = h('label', { class: 'narrow', style: 'flex-basis:160px' }, 'To', to);
  const updateMode = () => {
    zoneLabel.hidden = mode.value !== 'zone';
    toLabel.hidden = mode.value !== 'whisper';
  };
  mode.addEventListener('change', updateMode);
  updateMode();
  const lines: AdminChatLine[] = [];
  const visible = (l: AdminChatLine) => {
    const q = search.value.trim().toLowerCase();
    return filters[l.channel] && (!q || `${l.from} ${l.to ?? ''} ${l.text}`.toLowerCase().includes(q));
  };
  const render = (l: AdminChatLine) => {
    const name = h('span', { class: 'n', title: 'Use as target', onclick: () => {
      to.value = l.from;
      mode.value = 'whisper';
      updateMode();
      selectedPlayer = l.from;
      modTarget.value = l.from;
      text.focus();
    } }, l.from);
    return h('div', { class: `cl ${l.channel}` },
      h('span', { class: 't' }, time(l.at)),
      h('span', { class: 'ch' }, l.channel === 'private' ? 'whisper' : l.channel),
      l.channel === 'admin' ? `[${l.from}] ` : name,
      l.to ? ` → ${l.to}` : '',
      l.channel === 'admin' ? '' : ': ',
      l.text,
      l.zone && h('span', { class: 'z' }, l.zone),
    );
  };
  const redraw = () => {
    log.replaceChildren(...lines.filter(visible).map(render));
    log.scrollTop = log.scrollHeight;
  };
  search.addEventListener('input', redraw);
  const add = (l: AdminChatLine) => {
    if (lines.length && lines[lines.length - 1]!.seq >= l.seq) return; // replay after a reconnect
    lines.push(l);
    if (lines.length > 2000) lines.splice(0, lines.length - 2000);
    if (!visible(l)) return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.append(render(l));
    if (stick) log.scrollTop = log.scrollHeight;
    if (current !== 'Chat') {
      unreadChat++;
      updateChatBadge();
    }
  };
  const stream = new EventSource('/api/admin/stream');
  stream.addEventListener('chat', (e) => add(JSON.parse((e as MessageEvent<string>).data) as AdminChatLine));
  stream.onerror = () => {
    if (stream.readyState === EventSource.CLOSED) toast('Chat stream closed; reload the page.', true);
  };
  const send = async () => {
    const t = text.value.trim();
    if (!t) return;
    if (await act(() => api('chat', { mode: mode.value, text: t, ...(mode.value === 'zone' ? { zone: zone.value } : {}), ...(mode.value === 'whisper' ? { to: to.value.trim() } : {}) }), 'Sent.')) text.value = '';
  };
  text.addEventListener('keydown', (e) => e.key === 'Enter' && void send());
  const s = h('section', {},
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        ...(['local', 'global', 'private', 'admin'] as const).map((c) => {
          const box = h('input', { type: 'checkbox', checked: true, onchange: () => ((filters[c] = box.checked), redraw()) });
          return h('label', { class: 'inline' }, box, c === 'private' ? 'whispers' : c);
        }),
        h('label', {}, search),
      ),
      log,
      h('div', { class: 'row', style: 'margin-top:10px' }, h('label', { class: 'narrow', style: 'flex-basis:190px' }, 'Send', mode), zoneLabel, toLabel, h('label', { style: 'flex:3 1 260px' }, 'Text', text), h('button', { onclick: send }, 'Send')),
      h('p', { class: 'hint' }, 'Click a name to whisper or moderate that player. Whispers between players are logged here for moderation.'),
    ),
  );
  refreshers.set('Chat', () => {
    const names = [...new Set([...catalog.running, ...players.map((p) => p.zone)])];
    const keep = zone.value;
    zone.replaceChildren(...names.map((n) => h('option', { value: n }, n)));
    if (names.includes(keep)) zone.value = keep;
  });
  return s;
}

// --- Moderation --------------------------------------------------------------------------

const modTarget = h('input', { placeholder: 'Username or character name' });

async function moderate(action: string, target: string, minutes?: number, reason?: string): Promise<void> {
  const verbs: Record<string, string> = { kick: 'Kick', mute: 'Mute', unmute: 'Unmute', timeout: 'Time out', ban: 'Ban', unban: 'Unban' };
  const span = minutes ? ` for ${minutes} min` : action === 'ban' || action === 'mute' ? ' permanently' : '';
  if ((action === 'ban' || action === 'timeout' || action === 'kick') && !confirm(`${verbs[action]} ${target}${span}?`)) return;
  if (await act(() => api('moderate', { action, target, ...(minutes ? { minutes } : {}), ...(reason ? { reason } : {}) }))) {
    void refreshers.get(current)?.();
  }
}

function moderation(): HTMLElement {
  const q = h('input', { placeholder: 'Search accounts and characters' });
  const results = h('tbody');
  const minutes = h('input', { type: 'number', min: '1', placeholder: 'empty = permanent' });
  const unit = h('select', {}, h('option', { value: '1' }, 'minutes'), h('option', { value: '60' }, 'hours'), h('option', { value: '1440' }, 'days'));
  const reason = h('input', { placeholder: 'Reason (shown to the player)', maxLength: 200 });
  const length = () => (num(minutes) ? Math.round(num(minutes)! * Number(unit.value)) : undefined);
  const run = (action: string) => {
    const t = modTarget.value.trim();
    if (!t) return toast('Name an account or character.', true);
    void moderate(action, t, action === 'kick' || action.startsWith('un') ? undefined : length(), reason.value.trim() || undefined);
  };
  const searchNow = async () => {
    const r = await api<{ accounts: AdminAccountView[] }>(`accounts?q=${encodeURIComponent(q.value.trim())}`).catch((e: Error) => (toast(e.message, true), null));
    if (!r) return;
    results.replaceChildren(
      ...(r.accounts.length
        ? r.accounts.map((a) => {
          const ban = until(a.bannedUntil);
          const mute = until(a.mutedUntil);
          return h('tr', { onclick: () => (modTarget.value = a.username) },
            h('td', {}, a.username, a.admin && h('span', { class: 'pill', style: 'margin-left:6px' }, 'admin')),
            h('td', {}, ...a.characters.flatMap((c, i) => [i ? ', ' : '', h('span', { class: c.online ? 'ok' : '' }, `${c.name} (${c.level})`)])),
            h('td', { class: 'muted' }, dateTime(a.createdAt)),
            h('td', {}, ban ? h('span', { class: 'bad', title: a.banReason ?? '' }, `banned ${ban}`) : mute ? h('span', { class: 'warn' }, `muted ${mute}`) : h('span', { class: 'muted' }, 'ok')),
            h('td', {}, h('div', { class: 'actions' },
              ban && h('button', { class: 'small', onclick: (e: Event) => (e.stopPropagation(), moderate('unban', a.username)) }, 'Unban'),
              mute && h('button', { class: 'small', onclick: (e: Event) => (e.stopPropagation(), moderate('unmute', a.username)) }, 'Unmute'),
            )),
          );
        })
        : [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'No match.'))]),
    );
  };
  q.addEventListener('keydown', (e) => e.key === 'Enter' && void searchNow());
  refreshers.set('Moderation', searchNow);
  return h('section', {},
    h('div', { class: 'grid' },
      h('div', { class: 'card' },
        h('h2', {}, 'Act on a player'),
        h('div', { class: 'row' }, h('label', {}, 'Target', modTarget)),
        h('div', { class: 'row' }, h('label', {}, 'Length', minutes), h('label', { class: 'narrow' }, ' ', unit)),
        h('div', { class: 'row' }, h('label', {}, 'Reason', reason)),
        h('div', { class: 'actions' },
          h('button', { onclick: () => run('kick') }, 'Kick'),
          h('button', { onclick: () => run('mute') }, 'Mute'),
          h('button', { onclick: () => run('unmute') }, 'Unmute'),
          h('button', { class: 'danger', onclick: () => run('timeout') }, 'Timeout'),
          h('button', { class: 'danger', onclick: () => run('ban') }, 'Ban'),
          h('button', { onclick: () => run('unban') }, 'Unban'),
        ),
        h('p', { class: 'hint' }, 'Kick: disconnect. Mute: no chat (empty length = permanent). Timeout: kicked and locked out for the length (default 10 min). Ban: locked out for the length, or for good. Guests can only be kicked and muted.'),
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Accounts'),
        h('div', { class: 'row' }, h('label', {}, q), h('button', { onclick: searchNow }, 'Search')),
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Account', 'Characters (level)', 'Created', 'Status', ''].map((t) => h('th', {}, t)))), results)),
      ),
    ),
  );
}

// --- Events ------------------------------------------------------------------------------

function eventsSection(): HTMLElement {
  const name = h('input', { placeholder: 'Double XP weekend', maxLength: 60 });
  const field = (v = '1') => h('input', { type: 'number', min: '0', step: '0.1', value: v });
  const xp = field(), gold = field(), drops = field(), respawn = field();
  const startNow = h('input', { type: 'radio', name: 'start', checked: true });
  const startLater = h('input', { type: 'radio', name: 'start' });
  const startAt = h('input', { type: 'datetime-local' });
  const minutes = h('input', { type: 'number', min: '1', value: String(DEFAULT_EVENT_MINUTES) });
  const announce = h('input', { type: 'checkbox', checked: true });
  const list = h('tbody');
  startAt.addEventListener('focus', () => (startLater.checked = true));
  const preset = (label: string, r: Partial<WorldRates>, mins = DEFAULT_EVENT_MINUTES) =>
    h('button', { class: 'ghost small', onclick: () => {
      name.value = label;
      xp.value = String(r.xp ?? 1);
      gold.value = String(r.gold ?? 1);
      drops.value = String(r.drops ?? 1);
      respawn.value = String(r.respawn ?? 1);
      minutes.value = String(mins);
    } }, label);
  const create = async () => {
    const rates = { xp: num(xp) ?? 1, gold: num(gold) ?? 1, drops: num(drops) ?? 1, respawn: num(respawn) ?? 1 };
    const startsAt = startLater.checked && startAt.value ? new Date(startAt.value).getTime() : undefined;
    if (await act(() => api('events', { name: name.value.trim(), rates, minutes: num(minutes) ?? DEFAULT_EVENT_MINUTES, announce: announce.checked, ...(startsAt ? { startsAt } : {}) }), 'Event saved.')) void refresh();
  };
  const refresh = async () => {
    const r = await api<{ events: AdminEvent[]; rates: WorldRates }>('events').catch((e: Error) => (toast(e.message, true), null));
    if (!r) return;
    $('#rates-now').textContent = ratesText(r.rates);
    list.replaceChildren(
      ...(r.events.length
        ? r.events.map((e) => h('tr', {},
          h('td', {}, e.name),
          h('td', {}, ratesText(e.rates)),
          h('td', {}, dateTime(e.startsAt)),
          h('td', {}, dateTime(e.endsAt), e.state === 'active' && h('span', { class: 'muted' }, ` (${left(e.endsAt)} left)`)),
          h('td', {}, h('span', { class: `pill ${e.state}` }, e.state)),
          h('td', { class: 'muted' }, e.createdBy),
          h('td', {}, (e.state === 'active' || e.state === 'scheduled') && h('button', { class: 'small danger', onclick: async () => {
            if (confirm(`End "${e.name}" now?`) && (await act(() => api('events/cancel', { id: e.id }), 'Event ended.'))) void refresh();
          } }, e.state === 'active' ? 'End now' : 'Cancel')),
        ))
        : [h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'No events yet.'))]),
    );
  };
  refreshers.set('Events', refresh);
  return h('section', {},
    h('div', { class: 'grid' },
      h('div', { class: 'card' },
        h('h2', {}, 'New event'),
        h('div', { class: 'presets' }, preset('Double XP', { xp: 2 }), preset('Double drops', { drops: 2 }), preset('Gold rush', { gold: 3 }), preset('Happy hour', { xp: 1.5, gold: 1.5, drops: 1.5 }), preset('Fast respawn', { respawn: 2 }, 30)),
        h('div', { class: 'row' }, h('label', {}, 'Name', name)),
        h('div', { class: 'row' }, h('label', {}, 'XP ×', xp), h('label', {}, 'Gold ×', gold), h('label', {}, 'Drops ×', drops), h('label', {}, 'Respawn ×', respawn)),
        h('fieldset', {}, h('legend', {}, 'Start'),
          h('div', { class: 'row' }, h('label', { class: 'inline' }, startNow, 'Now'), h('label', { class: 'inline' }, startLater, 'At'), h('label', {}, startAt)),
        ),
        h('div', { class: 'row' }, h('label', {}, 'Duration (minutes)', minutes), h('label', { class: 'inline' }, announce, 'Announce start and end in chat')),
        h('div', { class: 'row' }, h('button', { onclick: create }, 'Save event')),
        h('p', { class: 'hint' }, `Every event has an end: ${DEFAULT_EVENT_MINUTES} minutes unless set, then the rates go back to default by themselves. Events running at once multiply. Drops scale loot chances and the expected count of what creatures carry (never keys or quest items). Respawn ×2 brings creatures back in half the time.`),
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'World rates now: ', h('span', { id: 'rates-now', style: 'color:var(--text)' }, '…')),
        h('div', { class: 'row' }, h('button', { class: 'danger', onclick: resetRates }, 'Reset all rates')),
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Event', 'Rates', 'Starts', 'Ends', 'State', 'By', ''].map((t) => h('th', {}, t)))), list)),
      ),
    ),
  );
}

// --- Spawns ------------------------------------------------------------------------------

let spawnNear: (name: string) => void = () => {};

function spawnsSection(): HTMLElement {
  const zone = h('select');
  const creature = h('select');
  const base = h('p', { class: 'hint' });
  const name = h('input', { placeholder: 'Keep the creature’s name', maxLength: 32 });
  const count = h('input', { type: 'number', min: '1', max: '50', value: '1' });
  const where = h('select', {}, h('option', { value: 'player' }, 'Next to a player'), h('option', { value: 'start' }, 'Zone start point'), h('option', { value: 'point' }, 'Coordinates (m)'));
  const player = h('select');
  const x = h('input', { type: 'number', step: '0.1' }), y = h('input', { type: 'number', step: '0.1' }), z = h('input', { type: 'number', step: '0.1' });
  const hp = h('input', { type: 'number', min: '1' }), xpIn = h('input', { type: 'number', min: '0' });
  const goldMin = h('input', { type: 'number', min: '0' }), goldMax = h('input', { type: 'number', min: '0' });
  const mult = (v: string, step = '0.1') => h('input', { type: 'number', min: '0.1', step, value: v });
  const scale = mult('1'), damage = mult('1'), speed = mult('1');
  const respawn = h('input', { type: 'checkbox' });
  const aggressive = h('input', { type: 'checkbox' });
  const minutes = h('input', { type: 'number', min: '1', value: String(DEFAULT_EVENT_MINUTES) });
  const replaceLoot = h('input', { type: 'checkbox' });
  const lootRows = h('div');
  const list = h('tbody');
  const playerLabel = h('label', {}, 'Player', player);
  const pointRow = h('div', { class: 'row' }, h('label', {}, 'x', x), h('label', {}, 'y', y), h('label', {}, 'z', z));
  const zoneLabel = h('label', {}, 'Zone', zone);
  const updateWhere = () => {
    playerLabel.hidden = where.value !== 'player';
    pointRow.hidden = where.value !== 'point';
    zoneLabel.hidden = where.value === 'player';
  };
  where.addEventListener('change', updateWhere);
  const showBase = () => {
    const c = catalog.creatures.find((k) => k.id === creature.value);
    if (!c) return;
    base.textContent = `Base: ${c.hp} HP · ${c.xp} XP · ${c.goldMin}–${c.goldMax} gold${c.loot.length ? ` · loot ${c.loot.map((l) => `${l.itemId} ${Math.round(l.chance * 100)}%`).join(', ')}` : ''}. Empty fields keep these.`;
    hp.placeholder = String(c.hp);
    xpIn.placeholder = String(c.xp);
    goldMin.placeholder = String(c.goldMin);
    goldMax.placeholder = String(c.goldMax);
  };
  creature.addEventListener('change', showBase);
  const addLoot = () => {
    const item = h('select', {}, ...catalog.items.map((i) => h('option', { value: i.id }, i.name)));
    const chance = h('input', { type: 'number', min: '0', max: '100', value: '100', title: 'Chance %' });
    const qty = h('input', { type: 'number', min: '1', value: '1', title: 'Quantity' });
    const row = h('div', { class: 'loot-row' }, item, chance, qty, h('button', { class: 'small ghost', onclick: () => row.remove() }, '✕'));
    lootRows.append(row);
    replaceLoot.checked = true;
  };
  spawnNear = (n: string) => {
    show('Spawns');
    where.value = 'player';
    updateWhere();
    fillPlayers();
    player.value = n;
  };
  const fillPlayers = () => {
    const keep = player.value;
    const names = players.filter((p) => p.state === 'in_world').map((p) => p.character);
    player.replaceChildren(...names.map((n) => h('option', { value: n }, `${n} (${players.find((p) => p.character === n)!.zone})`)));
    if (names.includes(keep)) player.value = keep;
  };
  const spawn = async () => {
    const at = where.value === 'player' ? { player: player.value } : where.value === 'start' ? { start: true } : { x: num(x), y: num(y), z: num(z) };
    if (where.value === 'player' && !player.value) return toast('Nobody online to spawn next to.', true);
    const loot = replaceLoot.checked
      ? [...lootRows.querySelectorAll('.loot-row')].map((r) => {
        const [item, chance, qty] = r.querySelectorAll('select, input') as unknown as [HTMLSelectElement, HTMLInputElement, HTMLInputElement];
        return { itemId: item.value, chance: Math.min(1, Math.max(0, (num(chance) ?? 100) / 100)), quantity: num(qty) ?? 1 };
      })
      : undefined;
    const req = {
      zone: zone.value, archetype: creature.value, at, count: num(count) ?? 1,
      ...(name.value.trim() ? { name: name.value.trim() } : {}),
      ...(num(hp) !== undefined ? { hp: num(hp) } : {}), ...(num(xpIn) !== undefined ? { xp: num(xpIn) } : {}),
      ...(num(goldMin) !== undefined ? { goldMin: num(goldMin) } : {}), ...(num(goldMax) !== undefined ? { goldMax: num(goldMax) } : {}),
      ...(loot ? { loot } : {}),
      scale: num(scale) ?? 1, damage: num(damage) ?? 1, speed: num(speed) ?? 1,
      respawn: respawn.checked, aggressive: aggressive.checked, minutes: num(minutes) ?? DEFAULT_EVENT_MINUTES,
    };
    const ok = await act(async () => {
      const r = await api<{ spawn: CustomSpawnView }>('spawns', req);
      return { message: `${r.spawn.count} × ${r.spawn.name} spawned in ${r.spawn.zone}.` };
    });
    if (ok) void refresh();
  };
  const refresh = async () => {
    const [c, p, s] = await Promise.all([
      api<Catalog>('catalog').catch(() => null),
      api<{ players: AdminPlayerView[] }>('players').catch(() => null),
      api<{ spawns: CustomSpawnView[] }>('spawns').catch((e: Error) => (toast(e.message, true), null)),
    ]);
    if (c) {
      catalog = c;
      if (!creature.options.length) {
        const hostile = c.creatures.filter((k) => !k.passive), peaceful = c.creatures.filter((k) => k.passive);
        creature.replaceChildren(
          h('optgroup', { label: 'Creatures' }, ...hostile.map((k) => h('option', { value: k.id }, `${k.name} (${k.id})`))),
          h('optgroup', { label: 'Peaceful (citizens, merchants)' }, ...peaceful.map((k) => h('option', { value: k.id }, `${k.name} (${k.id})`))),
        );
        showBase();
      }
      const keep = zone.value;
      zone.replaceChildren(...c.arenas.map((a) => h('option', { value: a }, `${a}${c.running.includes(a) ? ' · running' : ''}`)));
      zone.value = c.arenas.includes(keep) ? keep : c.running[0] ?? c.arenas[0] ?? '';
    }
    if (p) {
      players = p.players;
      fillPlayers();
    }
    if (s) {
      list.replaceChildren(
        ...(s.spawns.length
          ? s.spawns.map((v) => h('tr', {},
            h('td', {}, v.name, h('span', { class: 'muted' }, ` (${v.archetype})`)),
            h('td', {}, v.zone),
            h('td', { class: 'num' }, `${v.alive}/${v.count}`),
            h('td', {}, v.respawn ? 'yes' : 'no'),
            h('td', {}, left(v.expiresAt)),
            h('td', { class: 'muted' }, v.createdBy),
            h('td', {}, h('button', { class: 'small danger', onclick: async () => {
              if (await act(() => api('spawns/remove', { id: v.id }), 'Removed.')) void refresh();
            } }, 'Remove')),
          ))
          : [h('tr', {}, h('td', { colspan: 7, class: 'muted' }, 'No custom creatures in the world.'))]),
      );
    }
  };
  refreshers.set('Spawns', refresh);
  updateWhere();
  return h('section', {},
    h('div', { class: 'grid' },
      h('div', { class: 'card' },
        h('h2', {}, 'Spawn a custom creature'),
        h('div', { class: 'row' }, h('label', {}, 'Creature', creature), h('label', { class: 'narrow' }, 'Count', count)),
        base,
        h('div', { class: 'row' }, h('label', {}, 'Name', name)),
        h('fieldset', {}, h('legend', {}, 'Where'),
          h('div', { class: 'row' }, h('label', {}, 'Place', where), zoneLabel, playerLabel),
          pointRow,
        ),
        h('fieldset', {}, h('legend', {}, 'Rewards'),
          h('div', { class: 'row' }, h('label', {}, 'XP', xpIn), h('label', {}, 'Gold min', goldMin), h('label', {}, 'Gold max', goldMax)),
          h('label', { class: 'inline', style: 'margin-bottom:6px' }, replaceLoot, 'Own loot table (item · chance % · quantity)'),
          lootRows,
          h('button', { class: 'small ghost', onclick: addLoot }, '+ Loot item'),
        ),
        h('fieldset', {}, h('legend', {}, 'Strength'),
          h('div', { class: 'row' }, h('label', {}, 'HP', hp), h('label', {}, 'Size ×', scale), h('label', {}, 'Damage ×', damage), h('label', {}, 'Speed ×', speed)),
        ),
        h('div', { class: 'row' },
          h('label', {}, 'Lasts (minutes)', minutes),
          h('label', { class: 'inline' }, respawn, 'Respawns after death'),
          h('label', { class: 'inline' }, aggressive, 'Hunts every player it sees'),
        ),
        h('div', { class: 'row' }, h('button', { onclick: spawn }, 'Spawn')),
        h('p', { class: 'hint' }, 'Custom creatures are removed when their time runs out, and those that do not respawn once killed. A zone with custom creatures keeps running while it has them.'),
      ),
      h('div', { class: 'card' },
        h('h2', {}, 'Custom creatures in the world'),
        h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Name', 'Zone', 'Alive', 'Respawns', 'Time left', 'By', ''].map((t, i) => h('th', { class: i === 2 ? 'num' : '' }, t)))), list)),
      ),
    ),
  );
}

// --- Audit log ---------------------------------------------------------------------------

function auditSection(): HTMLElement {
  const body = h('tbody');
  refreshers.set('Audit log', async () => {
    const r = await api<{ actions: { id: number; at: number; admin: string; action: string; target: string | null; detail: string | null }[] }>('log').catch((e: Error) => (toast(e.message, true), null));
    if (!r) return;
    body.replaceChildren(
      ...(r.actions.length
        ? r.actions.map((a) => h('tr', {}, h('td', { class: 'muted' }, dateTime(a.at)), h('td', {}, a.admin), h('td', {}, a.action), h('td', {}, a.target ?? ''), h('td', { class: 'muted' }, a.detail ?? '')))
        : [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, 'Nothing yet.'))]),
    );
  });
  return h('section', {}, h('div', { class: 'card' }, h('h2', {}, 'Audit log (last 200)'), h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['When', 'Admin', 'Action', 'Target', 'Detail'].map((t) => h('th', {}, t)))), body))));
}

// --- Sign in -----------------------------------------------------------------------------

function login(message = ''): void {
  const user = h('input', { autocomplete: 'username' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('p', { class: 'bad' }, message);
  const submit = async (e: Event) => {
    e.preventDefault();
    const res = await fetch('/api/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: user.value.trim(), password: pass.value }) });
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!res.ok) err.textContent = data.message ?? data.error ?? 'Could not sign in.';
    else void boot();
  };
  $('#app').replaceChildren(
    h('form', { id: 'login', class: 'card', onsubmit: submit },
      h('h2', {}, 'CrusadersOnline · Admin'),
      h('div', { class: 'row' }, h('label', {}, 'Username', user)),
      h('div', { class: 'row' }, h('label', {}, 'Password', pass)),
      err,
      h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Sign in')),
      h('p', { class: 'hint' }, 'Only administrator accounts get in (ADMIN_USERS, or pnpm admin grant <username>).'),
    ),
  );
  user.focus();
}

async function boot(): Promise<void> {
  try {
    me = (await api<{ username: string }>('me')).username;
  } catch (err) {
    const e = err as ApiError;
    if (e.status === 401 || e.status === 403) return login(e.status === 403 ? e.message : '');
    $('#app').replaceChildren(h('main', {}, h('p', { class: 'bad' }, `The server did not answer: ${e.message}`)));
    return;
  }
  catalog = await api<Catalog>('catalog').catch(() => catalog);
  shell();
}

void boot();
