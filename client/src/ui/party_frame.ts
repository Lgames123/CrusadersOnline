import { areaName, type PartyMemberView } from '@crusaders/shared';

/**
 * The party frame and the invitation popup (MMO Stage 2, not original). The frame lists the
 * other members as MMOs do: name, level, the leader's crown, a health bar with its numbers and
 * a thin mana bar, greyed when dead, away (another area, named) or offline. Health comes from
 * the snapshots while the member is seen here (smooth), else from the server's party update
 * (twice a second, any zone). Left click whispers, right click opens the member menu
 * (whisper, promote, remove, leave). Styles live here.
 */
const STYLE = `
#party-frame { position: fixed; left: 12px; top: 300px; z-index: 6; display: grid; gap: 3px; width: 196px; pointer-events: auto; font: 12px/1.2 Georgia, serif; color: #f0e6cc; user-select: none; }
#party-frame[hidden] { display: none; }
#party-frame .pf-head { display: flex; justify-content: space-between; align-items: center; padding: 0 2px 1px; color: #c9b98f; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; text-shadow: 0 1px 1px #000; }
#party-frame .pf-head button { padding: 0 5px; font: 11px Georgia, serif; color: #c9b98f; background: rgba(12,11,9,.72); border: 1px solid #5d4a23; border-radius: 3px; cursor: pointer; }
#party-frame .pf-head button:hover { color: #fff; border-color: #a04a3a; }
#party-frame .pf-member { display: grid; grid-template-columns: 26px 1fr; gap: 0 6px; align-items: center; padding: 4px 6px; background: rgba(12,11,9,.78); border: 1px solid #5d4a23; border-radius: 3px; cursor: pointer; }
#party-frame .pf-member:hover { border-color: #b8a06a; }
#party-frame .pf-lvl { grid-row: span 3; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: radial-gradient(#3a2c14, #17110a); border: 1px solid #8a6d32; color: #f1d58e; font-size: 11px; font-variant-numeric: tabular-nums; }
#party-frame .pf-name { display: flex; justify-content: space-between; gap: 6px; min-width: 0; text-shadow: 0 1px 1px #000; }
#party-frame .pf-name > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#party-frame .pf-leader::before { content: '♛ '; color: #f1d58e; }
#party-frame .pf-where { flex: none; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #a9b2c0; font-size: 11px; }
#party-frame .pf-hp { position: relative; height: 11px; margin-top: 2px; background: #2a1414; border: 1px solid #000; border-radius: 2px; overflow: hidden; }
#party-frame .pf-hp > div { height: 100%; background: linear-gradient(#e0583f, #8a2418); transition: width .25s linear; }
#party-frame .pf-hp > span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 9px/1 Verdana, sans-serif; color: #fff; text-shadow: 0 0 2px #000, 0 0 2px #000; font-variant-numeric: tabular-nums; }
#party-frame .pf-mp { height: 4px; margin-top: 1px; background: #10162a; border: 1px solid #000; border-radius: 2px; overflow: hidden; }
#party-frame .pf-mp > div { height: 100%; background: linear-gradient(#5a8ae0, #23408a); transition: width .25s linear; }
#party-frame .pf-member.pf-low .pf-hp > div { background: linear-gradient(#ff3a2a, #a01010); }
#party-frame .pf-member.pf-dead, #party-frame .pf-member.pf-away, #party-frame .pf-member.pf-offline { opacity: .6; }
#party-frame .pf-member.pf-dead .pf-hp > div, #party-frame .pf-member.pf-offline .pf-hp > div, #party-frame .pf-member.pf-offline .pf-mp > div { width: 0 !important; }
#party-frame .pf-member.pf-dead .pf-where { color: #ff7a6a; }
#party-menu { position: fixed; z-index: 14; min-width: 130px; padding: 3px; background: rgba(14,10,8,.97); border: 1px solid #8a6d32; border-radius: 4px; box-shadow: 0 6px 18px rgba(0,0,0,.7); font: 12px/1.2 Georgia, serif; color: #f0e6cc; }
#party-menu[hidden] { display: none; }
#party-menu .pm-title { padding: 4px 8px; color: #f1d58e; border-bottom: 1px solid #3c3220; margin-bottom: 2px; }
#party-menu button { display: block; width: 100%; padding: 5px 8px; text-align: left; font: inherit; color: inherit; background: none; border: 0; border-radius: 3px; cursor: pointer; }
#party-menu button:hover { background: rgba(138,109,50,.35); }
#party-menu button.pm-bad { color: #ff9a8a; }
#party-invite { position: fixed; z-index: 13; top: 90px; left: 50%; transform: translateX(-50%); width: min(340px, calc(100vw - 32px)); box-sizing: border-box; padding: 14px 16px;
  color: #f4e8c8; font: 14px/1.4 Georgia, 'Times New Roman', serif; border: 2px solid #8a6d32; border-radius: 6px;
  background: radial-gradient(ellipse at 50% 0%, rgba(90,40,30,.55), rgba(14,10,8,.96) 70%), #0e0a08; box-shadow: 0 0 0 1px #000, 0 12px 40px rgba(0,0,0,.8); }
#party-invite[hidden] { display: none; }
#party-invite h2 { margin: 0 0 4px; font-size: 18px; font-weight: normal; color: #f1d58e; letter-spacing: .06em; text-shadow: 0 1px 2px #000; }
#party-invite p { margin: 0 0 8px; color: #c9b98f; }
#party-invite p b { color: #fff; font-weight: normal; }
#party-invite .pi-bar { height: 5px; background: #2a1d10; border-radius: 3px; overflow: hidden; margin-bottom: 12px; }
#party-invite .pi-bar > div { height: 100%; background: linear-gradient(90deg, #f1d58e, #b8862f); }
#party-invite .pi-buttons { display: flex; gap: 8px; justify-content: flex-end; }
#party-invite button { padding: 7px 14px; border-radius: 4px; font: inherit; cursor: pointer; border: 1px solid #6d5a30; background: rgba(40,30,16,.9); color: #f4e8c8; }
#party-invite button.pi-yes { border-color: #5e9a4a; background: rgba(30,70,30,.9); }
#party-invite button.pi-no { border-color: #a04a3a; background: rgba(80,24,18,.9); }
#party-invite button:hover { filter: brightness(1.25); }
`;

