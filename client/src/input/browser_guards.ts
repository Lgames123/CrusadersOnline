/**
 * Turns off the browser features that get in the way of playing: the right-click menu,
 * text selection and native drags, middle-click autoscroll, the mouse back/forward buttons,
 * page zoom, and (while the pointer is locked) the browser's own key shortcuts — Alt/F10
 * menu focus, F3/Ctrl+F find, F5/Ctrl+R reload, Ctrl+S/P/D, Firefox's quick find. Text
 * fields keep their menu and selection. Ctrl+W/T/N and Esc stay with the browser: a page
 * cannot take them.
 */

/** Keys left to the browser even while playing: fullscreen and the developer tools. */
const PASS_THROUGH = new Set(['F11', 'F12']);

function editable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target as HTMLElement | null)?.isContentEditable === true;
}

export function installBrowserGuards(): void {
  const locked = () => document.pointerLockElement !== null;
  document.addEventListener('contextmenu', (e) => {
    if (!editable(e.target)) e.preventDefault();
  });
  document.addEventListener('selectstart', (e) => {
    if (!editable(e.target)) e.preventDefault();
  });
  document.addEventListener('dragstart', (e) => {
    if (!editable(e.target)) e.preventDefault();
  });

  // Middle button: autoscroll on press; buttons 3/4: history back/forward on release.
  window.addEventListener('mousedown', (e) => {
    if (e.button === 1 || e.button === 3 || e.button === 4) e.preventDefault();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
  window.addEventListener('auxclick', (e) => e.preventDefault());

  // Page zoom: Ctrl+wheel (pinch on touchpads) and Ctrl +/-/0.
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract' || e.code === 'Numpad0')) {
      e.preventDefault();
      return;
    }
    if (locked() && !PASS_THROUGH.has(e.code) && !(e.ctrlKey && e.shiftKey && (e.code === 'KeyI' || e.code === 'KeyJ'))) e.preventDefault();
  });
  // A lone Alt or F10 focuses the browser's menu on release.
  window.addEventListener('keyup', (e) => {
    if (locked() && (e.key === 'Alt' || e.code === 'F10')) e.preventDefault();
  });
}
