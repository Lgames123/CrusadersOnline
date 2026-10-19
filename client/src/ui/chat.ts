import { CHAT_MAX_LENGTH, type ChatBroadcastMsg, type ChatNoticeKind } from '@crusaders/shared';

/**
 * Text chat (not the original's, which is single player): a window with four tabs — Local (this
 * map), Global (every map), Server (what the server reports to this player: loot, gold,
 * experience, trades, refusals) and Private (lines to and from one character). Moved by its tab
 * bar, resized from its corner, minimised to the tab bar; its place, size and tab are kept per
 * browser. Enter opens the line, Enter sends, Esc leaves it. Commands: /l, /g, /w <name>, /r.
 */
type Tab = 'local' | 'global' | 'system' | 'private';
type SendChannel = 'local' | 'global' | 'private';
type Line = ChatBroadcastMsg['d'] & { at: number };

const TABS: readonly { tab: Tab; label: string }[] = [
  { tab: 'local', label: 'Local' },
  { tab: 'global', label: 'Global' },
  { tab: 'system', label: 'Server' },
  { tab: 'private', label: 'Private' },
];
/** Lines kept per tab. */
const HISTORY = 200;
const LAYOUT_KEY = 'crusaders.chat.layout';
const MIN_W = 260;
const MIN_H = 140;

interface Layout {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  tab: Tab;
}

