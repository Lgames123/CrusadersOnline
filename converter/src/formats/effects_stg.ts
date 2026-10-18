/**
 * Parser for `script/effects.stg`, the original's special-effect definitions:
 *
 * - `BEGIN SHAPE <name>`: a sprite (`SPRITE`, `texture <name>`) with OUTER / CENTER / INNER
 *   colours (r g b a, 0-255); `SPHERE` shapes are flagged (the client draws them as balls).
 * - `BEGIN FLASH <name>`: one animated instance of a shape (`ROTATING_SHAPE` / `STATIC_SHAPE`):
 *   start size, size speed and acceleration, rotation speed, the attack / sustain / decay alpha
 *   envelope (seconds), `MOVE` velocity, `GRAVITY`, `RANDOMIZE_SIZE` / `RANDOMIZE_MOVE`
 *   ranges, a `POSITION` offset and, for trails, `SPAWN_MULTI <name> <interval>` (+ `SPAWN_LEVEL`).
 * - `BEGIN MULTI <name> <variant>`: the effect the engine spawns by name (SWORD_DAMAGE, BLOOD,
 *   BONE...): `ADD FLASH <flash> <delay seconds>` lines. The variant is the spell level for spell
 *   effects (0 otherwise).
 *
 * Keys are kept upper-case; unknown commands are ignored.
 */

export interface EffectShape {
  texture: string | null;
  /** OUTER, CENTER, INNER colours: [r, g, b, a] 0-255. */
  outer: [number, number, number, number];
  center: [number, number, number, number];
  inner: [number, number, number, number];
  sphere: boolean;
}

export interface EffectFlash {
  shape: string;
  rotating: boolean;
  startHeight: number;
  deltaHeight: number;
  heightAcceleration: number;
  startWidth: number;
  deltaWidth: number;
  widthAcceleration: number;
  rotationSpeed: number;
  attack: number;
  sustain: number;
  decay: number;
  move: [number, number, number];
  gravity: [number, number, number];
  randomizeSize: number;
  randomizeMove: [number, number, number];
  position: [number, number, number];
  spawnMulti?: { name: string; interval: number; level: number };
}

export interface EffectsTable {
  shapes: Record<string, EffectShape>;
  flashes: Record<string, EffectFlash>;
  /** Effect name -> variant -> [flash, delay seconds][]. */
  multis: Record<string, Record<number, [string, number][]>>;
}

const num = (s: string | undefined, d = 0): number => {
  if (s === undefined) return d;
  const v = /^-?0x/i.test(s) ? parseInt(s.replace('-', ''), 16) * (s.startsWith('-') ? -1 : 1) : Number(s);
  return Number.isFinite(v) ? v : d;
};
const vec3 = (w: string[], i: number): [number, number, number] => [num(w[i]), num(w[i + 1]), num(w[i + 2])];
const rgba = (w: string[]): [number, number, number, number] => [num(w[1], 255), num(w[2], 255), num(w[3], 255), num(w[4], 255)];

export function parseEffectsStg(text: string): EffectsTable {
  const out: EffectsTable = { shapes: {}, flashes: {}, multis: {} };
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  let kind: string | null = null;
  let name = '';
  let variant = 0;
  let shape: EffectShape | null = null;
  let flash: EffectFlash | null = null;
  let multi: [string, number][] | null = null;
  for (const line of lines) {
    if (!line) continue;
    const w = line.split(/\s+/);
    const head = w[0]!.toUpperCase();
    if (head === 'BEGIN') {
      kind = (w[1] ?? '').toUpperCase();
      name = (w[2] ?? '').toUpperCase();
      variant = num(w[3], 0);
      if (kind === 'SHAPE') shape = { texture: null, outer: [255, 255, 255, 255], center: [255, 255, 255, 255], inner: [255, 255, 255, 255], sphere: false };
      else if (kind === 'FLASH') {
        flash = {
          shape: name, rotating: true, startHeight: 0, deltaHeight: 0, heightAcceleration: 0, startWidth: 0, deltaWidth: 0, widthAcceleration: 0,
          rotationSpeed: 0, attack: 0, sustain: 0, decay: 0, move: [0, 0, 0], gravity: [0, 0, 0], randomizeSize: 0, randomizeMove: [0, 0, 0], position: [0, 0, 0],
        };
      } else if (kind === 'MULTI') multi = [];
      continue;
    }
    if (head === 'END') {
      if (kind === 'SHAPE' && shape && name) out.shapes[name] = shape;
      else if (kind === 'FLASH' && flash && name) out.flashes[name] = flash;
      else if (kind === 'MULTI' && multi && name) (out.multis[name] ??= {})[variant] = multi;
      kind = null;
      shape = null;
      flash = null;
      multi = null;
      continue;
    }
    if (kind === 'SHAPE' && shape) {
      if (head === 'TEXTURE') shape.texture = (w[1] ?? '').toLowerCase() || null;
      else if (head === 'OUTER') shape.outer = rgba(w);
      else if (head === 'CENTER') shape.center = rgba(w);
      else if (head === 'INNER') shape.inner = rgba(w);
      else if (head === 'SPHERE') shape.sphere = true;
    } else if (kind === 'FLASH' && flash) {
      if (head === 'ROTATING_SHAPE' || head === 'STATIC_SHAPE') {
        flash.shape = (w[1] ?? name).toUpperCase();
        flash.rotating = head === 'ROTATING_SHAPE';
      } else if (head === 'SET') {
        const key = (w[1] ?? '').toLowerCase();
        const v = num(w[2]);
        if (key === 'startheight') flash.startHeight = v;
        else if (key === 'deltaheight') flash.deltaHeight = v;
        else if (key === 'heightacceleration') flash.heightAcceleration = v;
        else if (key === 'startwidth') flash.startWidth = v;
        else if (key === 'deltawidth') flash.deltaWidth = v;
        else if (key === 'widthacceleration') flash.widthAcceleration = v;
        else if (key === 'rotationspeed') flash.rotationSpeed = v;
        else if (key === 'attack') flash.attack = v;
        else if (key === 'sustain') flash.sustain = v;
        else if (key === 'decay') flash.decay = v;
      } else if (head === 'MOVE') flash.move = vec3(w, 1);
      else if (head === 'GRAVITY') flash.gravity = vec3(w, 1);
      else if (head === 'RANDOMIZE_SIZE') flash.randomizeSize = num(w[1]);
      else if (head === 'RANDOMIZE_MOVE') flash.randomizeMove = vec3(w, 1);
      else if (head === 'POSITION') flash.position = vec3(w, 1);
      else if (head === 'SPAWN_MULTI') flash.spawnMulti = { name: (w[1] ?? '').toUpperCase(), interval: num(w[2]), level: flash.spawnMulti?.level ?? 0 };
      else if (head === 'SPAWN_LEVEL' && flash.spawnMulti) flash.spawnMulti.level = num(w[1]);
    } else if (kind === 'MULTI' && multi && head === 'ADD' && (w[1] ?? '').toUpperCase() === 'FLASH' && w[2]) {
      multi.push([w[2].toUpperCase(), num(w[3])]);
    }
  }
  return out;
}
