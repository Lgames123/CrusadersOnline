# Rendering Pipeline: WebGL2, Shaders & Visual Aesthetics

## 1. Objective

Specify the Three.js WebGL2 rendering pipeline, lighting model, shadow passes, post-processing stack, and retro visual tuning to capture the late-90s atmospheric aesthetic of *Crusaders of Might and Magic* with modern clarity and high performance.

---

## 2. Rendering Pipeline Passes

```
+-------------------------------------------------------------------------------+
|                             THREE.JS RENDER PIPELINE                          |
+-------------------------------------------------------------------------------+
| 1. Shadow Map Pass: Directional sun light (Cascaded 1024x1024 shadow map)      |
| 2. Main Color Pass: Forward WebGL2 rendering of world geometry and characters |
|    - Ambient light: Low-intensity bluish dungeon ambient                      |
|    - Point lights: Flickering torchlight with distance attenuation            |
| 3. Particle System Pass: Additive blending for spell sparks & weapon trails   |
| 4. Floating Combat Text Pass: Screen-projected HTML5/Canvas damage numbers    |
| 5. Post-Processing Pass (Optional): Subtle vignette & color grading           |
+-------------------------------------------------------------------------------+
```

---

## 3. Materials & Texture Filtering

- **Filtering:** Nearest or Bilinear filtering with anisotropic filtering set to $2\times$ or $4\times$. Nearest filtering preserves the crisp, retro pixel-art aesthetic of 1999 128x128 textures.
- **Lighting Shader Model:** Blinn-Phong or lightweight PBR (`MeshStandardMaterial` with roughness clamped to 0.7–0.9 to avoid overly glossy modern looks).
- **Fog:** Distance-based exponential dungeon fog (`scene.fog = new THREE.FogExp2(0x0a0c14, 0.02)`) providing depth and mood.

---

## 4. Skeletal Mesh Animation

Characters utilize Three.js `AnimationMixer` with standard animation clips:
- `Idle`: 30-frame looped breathing sequence.
- `Walk`: 24-frame locomotion cycle.
- `Run`: 18-frame sprint cycle.
- `Attack_1`: 15-frame horizontal slash.
- `Attack_2`: 16-frame upward slash.
- `Attack_3`: 20-frame overhead cleave.
- `Block`: 10-frame shield raise.
- `Hit_React`: 8-frame flinch.
- `Death`: 30-frame collapse.

Transitions utilize smooth cross-fading (`action.crossFadeTo(nextAction, 0.15, true)`) to prevent abrupt snapping.
