import * as THREE from 'three';

/**
 * The original game's sounds, converted from the player's own installation (imported in the
 * browser or `pnpm convert`; files under /generated/sounds, registry rules/sounds.json from Sound.ctx).
 * Sounds are addressed by their Sound.ctx id (the ids the executable uses) or file name.
 * WebAudio with distance attenuation and stereo panning relative to the camera. Silent (all
 * calls are no-ops) when the converted audio is not available.
 */
interface Manifest {
  audio?: Record<string, string>;
  rules?: Record<string, string>;
}

export class SoundBank {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly listener = new THREE.Vector3();
  private readonly right = new THREE.Vector3(1, 0, 0);
  private readonly files: Map<number, string>;
  /** Sound.ctx priority letter by id (A loudest). */
  private readonly priorities = new Map<number, string>();
  private readonly urls: Record<string, string>;
  /** Master volume 0..1. */
  volume = 0.8;
  /** Dialogue lines (Sound.ctx is_dialog): file, on-screen text and length. */
  readonly lines = new Map<number, { file: string; text: string; ms: number }>();

  /**
   * Voice lines of a role (file names <speaker>_<role>_<nn>.mp3, e.g. CA_TM_01 for Casper the
   * townsman): one list of line ids per speaker, in order (the first is the greeting).
   */
  speakers(role: string): number[][] {
    const by = new Map<string, { n: number; id: number }[]>();
    for (const [id, l] of this.lines) {
      const m = /^([a-z0-9]+)_([a-z]+)_(\d+)\.mp3$/.exec(l.file);
      if (!m || m[2] !== role || !this.urls[l.file]) continue;
      let list = by.get(m[1]!);
      if (!list) by.set(m[1]!, (list = []));
      list.push({ n: Number(m[3]), id });
    }
    return [...by.keys()].sort().map((k) => by.get(k)!.sort((a, b) => a.n - b.n).filter((x) => x.n < 80).map((x) => x.id)).filter((l) => l.length);
  }

  private constructor(files: Map<number, string>, urls: Record<string, string>) {
    this.files = files;
    this.urls = urls;
  }

  static async load(): Promise<SoundBank | null> {
    try {
      const manifest = (await (await fetch('/generated/manifest.json')).json()) as Manifest;
      const rules = manifest.rules?.['sounds'];
      if (!rules || !manifest.audio) return null;
      const { sounds } = (await (await fetch(`/generated/${rules}`)).json()) as { sounds: { id: number; file: string; dialog?: boolean; description?: string; lengthMs?: number; priority?: string }[] };
      const files = new Map(sounds.map((s) => [s.id, s.file.toLowerCase()]));
      const bank = new SoundBank(files, manifest.audio);
      for (const s of sounds) if (s.priority) bank.priorities.set(s.id, s.priority.toUpperCase());
      for (const s of sounds) if (s.dialog) bank.lines.set(s.id, { file: s.file.toLowerCase(), text: s.description ?? '', ms: s.lengthMs ?? 3000 });
      return bank;
    } catch {
      return null;
    }
  }

