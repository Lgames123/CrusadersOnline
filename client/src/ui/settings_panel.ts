import type { SettingsStore } from '../settings.ts';

/** Settings section of the "click to play" screen (camera distance, mouse). */
export class SettingsPanel {
  constructor(root: HTMLElement, store: SettingsStore) {
    const s = store.current;
    root.innerHTML = `
      <div class="settings">
        <label>Camera <span class="hint">Classic ↔ Modern (mouse wheel)</span>
          <input id="set-zoom" type="range" min="0" max="1" step="0.05" value="${s.cameraZoom}" />
        </label>
        <label>Mouse sensitivity
          <input id="set-sens" type="range" min="0.25" max="4" step="0.05" value="${s.mouseSensitivity}" />
        </label>
        <label class="check"><input id="set-invert" type="checkbox"${s.invertMouseY ? ' checked' : ''} /> Invert mouse Y</label>
        <label class="check"><input id="set-shadows" type="checkbox"${s.silhouetteShadows ? ' checked' : ''} /> Character silhouette shadows <span class="hint">(not original)</span></label>
        <label class="check"><input id="set-lighting" type="checkbox"${s.enhancedLighting ? ' checked' : ''} /> Enhanced lighting <span class="hint">(not original)</span></label>
        <label class="check"><input id="set-fx" type="checkbox"${s.smallEffects ? ' checked' : ''} /> Smaller hit effects <span class="hint">(not original)</span></label>
        <label>Music volume
          <input id="set-music" type="range" min="0" max="1" step="0.05" value="${s.musicVolume}" />
        </label>
      </div>`;
    // Clicks here must not start the game (the overlay requests pointer lock on click).
    root.addEventListener('click', (e) => e.stopPropagation());
    const zoom = root.querySelector<HTMLInputElement>('#set-zoom')!;
    const sens = root.querySelector<HTMLInputElement>('#set-sens')!;
    const invert = root.querySelector<HTMLInputElement>('#set-invert')!;
    zoom.addEventListener('input', () => store.update({ cameraZoom: Number(zoom.value) }));
    // Keep the slider in step with mouse-wheel zooming during play.
    store.onChange((v) => {
      if (Number(zoom.value) !== v.cameraZoom) zoom.value = String(v.cameraZoom);
    });
    sens.addEventListener('input', () => store.update({ mouseSensitivity: Number(sens.value) }));
    invert.addEventListener('change', () => store.update({ invertMouseY: invert.checked }));
    const shadows = root.querySelector<HTMLInputElement>('#set-shadows')!;
    shadows.addEventListener('change', () => store.update({ silhouetteShadows: shadows.checked }));
    const lighting = root.querySelector<HTMLInputElement>('#set-lighting')!;
    lighting.addEventListener('change', () => store.update({ enhancedLighting: lighting.checked }));
    const fx = root.querySelector<HTMLInputElement>('#set-fx')!;
    fx.addEventListener('change', () => store.update({ smallEffects: fx.checked }));
    const music = root.querySelector<HTMLInputElement>('#set-music')!;
    music.addEventListener('input', () => store.update({ musicVolume: Number(music.value) }));
  }
}
