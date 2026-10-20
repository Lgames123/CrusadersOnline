/**
 * The original HUD's three text lines (HUD init 0x468430, setters 0x4691E0 / 0x4692F0 /
 * 0x4693F0, drawn by 0x4697E0 until GetTickCount passes their deadline), on the centred
 * 640 × 480 screen:
 * - **speech** (0x58B084, box 560 × 150 at (40, 320)): what is being said, the voice lines'
 *   subtitles (0x403FD4 / 0x408BB5);
 * - **message** (0x58ADCC, box 390 × 50 at (250, 16)): game messages, mostly 5 s (pick-ups,
 *   "God mode on"…); a message replaces the current one only at the same or a higher priority.
 *   Drawn here centred on the screen (x 125), not at the original's x 250;
 * - **notice** (0x58AEF4, box 500 × 400 at (100, 80)): signs and hints (message triggers,
 *   0x4632CF, 2 s) and quest talk.
 * Each is white (255, 255, 255) or, with the setters' alert flag, red (255, 20, 20).
 * The engine font is not reproduced: a serif stand-in with a dark outline.
 */
const STYLE = `
#classic-text { position: fixed; left: 50%; top: 0; width: 640px; height: 480px; z-index: 6; transform-origin: 50% 0; pointer-events: none; }
#classic-text .ct-line { position: absolute; display: flex; justify-content: center; text-align: center; white-space: pre-wrap;
  color: #fff; font: 600 13px/1.3 "Palatino Linotype", Georgia, serif; text-shadow: 0 0 2px #000, 0 1px 2px #000, 1px 0 2px #000; }
#classic-text .ct-alert { color: rgb(255,20,20); }
#classic-text .ct-speech { left: 40px; top: 320px; width: 560px; height: 150px; align-items: flex-start; }
#classic-text .ct-message { left: 125px; top: 16px; width: 390px; height: 50px; align-items: flex-start; }
#classic-text .ct-notice { left: 100px; top: 80px; width: 500px; height: 400px; align-items: flex-start; }
#classic-text[hidden], #classic-text .ct-line[hidden] { display: none; }
`;

type LineKind = 'speech' | 'message' | 'notice';

export class ClassicText {
  private readonly root: HTMLElement;
  private readonly lines: Record<LineKind, { el: HTMLElement; until: number; priority: number; timer: number }>;

  constructor() {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.append(style);
    this.root = document.createElement('div');
    this.root.id = 'classic-text';
    document.body.append(this.root);
    const line = (kind: LineKind) => {
      const el = document.createElement('div');
      el.className = `ct-line ct-${kind}`;
      el.hidden = true;
      this.root.append(el);
      return { el, until: 0, priority: 0, timer: 0 };
    };
    this.lines = { speech: line('speech'), message: line('message'), notice: line('notice') };
    window.addEventListener('resize', () => this.fit());
    this.fit();
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /** The 640 × 480 screen at the window's height, centred like the 4:3 view. */
  private fit(): void {
    this.root.style.transform = `translateX(-50%) scale(${window.innerHeight / 480})`;
  }

  /**
   * Shows `text` on a line for `ms`. A message only replaces a live one of the same or lower
   * priority (0x4692F0 compares its +0xC2).
   */
  show(kind: LineKind, text: string, ms: number, opts: { alert?: boolean; priority?: number } = {}): void {
    const l = this.lines[kind];
    const now = performance.now();
    const priority = opts.priority ?? 0;
    if (kind === 'message' && now < l.until && priority < l.priority) return;
    l.el.textContent = text;
    l.el.classList.toggle('ct-alert', !!opts.alert);
    l.el.hidden = false;
    l.until = now + ms;
    l.priority = priority;
    clearTimeout(l.timer);
    l.timer = window.setTimeout(() => {
      l.el.hidden = true;
      l.priority = 0;
    }, ms);
  }
}