  /** Browsers only start audio after a user gesture; call from a click / key handler. */
  unlock(): void {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Camera position and orientation, every frame. */
  setListener(camera: THREE.Camera): void {
    this.listener.copy(camera.position);
    this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  private buffer(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      const url = this.urls[file];
      p = url && this.ctx
        ? fetch(`/generated/${url}`).then((r) => r.arrayBuffer()).then((b) => this.ctx!.decodeAudioData(b)).catch(() => null)
        : Promise.resolve(null);
      this.buffers.set(file, p);
    }
    return p;
  }

  /**
   * How far a sound carries, metres: the positional player (0x004B0FC0) drops a sound beyond its
   * priority's distance (table 0x004F61D8, squared feet: A 40000, B 22500, C 12544, D 3600).
   */
  reach(id: number): number {
    const ft = { A: 200, B: 150, C: 112, D: 60 }[this.priorities.get(id) ?? ''] ?? 112;
    return ft * 0.3048;
  }

  /**
   * Plays a sound (Sound.ctx id, or file name like "swswing01.wav") at a world position (or
   * non-positional). `rate` is the playback rate (pitch and speed, AIL playback rate x rate).
   * Returns a stop function for loops.
   */
  play(ref: number | string, at?: THREE.Vector3 | null, opts: { volume?: number; loop?: boolean; maxDistance?: number; rate?: number } = {}): () => void {
    const ctx = this.ctx;
    const file = typeof ref === 'number' ? this.files.get(ref) : ref.toLowerCase();
    if (!ctx || !file) return () => {};
    let stopped = false;
    let source: AudioBufferSourceNode | null = null;
    const max = opts.maxDistance ?? 35;
    let gainValue = (opts.volume ?? 1) * this.volume;
    let pan = 0;
    if (at) {
      const d = at.distanceTo(this.listener);
      if (d > max) return () => {};
      gainValue *= Math.min(1, 4 / Math.max(1, d)) * (1 - d / max);
      const dir = at.clone().sub(this.listener).normalize();
      pan = Math.max(-1, Math.min(1, dir.dot(this.right)));
    }
    void this.buffer(file).then((buf) => {
      if (!buf || stopped) return;
      source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop = !!opts.loop;
      if (opts.rate && opts.rate > 0) source.playbackRate.value = opts.rate;
      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      source.connect(gain).connect(panner).connect(ctx.destination);
      source.start();
    });
    return () => {
      stopped = true;
      source?.stop();
    };
  }
}

/** Sound.ctx ids used by the game (resolved with the user's Sound.ctx). */
export const SFX = {
  swing: [309, 310, 311],
  swingGrunt: 36,
  drakeDamage: [0, 1, 2, 3],
  drakeDeath: [4, 5, 6, 7],
  footstepStone: [16, 17],
  /** Left / right steps per surface (Sound.ctx "Footstep on ..."). */
  footsteps: {
    stone: [16, 17],
    metal: [24, 25],
    wood: [26, 27],
    gravel: [28, 29],
    grass: [22, 23],
    snow: [30, 31],
    squishy: [18, 19],
  },
  levelUp: 417,
  died: 418,
  click: 401,
  /** Turning a quest book page (UITurnPage). */
  turnPage: 412,
  /** A shield rush's contact roll, at the rusher (0x493F20: DDam01, then HitMetal01). */
  rushContact: [0, 338],
  chestOpen: 520,
  /** A blade striking a wall: this + round(rand x 4), HitMetal01-04 or HitStone01 (0x0048CAB0). */
  wallHit: 338,
  /** A debris piece landing (HitMetal02; logged ~0.3 s after a barrel broke). */
  debrisLand: 339,
  fireLoop: 533,
  /**
   * Impact by material x weapon edge (sharp: slash above bash), five each (executable table
   * 0x004EEDA8; pick with impactSound). Landed blows use the victim's material, blows its
   * shield stops the metal row (sound table +4: 2 for every shielded type, Drake's 142 too).
   */
  impact: {
    bone: { sharp: [308, 308, 308, 308, 308], blunt: [302, 302, 302, 302, 302] },
    flesh: { sharp: [304, 305, 306, 307, 336], blunt: [300, 303, 303, 337, 353] },
    metal: { sharp: [339, 339, 340, 341, 357], blunt: [338, 338, 346, 346, 355] },
    ice: { sharp: [356, 356, 356, 356, 356], blunt: [354, 354, 354, 354, 354] },
  },
  /** A landed blow on what has no creature type, e.g. a breakable prop (0x44CEF0: 0x132). Drake is type 142. */
  hitOther: 306,
} as const;

/** One of an impact row's five sounds: the original's index round(rand x 4) (ends half as likely). */
export function impactSound(row: readonly number[]): number {
  return row[Math.round(Math.random() * 4)]!;
}

/**
 * Per-creature damage / death cries and impact material (executable creature sound table at
 * 0x004EEA88, indexed by type id - 113).
 */
export const CREATURE_SFX: Readonly<Record<string, { material: 'bone' | 'flesh'; damage: number; death: number }>> = {
  skeleton_warrior: { material: 'bone', damage: 163, death: 164 },
  skeleton_ghost: { material: 'bone', damage: 167, death: 171 },
  shadow: { material: 'bone', damage: 162, death: 170 },
  dark_mage: { material: 'flesh', damage: 192, death: 195 },
  dark_master: { material: 'flesh', damage: 191, death: 194 },
  dasher_brute: { material: 'flesh', damage: 158, death: 159 },
  ogre_outlaw: { material: 'flesh', damage: 186, death: 190 },
  dwarf_rebel: { material: 'flesh', damage: 139, death: 137 },
  dwarf_zealot: { material: 'flesh', damage: 133, death: 143 },
  // Material 3 (ice) in the table; no ice impact sound mapped yet.
  ice_titan: { material: 'bone', damage: 185, death: 189 },
  black_knight: { material: 'flesh', damage: 208, death: 208 },
  deceiver: { material: 'flesh', damage: 167, death: 165 },
};

export const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;
