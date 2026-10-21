import { lineOfSight, PLAYER_HEIGHT, type ArenaDef, type MovementWorld } from '@crusaders/shared';

/**
 * Minimap and area map (not original: the original's M key was reserved and does nothing).
 *
 * The layout is drawn from the level's own collision mesh: walkable faces (normal up) filled,
 * steep faces drawn as wall lines, seen from above. Floors stacked over another floor (a ray
 * down from their middle meets more level) show only once the player is up there, so a
 * corridor is not hidden under the storey above it; ground with nothing below (terrain, the
 * lowest floor) always shows, darker the farther below the player it lies.
 *
 * The corner map turns with the player (or stays north-up: click its N), zooms with − / +; M
 * opens the whole area, north-up, to drag and zoom, with a legend and the exits named.
 */

export type MinimapMarkKind = 'party' | 'player' | 'hostile' | 'npc' | 'ally' | 'merchant' | 'exit' | 'crystal' | 'loot';

export interface MinimapMark {
  kind: MinimapMarkKind;
  x: number;
  y: number;
  z: number;
  /** Loot: its rarity colour; exits: where they lead (the area map labels them). */
  color?: string;
  label?: string;
}

export interface MinimapFrame {
  player: { x: number; y: number; z: number; yaw: number };
  marks: MinimapMark[];
}

const MARK_STYLE: Record<MinimapMarkKind, { color: string; label: string }> = {
  party: { color: '#5fe08a', label: 'Party member' },
  player: { color: '#7fb8ff', label: 'Other player' },
  hostile: { color: '#ff5a4a', label: 'Enemy in sight' },
  npc: { color: '#ffd75e', label: 'Townsfolk' },
  ally: { color: '#a8f0ff', label: 'Ally' },
  merchant: { color: '#ffb347', label: 'Merchant' },
  exit: { color: '#7fd0ff', label: 'Exit' },
  crystal: { color: '#c58bff', label: 'Waypoint crystal' },
  loot: { color: '#ffffff', label: 'Rare loot' },
};

/** Floors more than this above the feet are another storey (shown only when stacked over nothing). */
const HEAD_ROOM = 2.6;
/** Floors deeper than this under the player are not drawn. */
const DEEP_BELOW = 25;
/** Rebuild the layout when the player's height moves this far from the last build. */
const REBUILD_STEP = 1.5;
/** Corner map: metres from the centre to the edge, per zoom step. */
const ZOOMS = [15, 25, 40, 65];
/** Hostile creatures show only in sight and this near. */
const HOSTILE_RANGE = 40;
const STORE_KEY = 'crusaders.minimap';

interface Tri {
  /** x0 z0 x1 z1 x2 z2 */
  p: [number, number, number, number, number, number];
  y: number;
  stacked: boolean;
}

interface Wall {
  a: [number, number];
  b: [number, number];
  y0: number;
  y1: number;
}

