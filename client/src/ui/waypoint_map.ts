import {
  DUNGEONS,
  DUNGEON_ENTRY_PREFIX,
  WAYPOINT_CHAPTERS,
  WAYPOINT_REGIONS,
  WAYPOINT_ROADS,
  waypointChapter,
  waypointLabel,
  waypointRegion,
  type WaypointRegion,
} from '@crusaders/shared';

/**
 * The waypoint map (not original): opened with the use key at a teleport crystal by a character
 * who finished the story. Chapter tabs (an act of a place per chapter: Cador Sul is a different
 * act in each), a schematic map of the regions and their roads, and the areas of the picked
 * region; clicking an area travels there. Styles live here, not in index.html.
 */
const STYLE = `
#waypoint-map { position: fixed; inset: 0; z-index: 12; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); }
#waypoint-map[hidden] { display: none; }
#waypoint-map .wm-panel { position: relative; width: min(880px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box;
  padding: 18px 20px 20px; border: 2px solid #8a6d32; border-radius: 6px; color: #f4e8c8; font: 14px/1.4 Georgia, 'Times New Roman', serif;
  background: radial-gradient(ellipse at 50% 0%, rgba(40,70,110,.55), rgba(10,14,22,.96) 70%), #0b0f16; box-shadow: 0 0 0 1px #000, 0 12px 40px rgba(0,0,0,.8), inset 0 0 40px rgba(60,140,255,.12); }
#waypoint-map .wm-head { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
#waypoint-map .wm-head img { width: 54px; height: auto; filter: drop-shadow(0 0 10px rgba(80,170,255,.6)); }
#waypoint-map .wm-title { font-size: 22px; letter-spacing: .08em; color: #f1d58e; text-shadow: 0 1px 2px #000; }
#waypoint-map .wm-here { color: #a9c7e8; font-size: 13px; }
#waypoint-map .wm-close { position: absolute; top: 10px; right: 12px; background: none; border: 0; color: #d8c69a; font-size: 22px; cursor: pointer; }
#waypoint-map .wm-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
#waypoint-map .wm-tab { flex: 1 1 140px; padding: 6px 8px; border: 1px solid #5d4a23; border-radius: 4px; background: rgba(30,24,14,.8); color: #d8c69a; cursor: pointer; font: inherit; text-align: left; }
#waypoint-map .wm-tab b { display: block; color: #f1d58e; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }
#waypoint-map .wm-tab[aria-selected="true"] { border-color: #6fb6ff; background: rgba(30,60,100,.75); color: #fff; box-shadow: 0 0 10px rgba(80,170,255,.35); }
#waypoint-map .wm-body { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 14px; }
@media (max-width: 640px) { #waypoint-map .wm-body { grid-template-columns: 1fr; } }
#waypoint-map svg { width: 100%; height: auto; display: block; background: rgba(0,0,0,.35); border: 1px solid #3c3220; border-radius: 4px; }
#waypoint-map .wm-road { stroke: #5d4a23; stroke-width: .7; stroke-dasharray: 1.6 1.2; }
#waypoint-map .wm-node { cursor: pointer; }
#waypoint-map .wm-node circle { fill: #2a2418; stroke: #6d5a30; stroke-width: .6; }
#waypoint-map .wm-node text { fill: #8f846a; font-size: 3.4px; text-anchor: middle; font-family: Georgia, serif; pointer-events: none; }
#waypoint-map .wm-node.open circle { fill: #1d4f86; stroke: #8fd0ff; }
#waypoint-map .wm-node.open text { fill: #f4e8c8; }
#waypoint-map .wm-node.picked circle { fill: #3d8fe0; stroke: #fff; stroke-width: .9; }
#waypoint-map .wm-node.here circle { stroke: #f1d58e; stroke-width: 1.1; }
#waypoint-map .wm-list h3 { margin: 0 0 8px; color: #f1d58e; font-size: 16px; font-weight: normal; }
#waypoint-map .wm-list p { margin: 0; color: #9a8f78; }
#waypoint-map .wm-area { display: block; width: 100%; margin-bottom: 6px; padding: 7px 10px; border: 1px solid #3f5f86; border-radius: 4px; background: rgba(20,40,70,.7); color: #e8f2ff; font: inherit; text-align: left; cursor: pointer; }
#waypoint-map .wm-area:hover:not(:disabled) { border-color: #8fd0ff; background: rgba(40,90,150,.8); }
#waypoint-map .wm-area:disabled { opacity: .55; cursor: default; }
#waypoint-map .wm-area small { float: right; color: #a9c7e8; }
#waypoint-map .wm-dungeons { margin-top: 12px; }
#waypoint-map .wm-dungeons[hidden] { display: none; }
`;

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

