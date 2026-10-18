import * as THREE from 'three';
import { LIGHT_DIR } from './model_light.ts';

/**
 * Object shadows (not original; the "objectShadows" setting): placed props (barrels, trees,
 * crates, the larger plants) and the foliage's bushes cast shadows on the level's ground and
 * grass, along the same slanted light as the characters' silhouettes. Built for cost:
 *
 * - Shadow maps from an orthographic camera along LIGHT_DIR, over a square around the view
 *   camera. Everything in them is static, so they are drawn again only when the camera has
 *   moved RECENTRE metres from where they were drawn, a caster appeared or went (a broken
 *   barrel), or the foliage grew or freed bushes. A still camera costs no shadow pass at all;
 *   turning round costs none either (the square is centred on the camera, not ahead of it).
 * - Two depth passes, flat materials (cut-out textures keep their holes: tree leaves, bush
 *   cards): the casters (a render layer), then the level's first surface past them along the
 *   light (level fragments at or in front of the casters' depth are discarded). A receiver is
 *   shaded where it lies behind a caster but not behind that level surface: a roof or a wall
 *   between a tree and a floor keeps the tree's shadow off it, while a cliff above a prop does
 *   not matter (the levels are canyons: with one nearest-surface map the cliffs hid most props).
 *   The level's own shadows are baked in its lightmap; nothing shades itself, so there is no
 *   acne to bias away.
 * - Receivers (the level's floors and walls, the grass) take four taps, each two
 *   hardware-filtered depth compares; pixels past the fade distance skip them. Shadows fade out
 *   between FADE[0] and FADE[1] from the camera, well inside the maps, so a redraw never shows
 *   an edge moving.
 * - Only the baked light is shadowed: a texel the lightmap leaves in shade gets SHADE_SHARE of
 *   the darkening, and torch / spell light (enhanced lighting) is added after the shadow.
 * Off, the receivers compile to their unchanged shaders and nothing is drawn.
 */

/** Map resolution (texels a side) and the half-size of the square it covers (metres). */
const MAP_SIZE = 2048;
const HALF = 36;
/** Shadows fade out between these distances from the camera (metres). */
const FADE: [number, number] = [22, 30];
/** The maps are drawn again once the camera is this far from where they were drawn (metres). */
const RECENTRE = 5;
/** How far up the light the shadow camera sits, and its depth range (metres). */
const LIGHT_BACK = 150;
const LIGHT_DEPTH = 300;
/** How dark a shadow makes fully lit ground (0 none, 1 black). */
const STRENGTH = 0.6;
/**
 * The share of that kept on ground the lightmap leaves in shade (the levels' outdoor ground is
 * mostly dim: at 0 most shadows would not show).
 */
const SHADE_SHARE = 0.85;
/** Depth bias (fraction of LIGHT_DEPTH, ~3 cm): grass roots inside a bush's base. */
const BIAS = 0.0001;
/** How far in front of the level's surface past a caster a receiver still counts as on it (~0.3 m: slopes, filtering). */
const LEVEL_BIAS = 0.001;
/** Seconds between checks that casters are still shown, and the least time between redraws. */
const CHECK_EVERY = 0.25;
const MIN_REDRAW = 0.5;
/** The render layers the shadow passes draw: the casters, then the level. */
export const CASTER_LAYER = 5;
const LEVEL_LAYER = 6;

/** Casters that come and go (the foliage's bush cells). */
export interface ShadowCasterSource {
  /** Changes whenever casters were added or removed. */
  readonly shadowVersion: number;
  /**
   * Puts the casters inside `box` on `layer` with flat materials (thinned as seen from `eye`),
   * runs `draw`, puts them back.
   */
  castShadows(box: THREE.Box3, eye: THREE.Vector3, layer: number, draw: () => void): void;
}