const STYLE = `
#minimap { position: fixed; top: 10px; right: 12px; z-index: 6; width: 172px; user-select: none; pointer-events: none; font: 12px/1.2 Georgia, serif; color: #f0e6cc; }
#minimap .mm-title { text-align: center; margin-bottom: 4px; color: #e2bd63; text-shadow: 0 1px 2px #000, 0 0 6px #000; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#minimap .mm-disc { position: relative; width: 172px; height: 172px; border-radius: 50%; box-shadow: 0 0 0 2px #8a6d32, 0 0 0 4px rgba(0,0,0,.6), 0 6px 18px rgba(0,0,0,.6); background: #15110c; }
#minimap canvas { width: 100%; height: 100%; display: block; border-radius: 50%; }
#minimap button { position: absolute; pointer-events: auto; width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 1px solid #8a6d32; background: rgba(20,15,10,.92); color: #f0e6cc; font: 700 13px/1 system-ui, sans-serif; cursor: pointer; box-shadow: 0 1px 4px #000; }
#minimap button:hover { border-color: #ffd36a; color: #ffd36a; }
#minimap .mm-north { width: 18px; height: 18px; font-size: 10px; transform: translate(-50%, -50%); color: #ff8a70; }
#minimap .mm-north.fixed { color: #ffd36a; }
#minimap .mm-in { right: -6px; bottom: 30px; }
#minimap .mm-out { right: 14px; bottom: 4px; }
#minimap .mm-open { left: -6px; bottom: 30px; font-size: 11px; }
#area-map { position: fixed; inset: 0; z-index: 12; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); }
#area-map[hidden], #minimap[hidden] { display: none; }
#area-map .am-panel { display: flex; flex-direction: column; width: min(1000px, calc(100vw - 32px)); height: min(760px, calc(100vh - 32px)); background: rgba(16,12,9,.97); border: 1px solid #8a6d32; border-radius: 4px; box-shadow: 0 20px 60px rgba(0,0,0,.8); color: #f0e6cc; font: 13px/1.3 system-ui, sans-serif; }
#area-map header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid rgba(138,109,50,.5); }
#area-map h2 { margin: 0; flex: 1; color: #e2bd63; font: 600 18px/1.2 'Palatino Linotype', Georgia, serif; letter-spacing: .06em; }
#area-map .am-hint { color: #9a8f78; font-size: 12px; }
#area-map header button { padding: 5px 10px; border: 1px solid #8a7445; background: #3a2f1c; color: #f0e6cc; cursor: pointer; }
#area-map canvas { flex: 1; min-height: 0; width: 100%; cursor: grab; touch-action: none; }
#area-map canvas:active { cursor: grabbing; }
#area-map .am-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; padding: 8px 14px; list-style: none; border-top: 1px solid rgba(138,109,50,.5); color: #cfc5ae; font-size: 12px; }
#area-map .am-legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 50%; border: 1px solid #000; vertical-align: -1px; }
#area-map .am-legend i.am-you { border-radius: 0; background: #fff3c4; clip-path: polygon(50% 0, 100% 100%, 50% 75%, 0 100%); border: 0; }
`;

