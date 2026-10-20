/**
 * The original's introduction: 3DO.bik then CMMIntro.bik, played full screen at startup
 * (0x00499760 / 0x00499950). The converter transcodes them to WebM (manifest `movies`). Here they
 * are offered at character creation and from the options menu instead of at every start.
 * Skipping follows the original's loop: Esc, Space, Enter or a left click ends the current movie
 * (0x00499950: WM_KEYDOWN 0x1B / 0x20 / 0x0D, WM_LBUTTONUP), and the next one plays.
 */

const ORDER = ['3do', 'cmmintro'] as const;
const SKIP_KEYS = new Set(['Escape', ' ', 'Enter']);

let urls: Promise<string[] | null> | null = null;

/**
 * The converted movies in play order, or null when the introduction (CMMIntro) was not converted:
 * then nothing offers it.
 */
export function introMovies(): Promise<string[] | null> {
  urls ??= fetch('/generated/manifest.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ movies?: Record<string, string> }>) : null))
    .then((m) => {
      const movies = m?.movies ?? {};
      if (!movies['cmmintro']) return null;
      return ORDER.filter((k) => movies[k]).map((k) => `/generated/${movies[k]}`);
    })
    .catch(() => null);
  return urls;
}

let playing = false;

/** Plays the movies full screen, one after another; resolves when the last ends or is skipped. */
export async function playIntro(movies: readonly string[]): Promise<void> {
  if (playing || !movies.length) return;
  playing = true;
  const root = document.createElement('div');
  root.id = 'intro-movie';
  root.innerHTML = `<video playsinline preload="auto"></video>
    <button type="button" class="intro-start" hidden>Play the introduction</button>
    <button type="button" class="intro-skip">Skip <small>Esc</small></button>`;
  document.body.appendChild(root);
  const video = root.querySelector('video')!;
  const start = root.querySelector<HTMLButtonElement>('.intro-start')!;
  const skipButton = root.querySelector<HTMLButtonElement>('.intro-skip')!;
  // A lock asked for just before (the menu's Resume) is let go again: the cursor stays free.
  const unlock = () => {
    if (document.pointerLockElement) document.exitPointerLock();
  };
  unlock();
  document.addEventListener('pointerlockchange', unlock);

  let next: () => void = () => {};
  let all: () => void = () => {};
  // Capture on window: runs before the front end's and the game's own key handlers.
  const keys = (e: KeyboardEvent) => {
    e.stopImmediatePropagation();
    e.stopPropagation();
    if (e.repeat || !SKIP_KEYS.has(e.key)) return;
    e.preventDefault();
    next();
  };
  const block = (e: KeyboardEvent) => e.stopImmediatePropagation();
  window.addEventListener('keydown', keys, true);
  window.addEventListener('keyup', block, true);
  video.addEventListener('pointerup', (e) => {
    if (e.button === 0) next();
  });
  skipButton.addEventListener('click', () => all());

  try {
    for (const src of movies) {
      let skipAll = false;
      await new Promise<void>((resolve) => {
        next = resolve;
        all = () => {
          skipAll = true;
          resolve();
        };
        video.onended = () => resolve();
        video.onerror = () => resolve(); // a missing or unplayable file is passed over
        video.src = src;
        video.play().catch((err: Error) => {
          if (err.name !== 'NotAllowedError') return;
          // No user gesture left to start sound with: one click starts it.
          start.hidden = false;
          start.focus();
          start.onclick = () => {
            start.hidden = true;
            void video.play().catch(() => resolve());
          };
        });
      });
      start.hidden = true;
      video.pause();
      if (skipAll) break;
    }
  } finally {
    window.removeEventListener('keydown', keys, true);
    window.removeEventListener('keyup', block, true);
    document.removeEventListener('pointerlockchange', unlock);
    video.removeAttribute('src');
    video.load();
    root.remove();
    playing = false;
  }
}