function loadLayout(): Partial<Layout> {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Partial<Layout> | null;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export class ChatWindow {
  private readonly root: HTMLElement;
  private readonly log: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly prefix: HTMLElement;
  private readonly toInput: HTMLInputElement;
  private readonly textInput: HTMLInputElement;
  private readonly tabButtons = new Map<Tab, HTMLButtonElement>();
  private readonly lines: Record<Tab, Line[]> = { local: [], global: [], system: [], private: [] };
  private readonly unread: Record<Tab, number> = { local: 0, global: 0, system: 0, private: 0 };
  private tab: Tab = 'local';
  private minimized = false;
  /** The character the latest private line came from (/r). */
  private replyTo = '';
  /** Lines sent, newest last (Up / Down in the line). */
  private readonly sent: string[] = [];
  private sentIndex = -1;
  onSend: (channel: SendChannel, text: string, to?: string) => void = () => {};
  /** The line took or gave up the keyboard. */
  onTyping: (typing: boolean) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add('chat');
    const head = document.createElement('div');
    head.className = 'chat-head';
    for (const { tab, label } of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chat-tab';
      b.dataset.tab = tab;
      b.textContent = label;
      b.addEventListener('click', () => this.select(tab));
      this.tabButtons.set(tab, b);
      head.append(b);
    }
    const grip = document.createElement('div');
    grip.className = 'chat-grip';
    grip.title = 'Drag to move';
    const min = document.createElement('button');
    min.type = 'button';
    min.className = 'chat-min';
    min.title = 'Minimise';
    min.addEventListener('click', () => this.setMinimized(!this.minimized));
    head.append(grip, min);

    this.log = document.createElement('div');
    this.log.className = 'chat-log';
    this.log.addEventListener('click', (e) => {
      const name = (e.target as HTMLElement).closest<HTMLElement>('.chat-name')?.dataset.name;
      if (name) this.whisper(name);
    });

    this.form = document.createElement('form');
    this.form.className = 'chat-input';
    this.prefix = document.createElement('span');
    this.prefix.className = 'chat-prefix';
    this.toInput = document.createElement('input');
    this.toInput.className = 'chat-to';
    this.toInput.placeholder = 'Name';
    this.toInput.maxLength = 32;
    this.toInput.spellcheck = false;
    this.toInput.autocomplete = 'off';
    this.textInput = document.createElement('input');
    this.textInput.className = 'chat-text';
    this.textInput.maxLength = CHAT_MAX_LENGTH;
    this.textInput.autocomplete = 'off';
    this.form.append(this.prefix, this.toInput, this.textInput);
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    for (const input of [this.toInput, this.textInput]) {
      input.addEventListener('keydown', (e) => this.inputKey(e, input));
      input.addEventListener('focus', () => this.typingChanged());
      input.addEventListener('blur', () => queueMicrotask(() => this.typingChanged()));
    }

    const resize = document.createElement('div');
    resize.className = 'chat-resize';
    resize.title = 'Drag to resize';
    root.append(head, this.log, this.form, resize);

    // Place and size from the last session, else the bottom left corner.
    const saved = loadLayout();
    this.placed = typeof saved.x === 'number' && typeof saved.y === 'number';
    this.box = {
      x: num(saved.x, 12),
      y: num(saved.y, window.innerHeight - 330),
      w: num(saved.w, 380),
      h: num(saved.h, 200),
    };
    if (TABS.some((t) => t.tab === saved.tab)) this.tab = saved.tab!;
    this.minimized = saved.minimized === true;
    this.drag(head, (dx, dy, start) => {
      this.box.x = start.x + dx;
      this.box.y = start.y + dy;
    }, (e) => !(e.target as HTMLElement).closest('button'));
    this.drag(resize, (dx, dy, start) => {
      this.box.w = start.w + dx;
      this.box.h = start.h + dy;
    });
    window.addEventListener('resize', () => this.applyBox());
    this.select(this.tab);
    this.setMinimized(this.minimized);
  }

  private box: { x: number; y: number; w: number; h: number };
  /** Whether the window has a place yet (saved, or set on its first showing). */
  private placed: boolean;

  set visible(v: boolean) {
    this.root.hidden = !v;
    if (!v) this.blur();
    else if (!this.placed) {
      this.placed = true;
      this.box.x = 12;
      this.box.y = window.innerHeight - 12 - this.box.h;
      this.applyBox();
    }
  }

  /** Whether the line has the keyboard. */
  get typing(): boolean {
    const a = document.activeElement;
    return a === this.textInput || a === this.toInput;
  }

  /** Opens the line (restoring a minimised window), optionally starting with `text`. */
  focus(text = ''): void {
    if (this.minimized) this.setMinimized(false);
    if (this.tab === 'private' && !this.toInput.value) this.toInput.focus();
    else this.textInput.focus();
    if (text) this.textInput.value = text;
  }

  blur(): void {
    if (this.typing) (document.activeElement as HTMLElement).blur();
  }

  /** A line from the server. */
  add(d: ChatBroadcastMsg['d']): void {
    const tab: Tab = d.channel;
    if (d.channel === 'private' && d.from && !d.sent) {
      this.replyTo = d.from;
      if (!this.toInput.value) this.toInput.value = d.from;
    }
    this.push(tab, { ...d, at: Date.now() });
  }

  /** A line of the client's own on the Server tab (refusals shown over the head too). */
  notice(text: string, kind: ChatNoticeKind = 'info'): void {
    this.push('system', { channel: 'system', kind, text, at: Date.now() });
  }

  private push(tab: Tab, line: Line): void {
    const list = this.lines[tab];
    list.push(line);
    if (list.length > HISTORY) list.splice(0, list.length - HISTORY);
    if (tab === this.tab && !this.minimized) {
      const stick = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 24;
      this.log.append(this.render(line));
      while (this.log.childElementCount > HISTORY) this.log.firstElementChild!.remove();
      if (stick) this.log.scrollTop = this.log.scrollHeight;
    } else {
      this.unread[tab]++;
      this.updateTab(tab);
    }
  }

  private render(line: Line): HTMLElement {
    const row = document.createElement('div');
    row.className = `chat-line chat-${line.channel}${line.kind ? ` chat-kind-${line.kind}` : ''}`;
    const time = document.createElement('span');
    time.className = 'chat-time';
    const at = new Date(line.at);
    time.textContent = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    row.append(time);
    if (line.from) {
      const mine = line.sent === true;
      const other = mine ? line.to ?? line.from : line.from;
      const name = document.createElement('span');
      // A name is a whisper link, except one's own on a map line.
      const self = mine && line.channel !== 'private';
      name.className = self ? 'chat-name chat-self' : 'chat-name';
      if (!self) {
        name.dataset.name = other;
        name.title = `Whisper ${other}`;
      }
      name.textContent = line.channel === 'private' ? (mine ? `To ${other}` : `From ${other}`) : other;
      row.append(name, document.createTextNode(': '));
    }
    row.append(document.createTextNode(line.text));
    return row;
  }

  private select(tab: Tab): void {
    this.tab = tab;
    this.unread[tab] = 0;
    for (const t of TABS) {
      this.tabButtons.get(t.tab)!.classList.toggle('chat-active', t.tab === tab);
      this.updateTab(t.tab);
    }
    this.log.replaceChildren(...this.lines[tab].map((l) => this.render(l)));
    this.log.scrollTop = this.log.scrollHeight;
    this.updateInput();
    this.save();
  }

  private updateTab(tab: Tab): void {
    const b = this.tabButtons.get(tab)!;
    const n = this.unread[tab];
    b.textContent = TABS.find((t) => t.tab === tab)!.label;
    if (n) {
      const badge = document.createElement('span');
      badge.className = 'chat-unread';
      badge.textContent = n > 99 ? '99+' : String(n);
      b.append(badge);
    }
  }

  /** What a plain line on this tab says, and to whom. The Server tab's lines go to the map. */
  private updateInput(): void {
    const priv = this.tab === 'private';
    this.toInput.hidden = !priv;
    this.prefix.textContent = priv ? 'To' : this.tab === 'global' ? 'Global' : 'Local';
    this.textInput.placeholder = priv ? 'Whisper…' : this.tab === 'global' ? 'Say to every map…' : 'Say to this map…   (/g /w /r)';
  }

  private setMinimized(min: boolean): void {
    this.minimized = min;
    this.root.classList.toggle('chat-minimized', min);
    const b = this.root.querySelector<HTMLButtonElement>('.chat-min')!;
    b.textContent = min ? '▴' : '▾';
    b.title = min ? 'Restore' : 'Minimise';
    if (min) this.blur();
    else this.select(this.tab);
    this.applyBox();
    this.save();
  }

  /** Switches to Private, addressed to `name`, and opens the line. */
  private whisper(name: string): void {
    this.toInput.value = name;
    this.select('private');
    this.focus();
  }

  private submit(): void {
    const raw = this.textInput.value.trim();
    if (!raw) {
      if (document.activeElement === this.toInput && this.toInput.value) this.textInput.focus();
      else this.blur();
      return;
    }
    let channel: SendChannel = this.tab === 'private' ? 'private' : this.tab === 'global' ? 'global' : 'local';
    let to = channel === 'private' ? this.toInput.value.trim() : '';
    let text = raw;
    const cmd = /^\/(\S+)\s*(.*)$/s.exec(raw);
    if (cmd) {
      const [, name, rest] = cmd as unknown as [string, string, string];
      switch (name.toLowerCase()) {
        case 'l': case 'local': case 's': case 'say':
          channel = 'local';
          text = rest;
          break;
        case 'g': case 'global':
          channel = 'global';
          text = rest;
          break;
        case 'w': case 'whisper': case 't': case 'tell': case 'msg': {
          const m = /^(\S+)\s*(.*)$/s.exec(rest);
          channel = 'private';
          to = m?.[1] ?? '';
          text = m?.[2] ?? '';
          break;
        }
        case 'r': case 'reply':
          channel = 'private';
          to = this.replyTo;
          text = rest;
          if (!to) return this.notice('Nobody to reply to.', 'error');
          break;
        default:
          return this.notice(`Unknown command /${name}. Try /l, /g, /w <name> or /r.`, 'error');
      }
    }
    text = text.trim();
    if (channel === 'private' && !to) return this.notice('Whisper whom? Type a name, or /w <name> <text>.', 'error');
    if (!text) return;
    this.onSend(channel, text, channel === 'private' ? to : undefined);
    this.sent.push(raw);
    if (this.sent.length > 50) this.sent.shift();
    this.sentIndex = -1;
    this.textInput.value = '';
    this.blur();
  }

  private inputKey(e: KeyboardEvent, input: HTMLInputElement): void {
    // The game's own keys (Esc menu, Enter, inventory…) stay out while typing.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      this.blur();
    } else if (e.key === 'Enter') {
      // Two fields and no submit button: the form never submits on Enter by itself.
      e.preventDefault();
      if (e.isComposing) return;
      if (input === this.toInput) this.textInput.focus();
      else this.submit();
    } else if (input === this.textInput && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.sent.length) {
      e.preventDefault();
      const n = this.sent.length;
      this.sentIndex = e.key === 'ArrowUp' ? (this.sentIndex < 0 ? n - 1 : Math.max(0, this.sentIndex - 1)) : this.sentIndex < 0 ? -1 : this.sentIndex + 1;
      if (this.sentIndex >= n) this.sentIndex = -1;
      input.value = this.sentIndex < 0 ? '' : this.sent[this.sentIndex]!;
    }
  }

  private wasTyping = false;
  private typingChanged(): void {
    const now = this.typing;
    if (now === this.wasTyping) return;
    this.wasTyping = now;
    this.root.classList.toggle('chat-typing', now);
    this.onTyping(now);
  }

  /** Pointer drags on `handle` move or size the window (`apply` sets the box from the offset). */
  private drag(handle: HTMLElement, apply: (dx: number, dy: number, start: { x: number; y: number; w: number; h: number }) => void, accept: (e: PointerEvent) => boolean = () => true): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !accept(e)) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const start = { ...this.box };
      const x0 = e.clientX, y0 = e.clientY;
      const move = (m: PointerEvent) => {
        apply(m.clientX - x0, m.clientY - y0, start);
        this.applyBox();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  /** Keeps the window on screen and at least its minimum size. */
  private applyBox(): void {
    const vw = window.innerWidth, vh = window.innerHeight;
    const b = this.box;
    b.w = Math.round(Math.max(MIN_W, Math.min(b.w, vw - 8)));
    b.h = Math.round(Math.max(MIN_H, Math.min(b.h, vh - 8)));
    const h = this.minimized ? this.root.querySelector<HTMLElement>('.chat-head')!.offsetHeight || 28 : b.h;
    b.x = Math.round(Math.max(0, Math.min(b.x, vw - b.w)));
    b.y = Math.round(Math.max(0, Math.min(b.y, vh - h)));
    Object.assign(this.root.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: this.minimized ? '' : `${b.h}px` });
  }

  private save(): void {
    if (!this.box) return;
    const layout: Layout = { ...this.box, minimized: this.minimized, tab: this.tab };
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // Without storage the layout lasts this session only.
    }
  }
}