export class Minimap {
  private readonly root: HTMLElement;
  private readonly mini: HTMLCanvasElement;
  private readonly title: HTMLElement;
  private readonly big: HTMLElement;
  private readonly bigCanvas: HTMLCanvasElement;
  private readonly bigTitle: HTMLElement;
  private tris: Tri[] = [];
  private walls: Wall[] = [];
  private bounds = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 };
  private layout: HTMLCanvasElement | null = null;
  private layoutScale = 1;
  private layoutY = Number.NaN;
  private mw: MovementWorld | null = null;
  private frame: MinimapFrame | null = null;
  private zoom = 1;
  private rotate = true;
  private since = 0;
  /** Area map view: centre (world x, z) and pixels per metre; null = fit the area. */
  private view: { x: number; z: number; ppm: number } | null = null;
  private seen = new Map<string, { at: number; seen: boolean }>();
  /** Shown at all (the settings' switch) and while in the world. */
  private enabled = true;
  private active = false;
  onClose: () => void = () => {};

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { zoom?: number; rotate?: boolean } | null;
      if (s && typeof s.zoom === 'number') this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, Math.round(s.zoom)));
      if (s && typeof s.rotate === 'boolean') this.rotate = s.rotate;
    } catch {
      // No storage: defaults.
    }
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'minimap';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="mm-title"></div>
      <div class="mm-disc"><canvas></canvas>
        <button type="button" class="mm-north" title="North up / turn with you">N</button>
        <button type="button" class="mm-zoom mm-in" title="Zoom in">+</button>
        <button type="button" class="mm-zoom mm-out" title="Zoom out">−</button>
        <button type="button" class="mm-open" title="Area map (M)">M</button>
      </div>`;
    this.mini = this.root.querySelector('canvas')!;
    this.title = this.root.querySelector('.mm-title')!;
    this.root.querySelector('.mm-in')!.addEventListener('click', () => this.setZoom(this.zoom - 1));
    this.root.querySelector('.mm-out')!.addEventListener('click', () => this.setZoom(this.zoom + 1));
    this.root.querySelector('.mm-north')!.addEventListener('click', () => {
      this.rotate = !this.rotate;
      this.save();
      this.draw();
    });
    this.root.querySelector('.mm-open')!.addEventListener('click', () => this.setExpanded(true));
    document.body.appendChild(this.root);

    this.big = document.createElement('div');
    this.big.id = 'area-map';
    this.big.hidden = true;
    this.big.innerHTML = `
      <div class="am-panel">
        <header><h2></h2><span class="am-hint">Drag to move · wheel to zoom</span>
          <button type="button" class="am-centre">Centre on me</button><button type="button" class="am-close" title="Close (M / Esc)">✕</button></header>
        <canvas></canvas>
        <ul class="am-legend">${(['party', 'player', 'hostile', 'npc', 'merchant', 'exit', 'crystal', 'loot'] as MinimapMarkKind[])
          .map((k) => `<li><i style="background:${MARK_STYLE[k].color}"></i>${MARK_STYLE[k].label}</li>`)
          .join('')}<li><i class="am-you"></i>You</li></ul>
      </div>`;
    this.bigCanvas = this.big.querySelector('canvas')!;
    this.bigTitle = this.big.querySelector('h2')!;
    this.big.querySelector('.am-close')!.addEventListener('click', () => this.onClose());
    this.big.querySelector('.am-centre')!.addEventListener('click', () => {
      const p = this.frame?.player;
      if (p && this.view) {
        this.view.x = p.x;
        this.view.z = p.z;
        this.drawBig();
      }
    });
    this.big.addEventListener('pointerdown', (e) => {
      if (e.target === this.big) this.onClose();
    });
    let drag: { x: number; y: number } | null = null;
    this.bigCanvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      this.bigCanvas.setPointerCapture(e.pointerId);
    });
    this.bigCanvas.addEventListener('pointermove', (e) => {
      if (!drag || !this.view) return;
      this.view.x -= (e.clientX - drag.x) / this.view.ppm;
      this.view.z -= (e.clientY - drag.y) / this.view.ppm;
      drag = { x: e.clientX, y: e.clientY };
      this.drawBig();
    });
    const end = () => (drag = null);
    this.bigCanvas.addEventListener('pointerup', end);
    this.bigCanvas.addEventListener('pointercancel', end);
    this.bigCanvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.view) return;
        const r = this.bigCanvas.getBoundingClientRect();
        // Zoom about the point under the cursor.
        const wx = this.view.x + (e.clientX - r.left - r.width / 2) / this.view.ppm;
        const wz = this.view.z + (e.clientY - r.top - r.height / 2) / this.view.ppm;
        const k = Math.exp(-e.deltaY * 0.0015);
        const ppm = Math.max(0.5, Math.min(30, this.view.ppm * k));
        this.view.x = wx - (e.clientX - r.left - r.width / 2) / ppm;
        this.view.z = wz - (e.clientY - r.top - r.height / 2) / ppm;
        this.view.ppm = ppm;
        this.drawBig();
      },
      { passive: false },
    );
    document.body.appendChild(this.big);
    window.addEventListener('resize', () => this.expanded && this.drawBig());
  }

  get expanded(): boolean {
    return !this.big.hidden;
  }

  /** In the world (true) or on the front end / in a scene (false). */
  set visible(v: boolean) {
    this.active = v;
    this.root.hidden = !(v && this.enabled && this.tris.length > 0);
    if (!v && this.expanded) this.onClose();
  }

  /** The settings' switch. */
  set shown(v: boolean) {
    this.enabled = v;
    this.visible = this.active;
  }

  setExpanded(open: boolean): void {
    if (open === this.expanded) return;
    if (open && !this.tris.length) return;
    this.big.hidden = !open;
    if (open) {
      this.view = null;
      this.drawBig();
    }
  }

  /** A new area: its layout from the collision mesh (the movement world answers "anything below?"). */
  setLevel(arena: ArenaDef | null, mw: MovementWorld | null, name: string): void {
    this.mw = mw;
    this.title.textContent = this.bigTitle.textContent = name;
    this.tris = [];
    this.walls = [];
    this.layout = null;
    this.layoutY = Number.NaN;
    this.seen.clear();
    if (!arena) {
      this.visible = this.active;
      return;
    }
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    const add = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => {
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const n = Math.hypot(nx, ny, nz);
      if (n < 1e-6) return;
      const up = Math.abs(ny) / n;
      if (up > 0.55) {
        // Walkable, or a ceiling (windings are not trusted): a ceiling has floor right below it,
        // so it counts as stacked and shows only from above.
        this.tris.push({ p: [ax, az, bx, bz, cx, cz], y: (ay + by + cy) / 3, stacked: false });
        minX = Math.min(minX, ax, bx, cx);
        maxX = Math.max(maxX, ax, bx, cx);
        minZ = Math.min(minZ, az, bz, cz);
        maxZ = Math.max(maxZ, az, bz, cz);
      } else if (up < 0.35) {
        // A wall: seen from above, the longest of its edges in plan.
        const e: [number, number, number, number][] = [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]];
        let best = e[0]!;
        let bl = -1;
        for (const s of e) {
          const l = Math.hypot(s[2] - s[0], s[3] - s[1]);
          if (l > bl) {
            bl = l;
            best = s;
          }
        }
        if (bl > 0.15) this.walls.push({ a: [best[0], best[1]], b: [best[2], best[3]], y0: Math.min(ay, by, cy), y1: Math.max(ay, by, cy) });
      }
    };
    for (const m of arena.meshes) {
      const v = m.vertices;
      const ix = m.indices;
      for (let i = 0; i + 2 < ix.length; i += 3) {
        const a = ix[i]! * 3, b = ix[i + 1]! * 3, c = ix[i + 2]! * 3;
        add(v[a]!, v[a + 1]!, v[a + 2]!, v[b]!, v[b + 1]!, v[b + 2]!, v[c]!, v[c + 1]!, v[c + 2]!);
      }
    }
    for (const b of arena.boxes) {
      // Box tops (the placeholder arena); ramps tilt about X, close enough from above.
      const top = b.y + b.hy;
      add(b.x - b.hx, top, b.z - b.hz, b.x - b.hx, top, b.z + b.hz, b.x + b.hx, top, b.z + b.hz);
      add(b.x - b.hx, top, b.z - b.hz, b.x + b.hx, top, b.z + b.hz, b.x + b.hx, top, b.z - b.hz);
    }
    if (!this.tris.length) {
      this.visible = this.active;
      return;
    }
    // Stacked floors: more level right below their middle.
    if (mw) {
      const r = mw.rapier;
      for (const t of this.tris) {
        const cx = (t.p[0] + t.p[2] + t.p[4]) / 3;
        const cz = (t.p[1] + t.p[3] + t.p[5]) / 3;
        const hit = mw.world.castRay(new r.Ray({ x: cx, y: t.y - 0.3, z: cz }, { x: 0, y: -1, z: 0 }), 40, true);
        t.stacked = !!hit && hit.timeOfImpact > 1.2;
      }
    }
    // Low floors first: the higher one covers what lies under it.
    this.tris.sort((a, b) => a.y - b.y);
    this.bounds = { minX: minX - 4, minZ: minZ - 4, maxX: maxX + 4, maxZ: maxZ + 4 };
    this.visible = this.active;
  }

  /** The player's height left the band of the last build: the layout for the new one. */
  private build(py: number): void {
    const { minX, minZ, maxX, maxZ } = this.bounds;
    const w = maxX - minX;
    const h = maxZ - minZ;
    const scale = Math.max(0.5, Math.min(5, 2400 / Math.max(w, h)));
    const c = this.layout ?? document.createElement('canvas');
    c.width = Math.ceil(w * scale);
    c.height = Math.ceil(h * scale);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.setTransform(scale, 0, 0, scale, -minX * scale, -minZ * scale);
    g.lineJoin = 'round';
    g.lineWidth = 1.2 / scale;
    for (const t of this.tris) {
      if (t.stacked && t.y > py + HEAD_ROOM) continue;
      const below = py - t.y;
      // Far below (a level's catch floor, the ground under a treetop village): left out.
      if (below > DEEP_BELOW) continue;
      // Near the feet: warm parchment; deeper floors darker.
      const k = below <= 1.5 ? 1 : Math.max(0.28, 1 - (below - 1.5) / 10);
      const above = t.y - py > HEAD_ROOM;
      const r = Math.round(196 * k), gg = Math.round(178 * k), b = Math.round(136 * k);
      const col = above ? `rgba(${r},${gg},${b},0.55)` : `rgb(${r},${gg},${b})`;
      g.fillStyle = col;
      g.strokeStyle = col;
      g.beginPath();
      g.moveTo(t.p[0], t.p[1]);
      g.lineTo(t.p[2], t.p[3]);
      g.lineTo(t.p[4], t.p[5]);
      g.closePath();
      g.fill();
      g.stroke();
    }
    g.strokeStyle = 'rgba(40,30,20,0.95)';
    g.lineWidth = 2.2 / scale;
    g.lineCap = 'round';
    g.beginPath();
    for (const wl of this.walls) {
      if (wl.y1 < py - 0.3 || wl.y0 > py + HEAD_ROOM) continue;
      g.moveTo(wl.a[0], wl.a[1]);
      g.lineTo(wl.b[0], wl.b[1]);
    }
    g.stroke();
    this.layout = c;
    this.layoutScale = scale;
    this.layoutY = py;
  }

  private setZoom(z: number): void {
    this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, z));
    this.save();
    this.draw();
  }

  private save(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ zoom: this.zoom, rotate: this.rotate }));
    } catch {
      // No storage.
    }
  }

  /** Hostiles only when in sight of the player's eyes (checked a few times a second each). */
  private inSight(m: MinimapMark, p: MinimapFrame['player'], now: number): boolean {
    if (!this.mw) return true;
    const key = `${Math.round(m.x * 2)}:${Math.round(m.z * 2)}`;
    const c = this.seen.get(key);
    if (c && now - c.at < 250) return c.seen;
    const seen = lineOfSight(this.mw, { x: p.x, y: p.y, z: p.z }, { x: m.x, y: m.y + 0.5, z: m.z }, PLAYER_HEIGHT * 0.9);
    this.seen.set(key, { at: now, seen });
    if (this.seen.size > 400) this.seen.clear();
    return seen;
  }

  /** The latest state (each frame); the maps redraw at ~15 Hz. */
  update(frame: MinimapFrame, dt: number): void {
    this.frame = frame;
    if (!this.tris.length || (this.root.hidden && !this.expanded)) return;
    if (Number.isNaN(this.layoutY) || Math.abs(frame.player.y - this.layoutY) > REBUILD_STEP) this.build(frame.player.y);
    this.since += dt;
    if (this.since < 1 / 15) return;
    this.since = 0;
    const now = performance.now();
    frame.marks = frame.marks.filter((m) => m.kind !== 'hostile' || (Math.hypot(m.x - frame.player.x, m.z - frame.player.z) < HOSTILE_RANGE && this.inSight(m, frame.player, now)));
    if (!this.root.hidden) this.draw();
    if (this.expanded) this.drawBig();
  }

  private fitCanvas(c: HTMLCanvasElement): { w: number; h: number; g: CanvasRenderingContext2D } {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = c.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    return { w, h, g };
  }

  /** The layout image placed so world (x, z) lands where the context's transform says. */
  private drawLayout(g: CanvasRenderingContext2D): void {
    if (!this.layout) return;
    const s = this.layoutScale;
    g.save();
    g.imageSmoothingEnabled = true;
    g.drawImage(this.layout, this.bounds.minX, this.bounds.minZ, this.layout.width / s, this.layout.height / s);
    g.restore();
  }

  private draw(): void {
    const f = this.frame;
    if (!f) return;
    const { w, h, g } = this.fitCanvas(this.mini);
    const R = Math.min(w, h) / 2;
    const ppm = R / ZOOMS[this.zoom]!;
    const p = f.player;
    g.save();
    g.beginPath();
    g.arc(w / 2, h / 2, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#15110c';
    g.fillRect(0, 0, w, h);
    g.translate(w / 2, h / 2);
    if (this.rotate) g.rotate(p.yaw);
    g.scale(ppm, ppm);
    g.translate(-p.x, -p.z);
    this.drawLayout(g);
    g.restore();
    // Marks, kept upright; those beyond the rim sit on it (exits, party, the crystal).
    const cos = Math.cos(this.rotate ? p.yaw : 0);
    const sin = Math.sin(this.rotate ? p.yaw : 0);
    for (const m of f.marks) {
      const dx = (m.x - p.x) * ppm;
      const dz = (m.z - p.z) * ppm;
      let sx = dx * cos - dz * sin;
      let sy = dx * sin + dz * cos;
      const d = Math.hypot(sx, sy);
      const rim = R - 7;
      if (d > rim) {
        if (m.kind !== 'exit' && m.kind !== 'party' && m.kind !== 'crystal') continue;
        sx *= rim / d;
        sy *= rim / d;
      }
      this.mark(g, m, w / 2 + sx, h / 2 + sy, R / 90, Math.abs(m.y - p.y) > 3 ? (m.y > p.y ? 1 : -1) : 0);
    }
    this.you(g, w / 2, h / 2, this.rotate ? 0 : -p.yaw, R / 90);
    // North on the rim.
    const nx = w / 2 + (this.rotate ? Math.sin(p.yaw) : 0) * (R - 9);
    const ny = h / 2 - (this.rotate ? Math.cos(p.yaw) : 1) * (R - 9);
    const north = this.root.querySelector<HTMLElement>('.mm-north')!;
    north.style.left = `${(nx / w) * 100}%`;
    north.style.top = `${(ny / h) * 100}%`;
    north.classList.toggle('fixed', !this.rotate);
  }

  private drawBig(): void {
    const f = this.frame;
    if (!f) return;
    const { w, h, g } = this.fitCanvas(this.bigCanvas);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!this.view) {
      const { minX, minZ, maxX, maxZ } = this.bounds;
      this.view = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, ppm: Math.min(w / (maxX - minX), h / (maxZ - minZ)) / dpr };
    }
    const ppm = this.view.ppm * dpr;
    g.fillStyle = '#100d09';
    g.fillRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(ppm, ppm);
    g.translate(-this.view.x, -this.view.z);
    this.drawLayout(g);
    g.restore();
    const at = (x: number, z: number): [number, number] => [w / 2 + (x - this.view!.x) * ppm, h / 2 + (z - this.view!.z) * ppm];
    const k = dpr * 1.2;
    const p = f.player;
    g.font = `${Math.round(12 * dpr)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    for (const m of f.marks) {
      const [x, y] = at(m.x, m.z);
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
      this.mark(g, m, x, y, k, Math.abs(m.y - p.y) > 3 ? (m.y > p.y ? 1 : -1) : 0);
      if (m.label) {
        g.fillStyle = 'rgba(0,0,0,.75)';
        g.fillText(m.label, x + 1, y - 11 * k + 1);
        g.fillStyle = MARK_STYLE[m.kind].color;
        g.fillText(m.label, x, y - 11 * k);
      }
    }
    const [px, py] = at(p.x, p.z);
    this.you(g, px, py, -p.yaw, k * 1.15);
  }

  /** One mark; `level` ±1 when well above / below the player (a small arrow beside it). */
  private mark(g: CanvasRenderingContext2D, m: MinimapMark, x: number, y: number, k: number, level: number): void {
    const color = m.color ?? MARK_STYLE[m.kind].color;
    g.save();
    g.translate(x, y);
    g.scale(k, k);
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(0,0,0,.85)';
    g.fillStyle = color;
    g.beginPath();
    switch (m.kind) {
      case 'exit':
        g.rect(-4, -5, 8, 10);
        g.fill();
        g.stroke();
        g.fillStyle = '#0d1a24';
        g.fillRect(-2, -3, 4, 8);
        break;
      case 'crystal':
        g.moveTo(0, -6);
        g.lineTo(4, 0);
        g.lineTo(0, 6);
        g.lineTo(-4, 0);
        g.closePath();
        g.fill();
        g.stroke();
        break;
      case 'merchant':
        g.arc(0, 0, 4.5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#3a2508';
        g.font = 'bold 7px system-ui';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('$', 0, 0.5);
        break;
      case 'loot':
        g.moveTo(0, -4.5);
        g.lineTo(4.5, 0);
        g.lineTo(0, 4.5);
        g.lineTo(-4.5, 0);
        g.closePath();
        g.fill();
        g.stroke();
        break;
      default: {
        const r = m.kind === 'hostile' ? 3 : 3.6;
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    }
    if (level) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(6, level > 0 ? -1 : 1);
      g.lineTo(9, level > 0 ? -5 : 5);
      g.lineTo(12, level > 0 ? -1 : 1);
      g.fill();
    }
    g.restore();
  }

  /** The player's arrow, pointing along `angle` (0 = up on screen). */
  private you(g: CanvasRenderingContext2D, x: number, y: number, angle: number, k: number): void {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.scale(k, k);
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5.5, 6);
    g.closePath();
    g.fillStyle = '#fff3c4';
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.fill();
    g.stroke();
    g.restore();
  }
}