let styled = false;
const addStyle = () => {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Below this health fraction a member's bar turns bright red. */
const LOW_HP = 0.3;

interface Row {
  el: HTMLElement;
  lvl: HTMLElement;
  label: HTMLElement;
  where: HTMLElement;
  hpFill: HTMLElement;
  hpText: HTMLElement;
  mpFill: HTMLElement;
}

export type PartyMenuAction = 'whisper' | 'promote' | 'kick' | 'leave';

export class PartyFrame {
  private readonly root: HTMLElement;
  private readonly head = el('span');
  private readonly menu: HTMLElement;
  private members: PartyMemberView[] = [];
  private self = '';
  private readonly rows = new Map<string, Row>();
  onWhisper: (name: string) => void = () => {};
  /** A member menu choice (`name` is the member's; for 'leave', this player's own). */
  onAction: (action: PartyMenuAction, name: string) => void = () => {};

  constructor() {
    addStyle();
    this.root = el('div');
    this.root.id = 'party-frame';
    this.root.hidden = true;
    const top = el('div', 'pf-head');
    const leave = el('button', undefined, 'Leave');
    leave.title = 'Leave the party';
    leave.addEventListener('click', () => this.onAction('leave', this.self));
    top.append(this.head, leave);
    this.root.append(top);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.menu = el('div');
    this.menu.id = 'party-menu';
    this.menu.hidden = true;
    document.body.append(this.root, this.menu);
    window.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.menu.contains(e.target as Node)) this.menu.hidden = true;
    });
    // Below the classic HUD's mana coin (it ends at y 229 of its 640 × 480 screen, scaled to the window's height).
    const place = () => (this.root.style.top = `${Math.round((window.innerHeight / 480) * 236)}px`);
    window.addEventListener('resize', place);
    place();
  }

  private get leading(): boolean {
    return this.members.find((m) => m.leader)?.name.toLowerCase() === this.self;
  }

  set(members: PartyMemberView[], self: string): void {
    const names = (list: PartyMemberView[]) => list.map((m) => `${m.name}|${m.leader}`).join(',');
    const rebuild = names(members) !== names(this.members) || self.toLowerCase() !== this.self;
    this.members = members;
    this.self = self.toLowerCase();
    if (!rebuild) return;
    this.menu.hidden = true;
    for (const r of this.rows.values()) r.el.remove();
    this.rows.clear();
    for (const m of members) {
      if (m.name.toLowerCase() === this.self) continue;
      const row = el('div', 'pf-member');
      row.title = `${m.name}: click to whisper, right-click for more`;
      const lvl = el('div', 'pf-lvl');
      const name = el('div', 'pf-name');
      const label = el('span', m.leader ? 'pf-leader' : undefined, m.name);
      const where = el('span', 'pf-where');
      name.append(label, where);
      const hp = el('div', 'pf-hp');
      const hpFill = el('div');
      const hpText = el('span');
      hp.append(hpFill, hpText);
      const mp = el('div', 'pf-mp');
      const mpFill = el('div');
      mp.append(mpFill);
      row.append(lvl, name, hp, mp);
      row.addEventListener('click', () => this.onWhisper(m.name));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.openMenu(m.name, e.clientX, e.clientY);
      });
      this.root.append(row);
      this.rows.set(m.name.toLowerCase(), { el: row, lvl, label, where, hpFill, hpText, mpFill });
    }
    this.head.textContent = `Party ${members.length}/5`;
    this.root.hidden = this.rows.size === 0;
  }

  private openMenu(name: string, x: number, y: number): void {
    this.menu.replaceChildren(el('div', 'pm-title', name));
    const item = (text: string, action: PartyMenuAction, bad = false) => {
      const b = el('button', bad ? 'pm-bad' : undefined, text);
      b.addEventListener('click', () => {
        this.menu.hidden = true;
        this.onAction(action, action === 'leave' ? this.self : name);
      });
      this.menu.append(b);
    };
    item('Whisper', 'whisper');
    if (this.leading) {
      item('Make leader', 'promote');
      item('Remove from party', 'kick', true);
    }
    item('Leave party', 'leave', true);
    this.menu.hidden = false;
    const r = this.menu.getBoundingClientRect();
    this.menu.style.left = `${Math.min(x, window.innerWidth - r.width - 4)}px`;
    this.menu.style.top = `${Math.min(y, window.innerHeight - r.height - 4)}px`;
  }

  /**
   * Each frame: `lookup` gives a member's health fraction when he is in this zone and seen,
   * else null; `zone` is the player's own arena.
   */
  update(zone: string, lookup: (name: string) => number | null): void {
    for (const m of this.members) {
      const row = this.rows.get(m.name.toLowerCase());
      if (!row) continue;
      const offline = !m.zone;
      const here = m.zone === zone;
      const seen = here ? lookup(m.name) : null;
      const max = m.maxHp ?? 0;
      // Seen here: the snapshot's fraction (smooth); else the server's numbers.
      const frac = seen ?? (max > 0 ? (m.hp ?? 0) / max : null);
      const dead = !offline && (m.dead === true || (seen !== null && seen <= 0));
      row.el.classList.toggle('pf-offline', offline);
      row.el.classList.toggle('pf-away', !offline && !here);
      row.el.classList.toggle('pf-dead', dead);
      row.el.classList.toggle('pf-low', !dead && frac !== null && frac < LOW_HP);
      const pct = (v: number | null) => `${Math.round(Math.max(0, Math.min(1, v ?? 0)) * 100)}%`;
      row.hpFill.style.width = pct(frac);
      row.mpFill.style.width = pct(m.maxMana ? (m.mana ?? 0) / m.maxMana : 0);
      const hpText = offline ? '' : dead ? 'Dead' : max > 0 ? `${Math.round(frac! * max)} / ${max}` : frac !== null ? pct(frac) : '';
      if (row.hpText.textContent !== hpText) row.hpText.textContent = hpText;
      const lvl = m.level ? String(m.level) : '–';
      if (row.lvl.textContent !== lvl) row.lvl.textContent = lvl;
      const where = offline ? 'offline' : dead ? 'dead' : here ? '' : areaName(m.zone!);
      if (row.where.textContent !== where) row.where.textContent = where;
      if (row.where.title !== where) row.where.title = where;
    }
  }
}

