/**
 * Level music: the original's CD tracks (the GOG release ships them as Music/<n>.mp3; the
 * converter copies them to /generated/music). Each level act names its track (cap header
 * +0x1C, played as CD track value + 1), looped like the engine's redbook player.
 */
export class MusicPlayer {
  private readonly audio = new Audio();
  private track = 0;
  private urls: Record<string, string> | null = null;
  private unlocked = false;
  private held = false;

  constructor(volume: number) {
    this.audio.loop = true;
    this.audio.volume = volume;
  }

  private async resolve(track: number): Promise<string | null> {
    if (!this.urls) {
      try {
        const m = (await (await fetch('/generated/manifest.json')).json()) as { audio?: Record<string, string> };
        this.urls = m.audio ?? {};
      } catch {
        this.urls = {};
      }
    }
    const file = this.urls[`music/${track}`];
    return file ? `/generated/${file}` : null;
  }

  /**
   * Switches to a level's track (0 / undefined = silence); the same track keeps playing.
   * `startAt` (seconds) skips into the first pass only; the loop still wraps to 0.
   */
  async play(track: number | undefined, startAt = 0): Promise<void> {
    const next = track ?? 0;
    if (next === this.track) return;
    this.track = next;
    if (!next) {
      this.audio.pause();
      return;
    }
    const url = await this.resolve(next);
    if (!url || this.track !== next) return;
    this.audio.src = url;
    if (startAt > 0) {
      const seek = () => {
        if (this.track === next) this.audio.currentTime = startAt;
      };
      this.audio.addEventListener('loadedmetadata', seek, { once: true });
    }
    if (this.unlocked && !this.held) void this.audio.play().catch(() => {});
  }

  /** Browsers start audio only after a user gesture (the click that starts the game). */
  unlock(): void {
    this.unlocked = true;
    if (this.track && this.audio.src && this.audio.paused && !this.held) void this.audio.play().catch(() => {});
  }

  /** Silences the track while something else plays (the introduction movie); false resumes it. */
  hold(on: boolean): void {
    this.held = on;
    if (on) this.audio.pause();
    else if (this.unlocked && this.track && this.audio.src) void this.audio.play().catch(() => {});
  }

  set volume(v: number) {
    this.audio.volume = Math.min(1, Math.max(0, v));
  }
}
