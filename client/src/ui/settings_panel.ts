import type { Settings, SettingsStore } from '../settings.ts';
import {
  BINDING_DEFINITIONS,
  comboCode,
  formatKeyCode,
  getDefaultKeybindings,
  type BindingCategory,
  type BindingDefinition,
} from '../input/keybindings.ts';

type Tab = 'controls' | 'keybindings' | 'graphics' | 'audio';

interface ListeningState {
  defId: string;
  slotIndex: number; // 0 = primary, 1 = secondary
}

export class SettingsPanel {
  private activeTab: Tab = 'controls';
  private keyCategory: BindingCategory | 'all' = 'all';
  private listening: ListeningState | null = null;
  private readonly root: HTMLElement;
  private readonly store: SettingsStore;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;
  private mouseListener: ((e: MouseEvent) => void) | null = null;

  constructor(root: HTMLElement, store: SettingsStore) {
    this.root = root;
    this.store = store;

    // Prevent clicks inside settings panel from stealing pointer lock or starting game
    this.root.addEventListener('click', (e) => e.stopPropagation());

    this.render();

    // Re-render or update values when store changes externally (e.g. mouse wheel zoom)
    this.store.onChange(() => {
      this.updateValues();
    });
  }

  private render(): void {
    const s = this.store.current;
    const currentKeys: Record<string, string[]> = {
      ...getDefaultKeybindings(),
      ...(s.keybindings ?? {}),
    };

    this.root.innerHTML = `
      <div class="opt-container">
        <!-- Navigation Tabs -->
        <nav class="opt-tabs" role="tablist">
          <button type="button" class="opt-tab ${this.activeTab === 'controls' ? 'active' : ''}" data-tab="controls">
            <span class="opt-tab-icon">🎮</span> Gameplay
          </button>
          <button type="button" class="opt-tab ${this.activeTab === 'keybindings' ? 'active' : ''}" data-tab="keybindings">
            <span class="opt-tab-icon">⌨️</span> Keybindings
          </button>
          <button type="button" class="opt-tab ${this.activeTab === 'graphics' ? 'active' : ''}" data-tab="graphics">
            <span class="opt-tab-icon">🖥️</span> Graphics
          </button>
          <button type="button" class="opt-tab ${this.activeTab === 'audio' ? 'active' : ''}" data-tab="audio">
            <span class="opt-tab-icon">🔊</span> Audio
          </button>
        </nav>

        <!-- Tab Content -->
        <div class="opt-content">
          ${this.renderTabContent(s, currentKeys)}
        </div>

        <!-- Panel Footer -->
        <div class="opt-footer">
          <button type="button" class="opt-btn-reset" id="opt-reset-all">Reset All to Defaults</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderTabContent(s: Settings, currentKeys: Record<string, string[]>): string {
    switch (this.activeTab) {
      case 'controls':
        return `
          <div class="opt-pane opt-pane-controls">
            <div class="opt-group">
              <div class="opt-group-header">
                <h3>Camera Distance</h3>
                <span class="opt-badge" id="badge-zoom">${s.cameraZoom <= 0.05 ? 'Classic (Closest)' : s.cameraZoom >= 0.95 ? 'Modern (Farthest)' : `${Math.round(s.cameraZoom * 100)}%`}</span>
              </div>
              <div class="opt-slider-row">
                <span class="opt-slider-label">Classic</span>
                <input id="set-zoom" type="range" min="0" max="1" step="0.05" value="${s.cameraZoom}" />
                <span class="opt-slider-label">Modern</span>
              </div>
              <p class="opt-desc">Adjust the camera distance behind Drake. You can also scroll the mouse wheel dynamically while playing.</p>
            </div>

            <div class="opt-group">
              <div class="opt-group-header">
                <h3>Mouse Sensitivity</h3>
                <span class="opt-badge" id="badge-sens">${s.mouseSensitivity.toFixed(2)}x</span>
              </div>
              <div class="opt-slider-row">
                <span class="opt-slider-label">0.25x</span>
                <input id="set-sens" type="range" min="0.25" max="4" step="0.05" value="${s.mouseSensitivity}" />
                <span class="opt-slider-label">4.00x</span>
              </div>
              <p class="opt-desc">Controls the camera turning and vertical look speed when looking around with the mouse.</p>
            </div>

            <div class="opt-group opt-toggle-group">
              <label class="opt-toggle-label">
                <input id="set-invert" type="checkbox" ${s.invertMouseY ? 'checked' : ''} />
                <span class="opt-toggle-box"></span>
                <span class="opt-toggle-text">
                  <strong>Invert Mouse Y</strong>
                  <span class="opt-desc">Inverts vertical pitch when looking up and down with the mouse.</span>
                </span>
              </label>
            </div>
          </div>
        `;

      case 'keybindings': {
        const categories: { id: BindingCategory | 'all'; label: string }[] = [
          { id: 'all', label: 'All' },
          { id: 'movement', label: 'Movement' },
          { id: 'combat', label: 'Combat' },
          { id: 'actions', label: 'Actions' },
          { id: 'view', label: 'Camera' },
          { id: 'hotbar', label: 'Hotbar' },
        ];

        const filtered = BINDING_DEFINITIONS.filter(
          (d) => this.keyCategory === 'all' || d.category === this.keyCategory
        );

        return `
          <div class="opt-pane opt-pane-keys">
            <div class="opt-subtabs">
              ${categories
                .map(
                  (c) => `
                <button type="button" class="opt-subtab ${this.keyCategory === c.id ? 'active' : ''}" data-cat="${c.id}">
                  ${c.label}
                </button>
              `
                )
                .join('')}
            </div>

            ${
              this.listening
                ? `
              <div class="opt-listening-banner">
                <span class="pulse-dot">●</span> Press any key or mouse button to bind &nbsp;•&nbsp;
                <span class="hint-key">Esc</span> to cancel &nbsp;•&nbsp;
                <span class="hint-key">Del / Backspace</span> to clear
              </div>
            `
                : ''
            }

            <div class="opt-keys-table">
              <div class="opt-keys-head">
                <span>Action</span>
                <span>Primary</span>
                <span>Secondary</span>
              </div>
              <div class="opt-keys-body">
                ${filtered.map((def) => this.renderKeyRow(def, currentKeys[def.id] ?? def.defaultKeys)).join('')}
              </div>
            </div>

            <div class="opt-keys-footer">
              <button type="button" class="opt-btn-secondary" id="opt-reset-keys">Reset Keybindings to Default</button>
            </div>
          </div>
        `;
      }

      case 'graphics':
        return `
          <div class="opt-pane opt-pane-graphics">
            <div class="opt-group opt-toggle-group">
              <label class="opt-toggle-label">
                <input id="set-shadows" type="checkbox" ${s.silhouetteShadows ? 'checked' : ''} />
                <span class="opt-toggle-box"></span>
                <span class="opt-toggle-text">
                  <strong>Character Silhouette Shadows</strong>
                  <span class="opt-desc">Renders volumetric stencil silhouette shadows for Drake and creatures. When disabled, uses the original 1999 circular ground discs.</span>
                </span>
              </label>
            </div>

            <div class="opt-group opt-toggle-group">
              <label class="opt-toggle-label">
                <input id="set-object-shadows" type="checkbox" ${s.objectShadows ? 'checked' : ''} />
                <span class="opt-toggle-box"></span>
                <span class="opt-toggle-text">
                  <strong>Object Shadows</strong>
                  <span class="opt-desc">Barrels, trees, crates and larger plants cast shadows on the ground and grass around you. When disabled, the ground shows only the original baked light.</span>
                </span>
              </label>
            </div>

            <div class="opt-group">
              <div class="opt-group-header">
                <h3>Object Shadow Darkness</h3>
                <span class="opt-badge" id="badge-object-shadow-strength">${Math.round(s.objectShadowStrength * 100)}%</span>
              </div>
              <div class="opt-slider-row">
                <span class="opt-slider-label">Light</span>
                <input id="set-object-shadow-strength" type="range" min="0.1" max="1" step="0.05" value="${s.objectShadowStrength}" />
                <span class="opt-slider-label">Dark</span>
              </div>
              <p class="opt-desc">How much of the ground's light object shadows take away.</p>
            </div>

            <div class="opt-group opt-toggle-group">
              <label class="opt-toggle-label">
                <input id="set-lighting" type="checkbox" ${s.enhancedLighting ? 'checked' : ''} />
                <span class="opt-toggle-box"></span>
                <span class="opt-toggle-text">
                  <strong>Enhanced Dynamic Lighting</strong>
                  <span class="opt-desc">Wall torches, spells, and weapon collision sparks illuminate nearby dungeon stone with real-time dynamic light pools.</span>
                </span>
              </label>
            </div>

            <div class="opt-group opt-toggle-group">
              <label class="opt-toggle-label">
                <input id="set-fx" type="checkbox" ${s.smallEffects ? 'checked' : ''} />
                <span class="opt-toggle-box"></span>
                <span class="opt-toggle-text">
                  <strong>Smaller Hit Effects</strong>
                  <span class="opt-desc">Scales blood splatters, bone chips, and impact sparks to half size for cleaner visual clarity during high-intensity melee combat.</span>
                </span>
              </label>
            </div>

            <div class="opt-group opt-toggle-group">
              <label class="opt-toggle-label">
                <input id="set-foliage" type="checkbox" ${s.foliage ? 'checked' : ''} />
                <span class="opt-toggle-box"></span>
                <span class="opt-toggle-text">
                  <strong>Grass and Bushes</strong>
                  <span class="opt-desc">Grows instanced grass and bushes on the levels' grass ground, drawn with the ground's own texture and baked light. Only foliage near you sways in the wind, and it thins out with distance to stay cheap.</span>
                </span>
              </label>
            </div>

            <div class="opt-group">
              <div class="opt-group-header">
                <h3>Grass Render Distance</h3>
                <span class="opt-badge" id="badge-foliage-distance">${s.foliageDistance} m</span>
              </div>
              <div class="opt-slider-row">
                <span class="opt-slider-label">15 m</span>
                <input id="set-foliage-distance" type="range" min="15" max="90" step="5" value="${s.foliageDistance}" />
                <span class="opt-slider-label">90 m</span>
              </div>
              <p class="opt-desc">How far grass is drawn (bushes reach a little farther). Shorter is cheaper.</p>
            </div>

            <div class="opt-group">
              <div class="opt-group-header">
                <h3>Grass Density</h3>
                <span class="opt-badge" id="badge-foliageGrass">${Math.round(s.foliageGrass * 100)}%</span>
              </div>
              <div class="opt-slider-row">
                <span class="opt-slider-label">0%</span>
                <input id="set-foliageGrass" type="range" min="0" max="3" step="0.05" value="${s.foliageGrass}" />
                <span class="opt-slider-label">300%</span>
              </div>
              <p class="opt-desc">How many grass blades grow. Lower is cheaper.</p>
            </div>

            <div class="opt-group">
              <div class="opt-group-header">
                <h3>Bush Density</h3>
                <span class="opt-badge" id="badge-foliageBushes">${Math.round(s.foliageBushes * 100)}%</span>
              </div>
              <div class="opt-slider-row">
                <span class="opt-slider-label">0%</span>
                <input id="set-foliageBushes" type="range" min="0" max="3" step="0.05" value="${s.foliageBushes}" />
                <span class="opt-slider-label">300%</span>
              </div>
              <p class="opt-desc">How many bushes grow among the grass.</p>
            </div>

            <div class="opt-group">
              <div class="opt-group-header">
                <h3>Plant Density</h3>
                <span class="opt-badge" id="badge-foliagePlants">${Math.round(s.foliagePlants * 100)}%</span>
              </div>
              <div class="opt-slider-row">
                <span class="opt-slider-label">0%</span>
                <input id="set-foliagePlants" type="range" min="0" max="3" step="0.05" value="${s.foliagePlants}" />
                <span class="opt-slider-label">300%</span>
              </div>
              <p class="opt-desc">How many small leafy plants grow among the grass.</p>
            </div>

            <div class="opt-group opt-toggle-group">
              <label class="opt-toggle-label">
                <input id="set-prop-uvs" type="checkbox" ${s.fixedPropUvs ? 'checked' : ''} />
                <span class="opt-toggle-box"></span>
                <span class="opt-toggle-text">
                  <strong>Fix Mismatched Prop Textures</strong>
                  <span class="opt-desc">Refits props whose original texture mapping misses their picture, like the Citadel's fancy chairs (red legs, cut-off back frame).</span>
                </span>
              </label>
            </div>
          </div>
        `;

      case 'audio':
        return `
          <div class="opt-pane opt-pane-audio">
            <div class="opt-group">
              <div class="opt-group-header">
                <h3>Music Volume</h3>
                <span class="opt-badge" id="badge-music">${Math.round(s.musicVolume * 100)}%</span>
              </div>
              <div class="opt-slider-row">
                <span class="opt-slider-label">0%</span>
                <input id="set-music" type="range" min="0" max="1" step="0.05" value="${s.musicVolume}" />
                <span class="opt-slider-label">100%</span>
              </div>
              <p class="opt-desc">Master volume for the authentic 1999 Crusaders of Might and Magic ambient level soundtracks.</p>
            </div>

            <div class="opt-group opt-info-card">
              <h4>Sound Effects & Ambience</h4>
              <p class="opt-desc">Combat swings, weapon impacts, footstep acoustics, and spell sound effects are routed through your master system audio output.</p>
            </div>
          </div>
        `;
    }
  }

  private renderKeyRow(def: BindingDefinition, keys: string[]): string {
    const primary = keys[0] ?? '';
    const secondary = keys[1] ?? '';

    const isListeningPrimary = this.listening?.defId === def.id && this.listening?.slotIndex === 0;
    const isListeningSecondary = this.listening?.defId === def.id && this.listening?.slotIndex === 1;

    return `
      <div class="opt-key-row">
        <span class="opt-key-name">${def.label}</span>
        <div class="opt-key-slot">
          <button type="button" class="opt-key-chip ${isListeningPrimary ? 'listening' : ''} ${!primary ? 'empty' : ''}" data-def="${def.id}" data-slot="0">
            ${isListeningPrimary ? 'Press key…' : formatKeyCode(primary)}
          </button>
        </div>
        <div class="opt-key-slot">
          <button type="button" class="opt-key-chip ${isListeningSecondary ? 'listening' : ''} ${!secondary ? 'empty' : ''}" data-def="${def.id}" data-slot="1">
            ${isListeningSecondary ? 'Press key…' : formatKeyCode(secondary)}
          </button>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    // Tab switching
    this.root.querySelectorAll<HTMLButtonElement>('.opt-tab').forEach((tabBtn) => {
      tabBtn.addEventListener('click', () => {
        const tab = tabBtn.getAttribute('data-tab') as Tab;
        if (tab && tab !== this.activeTab) {
          this.stopListening();
          this.activeTab = tab;
          this.render();
        }
      });
    });

    // Subtab category filtering for keybindings
    this.root.querySelectorAll<HTMLButtonElement>('.opt-subtab').forEach((subBtn) => {
      subBtn.addEventListener('click', () => {
        const cat = subBtn.getAttribute('data-cat') as BindingCategory | 'all';
        if (cat) {
          this.stopListening();
          this.keyCategory = cat;
          this.render();
        }
      });
    });

    // Controls inputs
    const zoom = this.root.querySelector<HTMLInputElement>('#set-zoom');
    if (zoom) {
      zoom.addEventListener('input', () => {
        const val = Number(zoom.value);
        this.store.update({ cameraZoom: val });
        const badge = this.root.querySelector('#badge-zoom');
        if (badge) badge.textContent = val <= 0.05 ? 'Classic (Closest)' : val >= 0.95 ? 'Modern (Farthest)' : `${Math.round(val * 100)}%`;
      });
    }

    const sens = this.root.querySelector<HTMLInputElement>('#set-sens');
    if (sens) {
      sens.addEventListener('input', () => {
        const val = Number(sens.value);
        this.store.update({ mouseSensitivity: val });
        const badge = this.root.querySelector('#badge-sens');
        if (badge) badge.textContent = `${val.toFixed(2)}x`;
      });
    }

    const invert = this.root.querySelector<HTMLInputElement>('#set-invert');
    if (invert) {
      invert.addEventListener('change', () => {
        this.store.update({ invertMouseY: invert.checked });
      });
    }

    // Graphics inputs
    const shadows = this.root.querySelector<HTMLInputElement>('#set-shadows');
    if (shadows) {
      shadows.addEventListener('change', () => {
        this.store.update({ silhouetteShadows: shadows.checked });
      });
    }

    const objectShadows = this.root.querySelector<HTMLInputElement>('#set-object-shadows');
    if (objectShadows) {
      objectShadows.addEventListener('change', () => {
        this.store.update({ objectShadows: objectShadows.checked });
      });
    }

    const shadowStrength = this.root.querySelector<HTMLInputElement>('#set-object-shadow-strength');
    if (shadowStrength) {
      shadowStrength.addEventListener('input', () => {
        const val = Number(shadowStrength.value);
        this.store.update({ objectShadowStrength: val });
        const badge = this.root.querySelector('#badge-object-shadow-strength');
        if (badge) badge.textContent = `${Math.round(val * 100)}%`;
      });
    }

    const lighting = this.root.querySelector<HTMLInputElement>('#set-lighting');
    if (lighting) {
      lighting.addEventListener('change', () => {
        this.store.update({ enhancedLighting: lighting.checked });
      });
    }

    const fx = this.root.querySelector<HTMLInputElement>('#set-fx');
    if (fx) {
      fx.addEventListener('change', () => {
        this.store.update({ smallEffects: fx.checked });
      });
    }

    const foliage = this.root.querySelector<HTMLInputElement>('#set-foliage');
    if (foliage) {
      foliage.addEventListener('change', () => {
        this.store.update({ foliage: foliage.checked });
      });
    }

    const foliageDistance = this.root.querySelector<HTMLInputElement>('#set-foliage-distance');
    if (foliageDistance) {
      foliageDistance.addEventListener('input', () => {
        const val = Number(foliageDistance.value);
        this.store.update({ foliageDistance: val });
        const badge = this.root.querySelector('#badge-foliage-distance');
        if (badge) badge.textContent = `${val} m`;
      });
    }

    for (const key of ['foliageGrass', 'foliageBushes', 'foliagePlants'] as const) {
      const input = this.root.querySelector<HTMLInputElement>(`#set-${key}`);
      input?.addEventListener('input', () => {
        const val = Number(input.value);
        this.store.update({ [key]: val });
        const badge = this.root.querySelector(`#badge-${key}`);
        if (badge) badge.textContent = `${Math.round(val * 100)}%`;
      });
    }

    const propUvs = this.root.querySelector<HTMLInputElement>('#set-prop-uvs');
    if (propUvs) {
      propUvs.addEventListener('change', () => {
        this.store.update({ fixedPropUvs: propUvs.checked });
      });
    }

    // Audio input
    const music = this.root.querySelector<HTMLInputElement>('#set-music');
    if (music) {
      music.addEventListener('input', () => {
        const val = Number(music.value);
        this.store.update({ musicVolume: val });
        const badge = this.root.querySelector('#badge-music');
        if (badge) badge.textContent = `${Math.round(val * 100)}%`;
      });
    }

    // Key chip clicking to remap
    this.root.querySelectorAll<HTMLButtonElement>('.opt-key-chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const defId = chip.getAttribute('data-def');
        const slot = Number(chip.getAttribute('data-slot'));
        if (defId && (slot === 0 || slot === 1)) {
          this.startListening(defId, slot);
        }
      });
    });

    // Reset keybindings
    const resetKeys = this.root.querySelector<HTMLButtonElement>('#opt-reset-keys');
    if (resetKeys) {
      resetKeys.addEventListener('click', () => {
        this.stopListening();
        this.store.update({ keybindings: getDefaultKeybindings() });
        this.render();
      });
    }

    // Reset all settings
    const resetAll = this.root.querySelector<HTMLButtonElement>('#opt-reset-all');
    if (resetAll) {
      resetAll.addEventListener('click', () => {
        this.stopListening();
        this.store.update({
          cameraZoom: 0,
          mouseSensitivity: 1,
          invertMouseY: false,
          musicVolume: 0.5,
          silhouetteShadows: false,
          objectShadows: false,
          objectShadowStrength: 0.6,
          enhancedLighting: false,
          smallEffects: false,
          foliage: false,
          foliageDistance: 35,
          foliageGrass: 1,
          foliageBushes: 1,
          foliagePlants: 1,
          fixedPropUvs: true,
          keybindings: getDefaultKeybindings(),
        });
        this.render();
      });
    }
  }

  private startListening(defId: string, slotIndex: number): void {
    this.stopListening();
    this.listening = { defId, slotIndex };
    this.render();

    this.keyListener = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        this.stopListening();
        this.render();
        return;
      }

      if (e.code === 'Backspace' || e.code === 'Delete') {
        this.assignKey(defId, slotIndex, '');
        this.stopListening();
        this.render();
        return;
      }

      // Hotbar slots take Shift combos (row 2 is Shift+1-9); other bindings the plain key.
      const isHotbar = BINDING_DEFINITIONS.find((d) => d.id === defId)?.hotbar !== undefined;
      if (isHotbar && e.code.startsWith('Shift')) return; // Shift alone: wait for the key it modifies
      this.assignKey(defId, slotIndex, isHotbar ? comboCode(e) : e.code);
      this.stopListening();
      this.render();
    };

    this.mouseListener = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = `Mouse${e.button}`;
      this.assignKey(defId, slotIndex, code);
      this.stopListening();
      this.render();
    };

    window.addEventListener('keydown', this.keyListener, true);
    window.addEventListener('mousedown', this.mouseListener, true);
  }

  private stopListening(): void {
    if (this.keyListener) {
      window.removeEventListener('keydown', this.keyListener, true);
      this.keyListener = null;
    }
    if (this.mouseListener) {
      window.removeEventListener('mousedown', this.mouseListener, true);
      this.mouseListener = null;
    }
    this.listening = null;
  }

  private assignKey(defId: string, slotIndex: number, newCode: string): void {
    const s = this.store.current;
    const keybindings: Record<string, string[]> = {
      ...getDefaultKeybindings(),
      ...(s.keybindings ?? {}),
    };

    const current = [...(keybindings[defId] ?? [])];
    while (current.length < 2) current.push('');

    if (!newCode) {
      current[slotIndex] = '';
    } else {
      // If the code is already in the other slot for this same action, swap/remove it
      const otherSlot = slotIndex === 0 ? 1 : 0;
      if (current[otherSlot] === newCode) {
        current[otherSlot] = '';
      }
      current[slotIndex] = newCode;
    }

    // Clean up empty trailing entries
    const cleaned = current.filter((k) => !!k);
    keybindings[defId] = cleaned;

    this.store.update({ keybindings });
  }

  private updateValues(): void {
    if (this.listening) return;
    const s = this.store.current;
    const zoom = this.root.querySelector<HTMLInputElement>('#set-zoom');
    if (zoom && Number(zoom.value) !== s.cameraZoom) {
      zoom.value = String(s.cameraZoom);
      const badge = this.root.querySelector('#badge-zoom');
      if (badge) badge.textContent = s.cameraZoom <= 0.05 ? 'Classic (Closest)' : s.cameraZoom >= 0.95 ? 'Modern (Farthest)' : `${Math.round(s.cameraZoom * 100)}%`;
    }
  }
}