/**
 * The invitation popup: "<name> invites you to join their party", Accept / Decline and the time
 * left before it lapses (the server's 60 s). /accept and /decline in chat still work.
 */
export class PartyInvite {
  private readonly root: HTMLElement;
  private readonly text = el('p');
  private readonly fill = el('div');
  private pending: { from: string; endsAt: number; seconds: number } | null = null;
  /** The answer (Accept true, Decline or lapse false). */
  onAnswer: (yes: boolean) => void = () => {};
  /** The popup opened or closed (it wants the mouse). */
  onModal: (open: boolean) => void = () => {};

  constructor() {
    addStyle();
    this.root = el('div');
    this.root.id = 'party-invite';
    this.root.setAttribute('role', 'dialog');
    this.root.hidden = true;
    const bar = el('div', 'pi-bar');
    bar.append(this.fill);
    const buttons = el('div', 'pi-buttons');
    const no = el('button', 'pi-no', 'Decline');
    const yes = el('button', 'pi-yes', 'Accept');
    no.addEventListener('click', () => this.answer(false));
    yes.addEventListener('click', () => this.answer(true));
    buttons.append(no, yes);
    this.root.append(el('h2', undefined, 'Party invitation'), this.text, bar, buttons);
    document.body.append(this.root);
  }

  get modal(): boolean {
    return this.pending !== null;
  }

  show(from: string, seconds = 60): void {
    const was = this.modal;
    this.pending = { from, endsAt: performance.now() + seconds * 1000, seconds };
    const who = el('b', undefined, from);
    this.text.replaceChildren(who, ' invites you to join their party.');
    this.root.hidden = false;
    this.update();
    if (!was) this.onModal(true);
  }

  /** Closes the popup without answering (answered in chat, or joined). */
  close(): void {
    if (!this.pending) return;
    this.pending = null;
    this.root.hidden = true;
    this.onModal(false);
  }

  private answer(yes: boolean): void {
    if (!this.pending) return;
    this.close();
    this.onAnswer(yes);
  }

  /** Each frame: the time bar; a lapsed invitation closes (the server drops it too). */
  update(): void {
    if (!this.pending) return;
    const left = (this.pending.endsAt - performance.now()) / 1000;
    if (left <= 0) return this.close();
    this.fill.style.width = `${(left / this.pending.seconds) * 100}%`;
  }
}
