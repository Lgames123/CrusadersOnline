import { areaName, type PartyMemberView } from '@crusaders/shared';

/**
 * The party frame (MMO Stage 2, not original): the other members, the leader marked, each with
 * a health bar while in this zone and seen, else the act they are in. Clicking a name whispers
 * them through `onWhisper`. Styles live here.
 */
const STYLE = `
#party-frame { position: fixed; left: 12px; top: 300px; z-index: 6; display: grid; gap: 4px; width: 170px; pointer-events: auto; font: 12px/1.2 Georgia, serif; color: #f0e6cc; }
#party-frame[hidden] { display: none; }
#party-frame .pf-member { padding: 4px 6px; background: rgba(12,11,9,.72); border: 1px solid #5d4a23; border-radius: 3px; cursor: pointer; }
#party-frame .pf-name { display: flex; justify-content: space-between; gap: 6px; text-shadow: 0 1px 1px #000; }
#party-frame .pf-leader::before { content: '♛ '; color: #f1d58e; }
#party-frame .pf-where { color: #a9b2c0; font-size: 11px; }
#party-frame .pf-bar { height: 5px; margin-top: 3px; background: #2a1414; border-radius: 2px; overflow: hidden; }
#party-frame .pf-bar > div { height: 100%; background: linear-gradient(#d24a3a, #8a2418); }
#party-frame .pf-away .pf-bar { display: none; }
`;

export class PartyFrame {
  private readonly root: HTMLElement;
  private members: PartyMemberView[] = [];
  private self = '';
  private readonly rows = new Map<string, { el: HTMLElement; where: HTMLElement; fill: HTMLElement }>();
  onWhisper: (name: string) => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'party-frame';
    this.root.hidden = true;
    document.body.append(this.root);
    // Below the classic HUD's mana coin (it ends at y 229 of its 640 × 480 screen, scaled to the window's height).
    const place = () => (this.root.style.top = `${Math.round((window.innerHeight / 480) * 236)}px`);
    window.addEventListener('resize', place);
    place();
  }

  set(members: PartyMemberView[], self: string): void {
    this.members = members;
    this.self = self.toLowerCase();
    this.root.replaceChildren();
    this.rows.clear();
    for (const m of members) {
      if (m.name.toLowerCase() === this.self) continue;
      const el = document.createElement('div');
      el.className = 'pf-member';
      el.title = `Whisper ${m.name}`;
      const name = document.createElement('div');
      name.className = 'pf-name';
      const label = document.createElement('span');
      label.textContent = m.name;
      if (m.leader) label.className = 'pf-leader';
      const where = document.createElement('span');
      where.className = 'pf-where';
      name.append(label, where);
      const bar = document.createElement('div');
      bar.className = 'pf-bar';
      const fill = document.createElement('div');
      bar.append(fill);
      el.append(name, bar);
      el.addEventListener('click', () => this.onWhisper(m.name));
      this.root.append(el);
      this.rows.set(m.name.toLowerCase(), { el, where, fill });
    }
    this.root.hidden = this.rows.size === 0;
  }

  /**
   * Each frame: `lookup` gives a member's health fraction when he is in this zone and seen,
   * else null; `zone` is the player's own arena.
   */
  update(zone: string, lookup: (name: string) => number | null): void {
    for (const m of this.members) {
      const row = this.rows.get(m.name.toLowerCase());
      if (!row) continue;
      const hp = m.zone === zone ? lookup(m.name) : null;
      row.el.classList.toggle('pf-away', hp === null);
      row.fill.style.width = `${Math.round(Math.max(0, Math.min(1, hp ?? 0)) * 100)}%`;
      const where = !m.zone ? 'offline' : m.zone === zone ? (hp === null ? 'nearby' : '') : areaName(m.zone);
      if (row.where.textContent !== where) row.where.textContent = where;
    }
  }
}
