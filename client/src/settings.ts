/**
 * Per-player presentation settings (camera, mouse). They change only how the game is shown
 * and controlled on this machine; gameplay rules are the server's. Defaults are the
 * original game's ("classic"); everything else is an opt-in quality-of-life option.
 */
export interface Settings {
  /** Camera distance: 0 = the original's camera (closest), 1 = the modern one (farthest). */
  cameraZoom: number;
  /** Mouse sensitivity multiplier (1 = default). */
  mouseSensitivity: number;
  invertMouseY: boolean;
}

export const CLASSIC_SETTINGS: Readonly<Settings> = { cameraZoom: 0, mouseSensitivity: 1, invertMouseY: false };

const KEY = 'crusaders.settings';

function sanitize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings | 'camera', unknown>>;
  const sens = typeof r.mouseSensitivity === 'number' && Number.isFinite(r.mouseSensitivity) ? r.mouseSensitivity : 1;
  return {
    // Older settings stored a camera mode instead of a distance.
    cameraZoom: typeof r.cameraZoom === 'number' && Number.isFinite(r.cameraZoom) ? Math.min(1, Math.max(0, r.cameraZoom)) : r.camera === 'modern' ? 1 : 0,
    mouseSensitivity: Math.min(4, Math.max(0.25, sens)),
    invertMouseY: r.invertMouseY === true,
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

  onChange(listener: (s: Settings) => void): void {
    this.listeners.add(listener);
  }
}
