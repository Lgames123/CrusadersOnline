/**
 * Per-player presentation settings (camera, mouse). They change only how the game is shown
 * and controlled on this machine; gameplay rules are the server's. Defaults are the
 * original game's ("classic"); everything else is an opt-in quality-of-life option, except
 * fixedPropUvs (asset fixes, on unless turned off).
 */
export interface Settings {
  /** Camera distance: 0 = the original's camera (closest), 1 = the modern one (farthest). */
  cameraZoom: number;
  /** Mouse sensitivity multiplier (1 = default). */
  mouseSensitivity: number;
  invertMouseY: boolean;
  /** Level music volume, 0-1. */
  musicVolume: number;
  /**
   * Silhouette shadows (the player and characters nearby; not original). Off: the round shadow
   * under each character, like the original's projected shadow texture.
   */
  silhouetteShadows: boolean;
  /**
   * Object shadows (not original): barrels, trees, crates and the larger plants cast shadows on
   * the level's ground and grass along the silhouettes' light. Off: the ground as baked.
   */
  objectShadows: boolean;
  /** How dark object shadows make fully lit ground: 0.1-1 (1 black), OBJECT_SHADOW_STRENGTH by default. */
  objectShadowStrength: number;
  /**
   * Enhanced lighting (not original): torches, the Torch Light spell and sparks light the level
   * and characters around them. Off: the original's baked light only.
   */
  enhancedLighting: boolean;
  /** Hit effects at half the original's size (not original; a playtest preference). */
  smallEffects: boolean;
  /**
   * Grass and bushes on outdoor grass ground (not original), swaying in the wind near the player.
   * Off: the levels' ground as the original draws it.
   */
  foliage: boolean;
  /** How far grass is drawn, metres (bushes a little farther); FOLIAGE_DISTANCE's range. */
  foliageDistance: number;
  /** Foliage density per kind: grass blades, bushes (bush01), small plants (plant01); 1 = default, 0-3. */
  foliageGrass: number;
  foliageBushes: number;
  foliagePlants: number;
  /** Props whose original UVs miss their texture refitted (not original, on by default): the Fancy Chair. */
  fixedPropUvs: boolean;
  /** The original's HUD coins (classic, default) or the panel with bars, XP and gold (modern). */
  hudStyle: 'classic' | 'modern';
  /** FPS, tick, position and network line in the top right corner. */
  showStats: boolean;
  /** Custom keybindings mapping action ID to array of key codes. */
  keybindings?: Record<string, string[]>;
  /** Settings schema version (see OPTIONS_VERSION). */
  optionsVersion?: number;
}

export const CLASSIC_SETTINGS: Readonly<Settings> = { cameraZoom: 0, mouseSensitivity: 1, invertMouseY: false, musicVolume: 0.5, silhouetteShadows: false, objectShadows: false, objectShadowStrength: 0.6, enhancedLighting: false, smallEffects: false, foliage: false, foliageDistance: 35, foliageGrass: 1, foliageBushes: 1, foliagePlants: 1, fixedPropUvs: true, hudStyle: 'classic', showStats: false };

const KEY = 'crusaders.settings';
/** Bumped when a default moves back to the original, so earlier stored values reset once. */
const OPTIONS_VERSION = 2;

/** A foliage density setting: 0-3, 1 when unset. */
const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0, v)) : 1);

function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings | 'camera', unknown>>;
  const sens = typeof r.mouseSensitivity === 'number' && Number.isFinite(r.mouseSensitivity) ? r.mouseSensitivity : 1;
  let keybindings: Record<string, string[]> | undefined;
  if (r.keybindings && typeof r.keybindings === 'object') {
    keybindings = {};
    for (const [k, v] of Object.entries(r.keybindings)) {
      if (Array.isArray(v)) keybindings[k] = v.filter((c): c is string => typeof c === 'string');
    }
  }
  return {
    // Older settings stored a camera mode instead of a distance.
    cameraZoom: typeof r.cameraZoom === 'number' && Number.isFinite(r.cameraZoom) ? Math.min(1, Math.max(0, r.cameraZoom)) : r.camera === 'modern' ? 1 : 0,
    mouseSensitivity: Math.min(4, Math.max(0.25, sens)),
    invertMouseY: r.invertMouseY === true,
    musicVolume: typeof r.musicVolume === 'number' && Number.isFinite(r.musicVolume) ? Math.min(1, Math.max(0, r.musicVolume)) : CLASSIC_SETTINGS.musicVolume,
    // Stored before it became optional (default on then): back to the original unless chosen again.
    silhouetteShadows: r.silhouetteShadows === true && r.optionsVersion === OPTIONS_VERSION,
    objectShadows: r.objectShadows === true,
    objectShadowStrength: typeof r.objectShadowStrength === 'number' && Number.isFinite(r.objectShadowStrength) ? Math.min(1, Math.max(0.1, r.objectShadowStrength)) : CLASSIC_SETTINGS.objectShadowStrength,
    enhancedLighting: r.enhancedLighting === true,
    smallEffects: r.smallEffects === true,
    foliage: r.foliage === true,
    foliageGrass: amount(r.foliageGrass),
    foliageBushes: amount(r.foliageBushes),
    foliagePlants: amount(r.foliagePlants),
    foliageDistance: typeof r.foliageDistance === 'number' && Number.isFinite(r.foliageDistance) ? Math.min(90, Math.max(15, r.foliageDistance)) : CLASSIC_SETTINGS.foliageDistance,
    fixedPropUvs: r.fixedPropUvs !== false,
    hudStyle: r.hudStyle === 'modern' ? 'modern' : 'classic',
    showStats: r.showStats === true,
    keybindings,
    optionsVersion: OPTIONS_VERSION,
  };
}

export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<(s: Settings) => void>();

  constructor() {
    let stored: unknown = null;
    try {
      stored = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      // Storage unavailable (private mode, blocked): defaults for this session.
    }
    this.value = sanitize(stored);
  }

  get current(): Readonly<Settings> {
    return this.value;
  }

  update(patch: Partial<Settings>): void {
    this.value = sanitize({ ...this.value, ...patch });
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      // Not persisted; still applied.
    }
    for (const l of this.listeners) l(this.value);
  }

  /** Returns a function that removes the listener. */
  onChange(listener: (s: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
