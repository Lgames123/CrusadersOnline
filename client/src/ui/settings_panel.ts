import type { SettingsStore } from '../settings.ts';

/** Settings section of the "click to play" screen (camera mode, mouse). */
export class SettingsPanel {
  constructor(root: HTMLElement, store: SettingsStore) {
    const s = store.current;
    root.innerHTML = `
      <div class="settings">
        <label>Camera
          <select id="set-camera">
            <option value="classic"${s.camera === 'classic' ? ' selected' : ''}>Classic (original)</option>
            <option value="modern"${s.camera === 'modern' ? ' selected' : ''}>Modern (over the shoulder)</option>
          </select>
        </label>
        <label>Mouse sensitivity
          <input id="set-sens" type="range" min="0.25" max="4" step="0.05" value="${s.mouseSensitivity}" />
        </label>
        <label class="check"><input id="set-invert" type="checkbox"${s.invertMouseY ? ' checked' : ''} /> Invert mouse Y</label>
      </div>`;
    // Clicks here must not start the game (the overlay requests pointer lock on click).
    root.addEventListener('click', (e) => e.stopPropagation());
    const camera = root.querySelector<HTMLSelectElement>('#set-camera')!;
    const sens = root.querySelector<HTMLInputElement>('#set-sens')!;
    const invert = root.querySelector<HTMLInputElement>('#set-invert')!;
    camera.addEventListener('change', () => store.update({ camera: camera.value === 'modern' ? 'modern' : 'classic' }));
    sens.addEventListener('input', () => store.update({ mouseSensitivity: Number(sens.value) }));
    invert.addEventListener('change', () => store.update({ invertMouseY: invert.checked }));
  }
}