export class WaypointMap {
  private readonly root: HTMLElement;
  private readonly here: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly list: HTMLElement;
  private readonly dungeonBar: HTMLElement;
  private current: string | null = null;
  private chapter = 1;
  private region: WaypointRegion | null = null;
  onClose: () => void = () => {};
  onTravel: (act: string) => void = () => {};

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'waypoint-map';
    this.root.hidden = true;
    this.root.innerHTML = `<div class="wm-panel" role="dialog" aria-label="Waypoint">
      <button class="wm-close" aria-label="Close">×</button>
      <div class="wm-head"><img src="/waypoint-crystal.webp" alt="" draggable="false" /><div><div class="wm-title">Waypoint</div><div class="wm-here"></div></div></div>
      <div class="wm-tabs" role="tablist"></div>
      <div class="wm-body"><svg viewBox="-8 -4 116 104" preserveAspectRatio="xMidYMid meet"></svg><div class="wm-list"></div></div>
    </div>`;
    document.body.append(this.root);
    this.here = this.root.querySelector('.wm-here')!;
    this.tabs = this.root.querySelector('.wm-tabs')!;
    this.svg = this.root.querySelector('svg')!;
    this.list = this.root.querySelector('.wm-list')!;
    this.dungeonBar = document.createElement('div');
    this.dungeonBar.className = 'wm-list wm-dungeons';
    this.dungeonBar.hidden = true;
    this.root.querySelector('.wm-panel')!.append(this.dungeonBar);
    this.root.querySelector('.wm-close')!.addEventListener('click', () => this.onClose());
    this.root.addEventListener('click', (e) => e.target === this.root && this.onClose());
    for (const c of WAYPOINT_CHAPTERS) {
      const b = document.createElement('button');
      b.className = 'wm-tab';
      b.setAttribute('role', 'tab');
      b.innerHTML = `<b>Act ${ROMAN[c.act]}</b>${c.title}`;
      b.addEventListener('click', () => {
        this.chapter = c.act;
        this.region = null;
        this.render();
      });
      this.tabs.append(b);
    }
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Opens on the chapter and region of the act the player stands in. */
  /** MMO dungeons (the server's `mmoDungeons`): entries under the map. */
  set dungeons(on: boolean) {
    this.dungeonBar.hidden = !on;
    this.dungeonBar.replaceChildren();
    if (!on) return;
    const h = document.createElement('h3');
    h.textContent = 'Dungeons (your party comes with you)';
    this.dungeonBar.append(h);
    for (const d of DUNGEONS) {
      const b = document.createElement('button');
      b.className = 'wm-area';
      b.innerHTML = `${d.name}<small>up to ${d.maxParty}</small>`;
      b.addEventListener('click', () => this.onTravel(`${DUNGEON_ENTRY_PREFIX}${d.id}`));
      this.dungeonBar.append(b);
    }
  }

  show(act: string): void {
    this.current = act;
    this.chapter = waypointChapter(act)?.act ?? 1;
    this.region = waypointRegion(act);
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const chapter = WAYPOINT_CHAPTERS.find((c) => c.act === this.chapter)!;
    const here = this.current;
    this.here.textContent = here ? `You are at ${waypointLabel(here)} (Act ${ROMAN[waypointChapter(here)?.act ?? 0] ?? ''})` : '';
    [...this.tabs.children].forEach((b, i) => b.setAttribute('aria-selected', String(WAYPOINT_CHAPTERS[i]!.act === this.chapter)));
    const open = new Set(chapter.acts.map(waypointRegion));
    if (this.region && !open.has(this.region)) this.region = null;
    const ns = 'http://www.w3.org/2000/svg';
    this.svg.replaceChildren();
    for (const [a, b] of WAYPOINT_ROADS) {
      const p = WAYPOINT_REGIONS[a], q = WAYPOINT_REGIONS[b];
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', 'wm-road');
      line.setAttribute('x1', String(p.x));
      line.setAttribute('y1', String(p.y));
      line.setAttribute('x2', String(q.x));
      line.setAttribute('y2', String(q.y));
      this.svg.append(line);
    }
    for (const [key, info] of Object.entries(WAYPOINT_REGIONS) as [WaypointRegion, (typeof WAYPOINT_REGIONS)[WaypointRegion]][]) {
      const g = document.createElementNS(ns, 'g');
      const cls = ['wm-node'];
      if (open.has(key)) cls.push('open');
      if (key === this.region) cls.push('picked');
      if (here && waypointRegion(here) === key && waypointChapter(here)?.act === this.chapter) cls.push('here');
      g.setAttribute('class', cls.join(' '));
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(info.x));
      c.setAttribute('cy', String(info.y));
      c.setAttribute('r', '3.2');
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('x', String(info.x));
      t.setAttribute('y', String(info.y + 7));
      t.textContent = info.name.replace(/^The /, '');
      const title = document.createElementNS(ns, 'title');
      title.textContent = info.name;
      g.append(c, t, title);
      if (open.has(key)) {
        g.addEventListener('click', () => {
          this.region = key;
          this.render();
        });
      }
      this.svg.append(g);
    }
    this.list.replaceChildren();
    const h = document.createElement('h3');
    if (!this.region) {
      h.textContent = chapter.title;
      const p = document.createElement('p');
      p.textContent = 'Pick a lit place on the map.';
      this.list.append(h, p);
      return;
    }
    h.textContent = WAYPOINT_REGIONS[this.region].name;
    this.list.append(h);
    for (const act of chapter.acts.filter((a) => waypointRegion(a) === this.region)) {
      const b = document.createElement('button');
      b.className = 'wm-area';
      b.disabled = act === here;
      b.innerHTML = `${waypointLabel(act)}<small>${act === here ? 'you are here' : act.toUpperCase()}</small>`;
      b.addEventListener('click', () => this.onTravel(act));
      this.list.append(b);
    }
  }
}