const VERTEX_PARS = 'uniform mat4 uPSMatrix;\nvarying vec3 vPSCoord;\nvarying vec2 vPSXZ;\n';
const FRAGMENT_PARS = `
uniform sampler2DShadow uPSMap;
uniform sampler2DShadow uPSLevel;
uniform vec4 uPSFocus; // camera x, z; fade start, end (metres)
uniform vec3 uPSParams; // texel size, strength, share kept in baked shade
varying vec3 vPSCoord;
varying vec2 vPSXZ;
float psTap( vec3 c ) {
  // Behind a caster, and not behind the level's first surface past it.
  return ( 1.0 - texture( uPSMap, c ) ) * texture( uPSLevel, vec3( c.xy, c.z - ${LEVEL_BIAS} ) );
}
// The share of the baked light 'lit' (linear) that reaches here.
float propShadow( vec3 lit ) {
  float fade = 1.0 - smoothstep( uPSFocus.z, uPSFocus.w, distance( vPSXZ, uPSFocus.xy ) );
  if ( fade <= 0.0 || uPSParams.y <= 0.0 ) return 1.0;
  vec3 c = vPSCoord;
  if ( c.x <= 0.0 || c.y <= 0.0 || c.x >= 1.0 || c.y >= 1.0 || c.z >= 1.0 ) return 1.0;
  c.z -= ${BIAS};
  float t = uPSParams.x * 0.75;
  float shade = 0.25 * ( psTap( c + vec3( -t, -t, 0.0 ) ) + psTap( c + vec3( t, -t, 0.0 ) )
    + psTap( c + vec3( -t, t, 0.0 ) ) + psTap( c + vec3( t, t, 0.0 ) ) );
  // Ground the lightmap leaves in shade (the baked shadows, unlit corners) is darkened less.
  float sun = mix( uPSParams.z, 1.0, smoothstep( 0.06, 0.4, dot( lit, vec3( 0.2126, 0.7152, 0.0722 ) ) ) );
  return 1.0 - shade * fade * sun * uPSParams.y;
}
`;
/** MeshBasic (the level): world position from the model matrix; the lightmap texel is the light. */
const BASIC_VERTEX = 'vec4 psWorld = modelMatrix * vec4( transformed, 1.0 );\nvPSCoord = ( uPSMatrix * psWorld ).xyz;\nvPSXZ = psWorld.xz;\n';
const BASIC_FRAGMENT = `
#ifdef USE_LIGHTMAP
  reflectedLight.indirectDiffuse *= propShadow( lightMapTexel.rgb );
#endif
reflectedLight.indirectDiffuse *= diffuseColor.rgb;`;
/** Foliage grass (world-space vertices; its colour is the lightmap texel / pi). */
const FOLIAGE_VERTEX = 'vPSCoord = ( uPSMatrix * vec4( world, 1.0 ) ).xyz;\nvPSXZ = world.xz;\n';
const FOLIAGE_FRAGMENT = 'col.rgb *= propShadow( vColor * 3.14159265 );';

export type ReceiverKind = 'basic' | 'foliage';

interface Drawn {
  mesh: THREE.Mesh;
  shown: boolean;
}

function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** A flat depth material for the casters' pass (a cut-out map keeps its holes). */
function casterMaterial(map: THREE.Texture | null, alphaTest: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, colorWrite: false });
  if (map) {
    m.map = map;
    m.alphaTest = Math.max(0.5, alphaTest);
  }
  return m;
}

/** The level's pass: drops fragments at or in front of the casters' depth (`casters`), so the first one past them stays. */
function levelMaterial(map: THREE.Texture | null, alphaTest: number, casters: { value: THREE.DepthTexture | null }): THREE.MeshBasicMaterial {
  const m = casterMaterial(map, alphaTest);
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uPSMap'] = casters;
    shader.fragmentShader = 'uniform sampler2DShadow uPSMap;\n' + shader.fragmentShader.replace(
      'void main() {',
      `void main() {\n  if ( texture( uPSMap, vec3( gl_FragCoord.xy / ${MAP_SIZE.toFixed(1)}, gl_FragCoord.z ) ) > 0.5 ) discard;`,
    );
  };
  m.customProgramCacheKey = () => 'prop-shadow-level';
  return m;
}

