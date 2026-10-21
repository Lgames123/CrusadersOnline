import { DUNGEON_READY_SECONDS, type DungeonReadyMsg, type DungeonResultMsg, type DungeonStateMsg } from '@crusaders/shared';

/**
 * Dungeon screens (MMO Stage 5, not original): the party's ready check before a run, the run's
 * objective tracker while inside, and the results when its boss falls. Styles live here.
 */
const STYLE = `
#dg-ready, #dg-result { position: fixed; z-index: 13; color: #f4e8c8; font: 14px/1.4 Georgia, 'Times New Roman', serif;
  border: 2px solid #8a6d32; border-radius: 6px; box-sizing: border-box;
  background: radial-gradient(ellipse at 50% 0%, rgba(90,40,30,.55), rgba(14,10,8,.96) 70%), #0e0a08; box-shadow: 0 0 0 1px #000, 0 12px 40px rgba(0,0,0,.8); }
#dg-ready[hidden], #dg-result-wrap[hidden], #dg-tracker[hidden] { display: none; }
#dg-ready { top: 90px; left: 50%; transform: translateX(-50%); width: min(380px, calc(100vw - 32px)); padding: 14px 16px; }
#dg-ready h2, #dg-result h2 { margin: 0 0 4px; font-size: 18px; font-weight: normal; color: #f1d58e; letter-spacing: .06em; text-shadow: 0 1px 2px #000; }
.dg-sub { color: #c9b98f; font-size: 13px; margin-bottom: 8px; }
#dg-ready .dg-bar { height: 5px; background: #2a1d10; border-radius: 3px; overflow: hidden; margin-bottom: 10px; }
#dg-ready .dg-bar > div { height: 100%; background: linear-gradient(90deg, #f1d58e, #b8862f); }
#dg-ready ul { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 3px; }
#dg-ready li { display: flex; justify-content: space-between; padding: 3px 8px; background: rgba(0,0,0,.3); border-radius: 3px; }
#dg-ready .yes { color: #8fe08a; } #dg-ready .no { color: #ff7a6a; } #dg-ready .wait { color: #9a8f78; }
#dg-ready .dg-note { color: #c9b98f; font-size: 12px; margin-bottom: 8px; }
.dg-buttons { display: flex; gap: 8px; justify-content: flex-end; }
.dg-buttons button { padding: 7px 14px; border-radius: 4px; font: inherit; cursor: pointer; border: 1px solid #6d5a30; background: rgba(40,30,16,.9); color: #f4e8c8; }
.dg-buttons button.dg-go { border-color: #5e9a4a; background: rgba(30,70,30,.9); }
.dg-buttons button.dg-stop { border-color: #a04a3a; background: rgba(80,24,18,.9); }
.dg-buttons button:hover { filter: brightness(1.25); }
#dg-tracker { position: fixed; right: 12px; top: 222px; z-index: 6; width: 240px; padding: 8px 10px; pointer-events: none;
  background: rgba(12,11,9,.72); border: 1px solid #5d4a23; border-radius: 4px; color: #f0e6cc; font: 12px/1.35 Georgia, serif; text-shadow: 0 1px 1px #000; }
#dg-tracker .dg-head { display: flex; justify-content: space-between; gap: 8px; color: #f1d58e; font-size: 13px; margin-bottom: 4px; }
#dg-tracker .dg-clock { color: #d8c69a; font-variant-numeric: tabular-nums; }
#dg-tracker .dg-obj { display: flex; gap: 6px; padding: 1px 0; }
#dg-tracker .dg-obj::before { content: '◇'; color: #b8a06a; }
#dg-tracker .dg-obj.done { color: #8fe08a; }
#dg-tracker .dg-obj.done::before { content: '◆'; color: #8fe08a; }
#dg-tracker .dg-obj small { color: #9a8f78; }
#dg-tracker .dg-boss { margin-top: 6px; }
#dg-tracker .dg-boss-bar { height: 6px; margin-top: 2px; background: #2a1414; border-radius: 3px; overflow: hidden; }
#dg-tracker .dg-boss-bar > div { height: 100%; background: linear-gradient(#d24a3a, #8a2418); transition: width .3s; }
#dg-result-wrap { position: fixed; inset: 0; z-index: 13; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.5); }
#dg-result { position: relative; width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 18px 20px; }
#dg-result .dg-time { font-size: 28px; color: #fff; margin: 6px 0 10px; font-variant-numeric: tabular-nums; }
#dg-result .dg-time small { display: block; font-size: 12px; color: #c9b98f; letter-spacing: .1em; text-transform: uppercase; }
#dg-result .dg-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
#dg-result .dg-stats div { padding: 6px; text-align: center; background: rgba(0,0,0,.35); border: 1px solid #3c3220; border-radius: 4px; }
#dg-result .dg-stats b { display: block; font-size: 17px; color: #f1d58e; font-weight: normal; }
#dg-result .dg-stats span { font-size: 11px; color: #a99c7c; text-transform: uppercase; letter-spacing: .06em; }
#dg-result h3 { margin: 0 0 6px; font-size: 14px; font-weight: normal; color: #f1d58e; }
#dg-result ul { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 3px; }
#dg-result li { padding: 4px 8px; background: rgba(0,0,0,.3); border-radius: 3px; }
#dg-result .dg-none, #dg-result .dg-party { color: #9a8f78; font-size: 12px; margin-bottom: 12px; }
`;

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class DungeonUi {
  private readonly ready: HTMLElement;
  private readonly tracker: HTMLElement;
  private readonly resultWrap: HTMLElement;
  private readonly result: HTMLElement;
  private check: { d: DungeonReadyMsg['d']; endsAt: number; answered: boolean } | null = null;
  private run: { d: DungeonStateMsg['d']; at: number } | null = null;
  private readonly clockEl = el('span', 'dg-clock');
  private readonly barFill = el('div');
  /** A yes or no to ready check `id`. */
  onAnswer: (id: number, yes: boolean) => void = () => {};
  /** The results screen's Leave dungeon. */
  onLeave: () => void = () => {};
  /** A screen that needs the mouse opened or closed (pointer lock). */
  onModal: (open: boolean) => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.ready = el('div');
    this.ready.id = 'dg-ready';
    this.ready.hidden = true;
    this.tracker = el('div');
    this.tracker.id = 'dg-tracker';
    this.tracker.hidden = true;
    this.resultWrap = el('div');
    this.resultWrap.id = 'dg-result-wrap';
    this.resultWrap.hidden = true;
    this.result = el('div');
    this.result.id = 'dg-result';
    this.result.setAttribute('role', 'dialog');
    this.resultWrap.append(this.result);
    document.body.append(this.ready, this.tracker, this.resultWrap);
  }

  /** Whether a screen that wants the mouse is up (the ready check awaiting this player's answer, the results). */
  get modal(): boolean {
    return (!!this.check && !this.check.answered) || !this.resultWrap.hidden;
  }

  /** A ready check opened, changed or closed. `self`: this player's name. */
  readyCheck(d: DungeonReadyMsg['d'], self: string): void {
    const was = this.modal;
    if (d.state === 'started' || d.state === 'cancelled') {
      this.check = null;
      this.ready.hidden = true;
    } else {
      const mine = d.members.find((m) => m.name.toLowerCase() === self.toLowerCase());
      this.check = { d, endsAt: performance.now() + d.seconds * 1000, answered: !mine || mine.answer !== null };
      this.drawReady();
    }
    if (this.modal !== was) this.onModal(this.modal);
  }

  private drawReady(): void {
    const c = this.check!;
    const list = el('ul');
    for (const m of c.d.members) {
      const li = el('li');
      const mark = m.answer === 'yes' ? el('span', 'yes', 'Ready') : m.answer === 'no' ? el('span', 'no', 'Not ready') : el('span', 'wait', '…');
      li.append(el('span', undefined, m.name), mark);
      list.append(li);
    }
    const bar = el('div', 'dg-bar');
    bar.append(this.barFill);
    const children: HTMLElement[] = [el('h2', undefined, c.d.dungeon), el('div', 'dg-sub', `${c.d.leader} wants to enter. Ready?`), bar, list];
    if (!c.answered) {
      const buttons = el('div', 'dg-buttons');
      const no = el('button', 'dg-stop', 'Decline');
      const yes = el('button', 'dg-go', 'Ready');
      no.type = yes.type = 'button';
      no.addEventListener('click', () => this.answer(false));
      yes.addEventListener('click', () => this.answer(true));
      buttons.append(no, yes);
      children.push(el('div', 'dg-note', 'No answer in time counts as ready.'), buttons);
    } else children.push(el('div', 'dg-note', 'Waiting for the party…'));
    this.ready.replaceChildren(...children);
    this.ready.hidden = false;
    this.tickReady();
  }

  private answer(yes: boolean): void {
    const c = this.check;
    if (!c || c.answered) return;
    c.answered = true;
    this.onAnswer(c.d.id, yes);
    this.drawReady();
    this.onModal(this.modal);
  }

  private tickReady(): void {
    const c = this.check;
    if (!c) return;
    const left = Math.max(0, (c.endsAt - performance.now()) / 1000);
    this.barFill.style.width = `${Math.min(100, (left / DUNGEON_READY_SECONDS) * 100)}%`;
  }

  /** The run's tracker (a dungeon zone sends it on arrival and at every change). */
  state(d: DungeonStateMsg['d']): void {
    this.run = { d, at: performance.now() };
    const head = el('div', 'dg-head');
    head.append(el('span', undefined, d.dungeon), this.clockEl);
    const rows: HTMLElement[] = [head];
    for (const o of d.objectives) {
      const row = el('div', `dg-obj${o.done ? ' done' : ''}`);
      const text = el('span', undefined, o.text);
      if (o.total !== undefined) text.append(` ${o.count ?? 0}/${o.total}`);
      if (o.bonus) text.append(' ', el('small', undefined, '(bonus)'));
      row.append(text);
      rows.push(row);
    }
    if (d.boss) {
      const boss = el('div', 'dg-boss', `${d.boss.name} — phase ${d.boss.phase}`);
      const bar = el('div', 'dg-boss-bar');
      const fill = el('div');
      fill.style.width = `${Math.round(d.boss.hp * 100)}%`;
      bar.append(fill);
      boss.append(bar);
      rows.push(boss);
    }
    this.tracker.replaceChildren(...rows);
    this.tracker.hidden = false;
    this.update();
  }

  /** The boss fell: this player's results. */
  results(d: DungeonResultMsg['d']): void {
    const was = this.modal;
    const stats = el('div', 'dg-stats');
    for (const [v, label] of [[d.kills, 'Kills'], [d.deaths, 'Deaths'], [d.xp, 'Experience'], [d.gold, 'Gold']] as const) {
      const box = el('div');
      box.append(el('b', undefined, v.toLocaleString()), el('span', undefined, label));
      stats.append(box);
    }
    const time = el('div', 'dg-time', clock(d.seconds));
    time.prepend(el('small', undefined, 'Time to complete'));
    const items = el('ul');
    for (const it of d.items) {
      const li = el('li', undefined, it.quantity > 1 ? `${it.quantity} × ${it.name}` : it.name);
      if (it.color) li.style.color = it.color;
      items.append(li);
    }
    const buttons = el('div', 'dg-buttons');
    const stay = el('button', undefined, 'Stay');
    const leave = el('button', 'dg-go', 'Leave dungeon');
    stay.type = leave.type = 'button';
    stay.addEventListener('click', () => this.closeResults());
    leave.addEventListener('click', () => {
      this.closeResults();
      this.onLeave();
    });
    buttons.append(stay, leave);
    this.result.replaceChildren(
      el('h2', undefined, 'Dungeon complete'),
      el('div', 'dg-sub', d.dungeon),
      time,
      stats,
      el('h3', undefined, 'Loot'),
      ...(d.items.length ? [items] : [el('div', 'dg-none', 'Nothing dropped for you.')]),
      ...(d.treasure ? [] : [el('div', 'dg-none', "You already claimed this boss's treasure today: experience only.")]),
      el('div', 'dg-party', `Party: ${d.party.join(', ')}`),
      buttons,
    );
    this.resultWrap.hidden = false;
    if (this.modal !== was) this.onModal(this.modal);
  }

  private closeResults(): void {
    const was = this.modal;
    this.resultWrap.hidden = true;
    if (this.modal !== was) this.onModal(this.modal);
  }

  /** Left the dungeon (or entered any zone): the tracker and results go. */
  reset(): void {
    const was = this.modal;
    this.run = null;
    this.tracker.hidden = true;
    this.resultWrap.hidden = true;
    if (this.modal !== was) this.onModal(this.modal);
  }

  /** Each frame: the clocks. */
  update(): void {
    this.tickReady();
    const r = this.run;
    if (!r) return;
    this.clockEl.textContent = clock(r.d.finished ?? r.d.elapsed + (performance.now() - r.at) / 1000);
  }
}