export class PropShadows {
  private on = false;
  private readonly receivers = new Set<THREE.Material>();
  private readonly uniforms = {
    uPSMap: { value: null as THREE.DepthTexture | null },
    uPSLevel: { value: null as THREE.DepthTexture | null },
    uPSMatrix: { value: new THREE.Matrix4() },
    uPSFocus: { value: new THREE.Vector4(0, 0, FADE[0], FADE[1]) },
    uPSParams: { value: new THREE.Vector3(1 / MAP_SIZE, 0, SHADE_SHARE) },
  };
  /** The casters' depth, and the level's first surface past them. */
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private readonly camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 1, LIGHT_DEPTH);
  private readonly rotation = new THREE.Quaternion();
  private readonly rotationInv = new THREE.Quaternion();
  private casters: Drawn[] = [];
  private blockers: Drawn[] = [];
  private source: ShadowCasterSource | null = null;
  private sourceVersion = -1;
  /** Where the maps were last drawn from (Infinity: never). */
  private readonly drawnAt = new THREE.Vector3(Infinity, 0, 0);
  private dirty = true;
  private sinceCheck = 0;
  private sinceDraw = Infinity;
  private readonly casterOpaque = casterMaterial(null, 0);
  private readonly levelOpaque = levelMaterial(null, 0, this.uniforms.uPSMap);
  private readonly cutouts = [new WeakMap<THREE.Material, THREE.MeshBasicMaterial>(), new WeakMap<THREE.Material, THREE.MeshBasicMaterial>()];
  private readonly eye = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly box = new THREE.Box3();
  private readonly clearColor = new THREE.Color();
  /** Shadow redraws, and the last one's milliseconds (CPU; for tuning). */
  draws = 0;
  lastDrawMs = 0;

  constructor() {
    // Looking along the light; "up" any axis not parallel to it.
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(LIGHT_DIR);
    this.rotation.copy(this.camera.quaternion);
    this.rotationInv.copy(this.rotation).invert();
  }

  get enabled(): boolean {
    return this.on;
  }

  /** On: the maps are built on the next update. Off: freed, receivers back to their own shaders. */
  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.uniforms.uPSParams.value.y = 0;
    if (!on) {
      for (const t of this.targets ?? []) t.dispose();
      this.targets = null;
      this.uniforms.uPSMap.value = null;
      this.uniforms.uPSLevel.value = null;
    }
    this.invalidate();
    for (const m of this.receivers) m.needsUpdate = true;
  }

  /**
   * Lets a material take the object shadows while they are on ('basic': a lightmapped
   * MeshBasicMaterial; 'foliage': the grass shader). Call after dynamicLights.enhance, whose
   * shader changes it wraps.
   */
  receive(material: THREE.Material, kind: ReceiverKind): void {
    if (this.receivers.has(material)) return;
    this.receivers.add(material);
    material.addEventListener('dispose', () => this.receivers.delete(material));
    const before = material.onBeforeCompile.bind(material);
    const beforeKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      // Even off: three reuses a variant compiled before with the uniforms of the last compile.
      Object.assign(shader.uniforms, this.uniforms);
      if (!this.on) return;
      if (kind === 'basic') {
        shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + BASIC_VERTEX);
        shader.fragmentShader = FRAGMENT_PARS + shader.fragmentShader.replace('reflectedLight.indirectDiffuse *= diffuseColor.rgb;', BASIC_FRAGMENT);
      } else {
        shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace('// PROP_SHADOW_VERTEX', FOLIAGE_VERTEX);
        shader.fragmentShader = FRAGMENT_PARS + shader.fragmentShader.replace('// PROP_SHADOW_FRAGMENT', FOLIAGE_FRAGMENT);
      }
    };
    material.customProgramCacheKey = () => beforeKey() + (this.on ? `|prop-shadows-${kind}` : '');
    if (this.on) material.needsUpdate = true;
  }

  /**
   * A new level: the placed objects that cast (their meshes, but for glows and light volumes:
   * additive or faint see-through ones), and the level's meshes, which only stop shadows (but
   * for blended see-through ones: water).
   */
  setLevel(casters: THREE.Object3D[], level: THREE.Mesh[]): void {
    for (const d of this.casters) d.mesh.layers.disable(CASTER_LAYER);
    for (const d of this.blockers) d.mesh.layers.disable(LEVEL_LAYER);
    this.casters = [];
    this.blockers = [];
    for (const object of casters) {
      object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        if ([mesh.material].flat().some((m) => m.blending !== THREE.NormalBlending || (m.transparent && m.opacity < 0.5) || !m.visible)) return;
        mesh.layers.enable(CASTER_LAYER);
        this.casters.push({ mesh, shown: isShown(mesh) });
      });
    }
    for (const mesh of level) {
      if ([mesh.material].flat().some((m) => m.transparent)) continue;
      mesh.layers.enable(LEVEL_LAYER);
      this.blockers.push({ mesh, shown: true });
    }
    this.invalidate();
  }

  /** Casters that come and go (the foliage), or null. */
  setSource(source: ShadowCasterSource | null): void {
    this.source = source;
    this.sourceVersion = -1;
  }

  /** Draws the maps again on the next update. */
  invalidate(): void {
    this.dirty = true;
  }

  /** Every frame, before the scene is drawn: redraws the maps when the camera moved or casters changed. */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    if (!this.on) return;
    const eye = camera.getWorldPosition(this.eye);
    this.uniforms.uPSFocus.value.x = eye.x;
    this.uniforms.uPSFocus.value.y = eye.z;
    this.sinceDraw += dt;
    if ((this.sinceCheck += dt) >= CHECK_EVERY) {
      this.sinceCheck = 0;
      for (const c of this.casters) {
        const shown = isShown(c.mesh);
        if (shown !== c.shown) (c.shown = shown), (this.dirty = true);
      }
      if (this.source && this.source.shadowVersion !== this.sourceVersion && this.sinceDraw >= MIN_REDRAW) this.dirty = true;
    }
    const moved = Math.hypot(eye.x - this.drawnAt.x, eye.z - this.drawnAt.z) > RECENTRE || Math.abs(eye.y - this.drawnAt.y) > RECENTRE;
    if (!this.dirty && !moved) return;
    this.draw(renderer, scene, eye);
  }

  private draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, at: THREE.Vector3): void {
    const start = performance.now();
    this.dirty = false;
    this.sinceDraw = 0;
    this.draws++;
    this.drawnAt.copy(at);
    if (this.source) this.sourceVersion = this.source.shadowVersion;
    if (!this.targets) {
      const target = () => {
        const depth = new THREE.DepthTexture(MAP_SIZE, MAP_SIZE);
        depth.compareFunction = THREE.LessEqualCompare;
        depth.minFilter = depth.magFilter = THREE.LinearFilter; // 2 x 2 filtered compare per tap
        // Its colour is not used (one byte a texel: a target needs one).
        return new THREE.WebGLRenderTarget(MAP_SIZE, MAP_SIZE, { depthTexture: depth, format: THREE.RedFormat, generateMipmaps: false, depthBuffer: true, stencilBuffer: false });
      };
      this.targets = [target(), target()];
      this.uniforms.uPSMap.value = this.targets[0].depthTexture;
      this.uniforms.uPSLevel.value = this.targets[1].depthTexture;
    }
    const [casterTarget, levelTarget] = this.targets;
    // The centre snapped to whole texels across the light, so redraws do not shimmer.
    const texel = (2 * HALF) / MAP_SIZE;
    const local = this.v.copy(at).applyQuaternion(this.rotationInv);
    local.x = Math.round(local.x / texel) * texel;
    local.y = Math.round(local.y / texel) * texel;
    const centre = local.applyQuaternion(this.rotation);
    this.camera.position.copy(centre).addScaledVector(LIGHT_DIR, -LIGHT_BACK);
    this.camera.updateMatrixWorld(true);
    this.uniforms.uPSMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(this.camera.projectionMatrix)
      .multiply(this.camera.matrixWorldInverse);

    // Materials swapped for flat ones for the passes.
    const drawn = [...this.casters, ...this.blockers];
    const saved = drawn.map((d) => d.mesh.material);
    this.casters.forEach((d) => (d.mesh.material = this.flat(0, d.mesh.material)));
    this.blockers.forEach((d) => (d.mesh.material = this.flat(1, d.mesh.material)));
    const prevTarget = renderer.getRenderTarget();
    const background = scene.background;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    const pass = (target: THREE.WebGLRenderTarget, layer: number) => {
      this.camera.layers.set(layer);
      renderer.setRenderTarget(target);
      renderer.clear(true, true, false);
      renderer.render(scene, this.camera);
    };
    try {
      if (this.source) {
        this.box.setFromCenterAndSize(at, this.v.set(HALF * 2.2, LIGHT_DEPTH, HALF * 2.2));
        this.source.castShadows(this.box, at, CASTER_LAYER, () => pass(casterTarget, CASTER_LAYER));
      } else pass(casterTarget, CASTER_LAYER);
      pass(levelTarget, LEVEL_LAYER);
    } finally {
      scene.background = background;
      renderer.setClearColor(this.clearColor, clearAlpha);
      renderer.setRenderTarget(prevTarget);
      drawn.forEach((d, i) => (d.mesh.material = saved[i]!));
    }
    this.uniforms.uPSParams.value.setY(STRENGTH);
    this.lastDrawMs = performance.now() - start;
  }

  /** The pass's stand-in for `m` (0 the casters', 1 the level's): a shared opaque one, or one keeping a cut-out map's holes. */
  private flat(pass: 0 | 1, m: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
    if (Array.isArray(m)) return m.map((x) => this.flat(pass, x) as THREE.Material);
    const src = m as THREE.MeshBasicMaterial;
    if (!src.map || (!src.alphaTest && !src.transparent)) return pass ? this.levelOpaque : this.casterOpaque;
    const cache = this.cutouts[pass]!;
    let d = cache.get(m);
    if (!d) cache.set(m, (d = pass ? levelMaterial(src.map, src.alphaTest, this.uniforms.uPSMap) : casterMaterial(src.map, src.alphaTest)));
    return d;
  }
}

/** The client's object shadows (one scene). */
export const propShadows = new PropShadows();
