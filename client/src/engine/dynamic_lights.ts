import * as THREE from 'three';

/**
 * Enhanced lighting (not original; the "classic" setting leaves every shader as the original
 * draws it): point lights added per pixel on top of the baked light, on the level and on the
 * unlit models. One shader variant for any number of lights: the CPU picks the MAX_LIGHTS that
 * matter to the camera each frame and writes them into fixed uniform arrays, so lights coming
 * and going (other players' torches, sparks) never recompile anything and the cost per pixel is
 * bounded however many players carry a torch.
 */

/** Lights evaluated per pixel (the shader's loop bound). */
const MAX_LIGHTS = 16;
/** Lights farther than this from the camera are not considered (metres; the fog hides them). */
const MAX_RANGE = 60;
/** Seconds between re-picking the lights in use. */
const PICK_EVERY = 0.2;
/** How fast a light fades in / out when it enters or leaves the set in use (per second). */
const FADE = 4;
/** Falloff: a smooth window to the radius, times an inverse-square-like term this steep. */
const FALLOFF = 6;
/** Rim light on models: strength (of their brightest ambient side) and how tight to the edge. */
const RIM = 0.35;
const RIM_POWER = 3;
/** Wrapped diffuse: light reaches a little past the terminator, softer on low-poly models. */
const WRAP = 0.35;

interface Source {
  position: THREE.Vector3;
  /** Linear colour times intensity (a fraction of the surface's own texture colour). */
  color: THREE.Color;
  radius: number;
  /** Flicker amount (0: steady). */
  flicker: number;
  phase: number;
  /** Seconds left for a flash, Infinity for a lasting light. */
  life: number;
  duration: number;
  /** Fade weight, eased towards 1 while picked. */
  weight: number;
  picked: boolean;
}

const VERTEX_PARS = 'varying vec3 vDynPos;\nvarying vec3 vDynNormal;\n';
const VERTEX = `
#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
  vec3 dynN = objectNormal;
#else
  vec3 dynN = vec3( normal );
#endif
vDynNormal = normalize( mat3( modelMatrix ) * dynN );
vDynPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;
const FRAGMENT_PARS = `
#define DYN_MAX ${MAX_LIGHTS}
uniform vec4 uDynPos[ DYN_MAX ];
uniform vec3 uDynColor[ DYN_MAX ];
uniform int uDynCount;
#ifdef DYN_AMBIENT
uniform vec3 uDynAmbient[ 6 ];
#endif
varying vec3 vDynPos;
varying vec3 vDynNormal;
`;
const FRAGMENT = `
{
  // The texture's own colour: the material colour of models and brushes is their light.
  vec3 dynAlbedo = diffuseColor.rgb / max( diffuse, vec3( 1e-3 ) );
  vec3 dynN = normalize( vDynNormal ) * ( gl_FrontFacing ? 1.0 : -1.0 );
  vec3 dynSum = vec3( 0.0 );
  for ( int i = 0; i < DYN_MAX; i ++ ) {
    if ( i >= uDynCount ) break;
    vec4 p = uDynPos[ i ];
    vec3 L = p.xyz - vDynPos;
    float d2 = dot( L, L );
    float r2 = p.w * p.w;
    if ( d2 >= r2 ) continue;
    float win = 1.0 - d2 / r2;
    float ndl = ( dot( dynN, L * inversesqrt( max( d2, 1e-4 ) ) ) + ${WRAP.toFixed(2)} ) / ${(1 + WRAP).toFixed(2)};
    float k = d2 / r2;
    dynSum += uDynColor[ i ] * ( win * win / ( 1.0 + ${FALLOFF.toFixed(1)} * k ) * max( ndl, 0.0 ) );
  }
#ifdef DYN_AMBIENT
  // Models: the ambient cube of the place they stand in, instead of the one floor light.
  vec3 n2 = dynN * dynN;
  vec3 amb = n2.x * ( dynN.x > 0.0 ? uDynAmbient[ 0 ] : uDynAmbient[ 1 ] )
    + n2.y * ( dynN.y > 0.0 ? uDynAmbient[ 2 ] : uDynAmbient[ 3 ] )
    + n2.z * ( dynN.z > 0.0 ? uDynAmbient[ 4 ] : uDynAmbient[ 5 ] );
  vec3 rimLight = max( max( uDynAmbient[ 0 ], uDynAmbient[ 1 ] ), max( max( uDynAmbient[ 2 ], uDynAmbient[ 4 ] ), uDynAmbient[ 5 ] ) );
  float rim = pow( 1.0 - max( dot( dynN, normalize( cameraPosition - vDynPos ) ), 0.0 ), ${RIM_POWER.toFixed(1)} );
  reflectedLight.indirectDiffuse = dynAlbedo * ( amb + rimLight * ( ${RIM.toFixed(2)} * rim ) );
#endif
  reflectedLight.indirectDiffuse += dynAlbedo * dynSum;
}
vec3 outgoingLight = reflectedLight.indirectDiffuse;
`;

export class DynamicLights {
  private readonly sources = new Map<unknown, Source>();
  private readonly materials = new Set<THREE.Material>();
  private readonly uniforms = {
    uDynPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
    uDynColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color()) },
    uDynCount: { value: 0 },
  };
  private on = false;
  private pick = 0;
  private time = 0;
  private readonly cam = new THREE.Vector3();

  /** Enhanced lighting on (recompiles the enhanced materials once per switch). */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    for (const m of this.materials) m.needsUpdate = true;
  }

  /**
   * Lets an unlit (MeshBasic) material take the dynamic lights while enhanced lighting is on.
   * Off, it compiles to the unchanged original shader. `ambient`: a model's ambient cube (six
   * colours, LevelLight.ambientCube), lighting it in place of its material colour.
   */
  enhance(material: THREE.Material, ambient?: { value: THREE.Color[] }): void {
    if (!(material as THREE.MeshBasicMaterial).isMeshBasicMaterial || this.materials.has(material)) return;
    this.materials.add(material);
    material.addEventListener('dispose', () => this.materials.delete(material));
    material.onBeforeCompile = (shader) => {
      if (!this.on) return;
      Object.assign(shader.uniforms, this.uniforms);
      if (ambient) shader.uniforms['uDynAmbient'] = ambient;
      shader.vertexShader = VERTEX_PARS + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + VERTEX);
      shader.fragmentShader = (ambient ? '#define DYN_AMBIENT\n' : '') + FRAGMENT_PARS + shader.fragmentShader.replace('vec3 outgoingLight = reflectedLight.indirectDiffuse;', FRAGMENT);
    };
    material.customProgramCacheKey = () => (this.on ? (ambient ? 'dynamic-lights-ambient' : 'dynamic-lights') : 'classic');
    if (this.on) material.needsUpdate = true;
  }

  /**
   * Adds or moves a lasting light. `intensity`: how much of the lit surface's own colour it adds
   * at its centre; `radius`: metres to where it reaches nothing.
   */
  set(key: unknown, position: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, radius: number, flicker = 0): void {
    let s = this.sources.get(key);
    if (!s) {
      s = { position: new THREE.Vector3(), color: new THREE.Color(), radius: 0, flicker, phase: Math.random() * 100, life: Infinity, duration: Infinity, weight: 0, picked: false };
      this.sources.set(key, s);
      this.pick = 0;
    }
    s.position.copy(position);
    s.color.set(color).multiplyScalar(intensity);
    s.radius = radius;
    s.flicker = flicker;
  }

  /** A short light that fades out over `seconds` (sparks, impacts). */
  flash(position: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, radius: number, seconds: number): void {
    if (!this.on) return;
    const key = {};
    this.set(key, position, color, intensity, radius);
    const s = this.sources.get(key)!;
    s.life = s.duration = seconds;
    s.weight = 1;
  }

  remove(key: unknown): void {
    this.sources.delete(key);
  }

  /** Removes the lasting lights whose string key starts with `prefix`. */
  removePrefix(prefix: string): void {
    for (const k of [...this.sources.keys()]) if (typeof k === 'string' && k.startsWith(prefix)) this.sources.delete(k);
  }

  /** Every frame: picks the lights near the camera, eases them in / out, uploads them. */
  update(camera: THREE.Camera, dt: number): void {
    this.time += dt;
    if (!this.on) {
      this.uniforms.uDynCount.value = 0;
      return;
    }
    camera.getWorldPosition(this.cam);
    for (const [k, s] of this.sources) {
      if (s.life === Infinity) continue;
      if ((s.life -= dt) <= 0) this.sources.delete(k);
    }
    if ((this.pick -= dt) <= 0) {
      this.pick = PICK_EVERY;
      const near: { s: Source; d: number }[] = [];
      for (const s of this.sources.values()) {
        s.picked = false;
        // Distance to the edge of its reach: a big light far off can still light the view.
        const d = Math.max(0, s.position.distanceTo(this.cam) - s.radius);
        if (d < MAX_RANGE) near.push({ s, d });
      }
      near.sort((a, b) => a.d - b.d);
      for (let i = 0; i < near.length && i < MAX_LIGHTS; i++) near[i]!.s.picked = true;
    }
    const used: Source[] = [];
    for (const s of this.sources.values()) {
      if (s.life === Infinity) s.weight = s.picked ? Math.min(1, s.weight + dt * FADE) : Math.max(0, s.weight - dt * FADE);
      if (s.weight > 0) used.push(s);
    }
    // Lights fading out beyond the budget are dropped first.
    if (used.length > MAX_LIGHTS) used.sort((a, b) => b.weight - a.weight).length = MAX_LIGHTS;
    const pos = this.uniforms.uDynPos.value;
    const col = this.uniforms.uDynColor.value;
    used.forEach((s, i) => {
      let k = s.weight;
      if (s.flicker) k *= 1 - s.flicker * (0.5 + 0.3 * Math.sin(this.time * 11 + s.phase) + 0.2 * Math.sin(this.time * 23.7 + s.phase * 1.7));
      if (s.life !== Infinity) k *= s.life / s.duration;
      pos[i]!.set(s.position.x, s.position.y, s.position.z, s.radius);
      col[i]!.copy(s.color).multiplyScalar(k);
    });
    this.uniforms.uDynCount.value = used.length;
  }
}

/** The client's dynamic lights (one scene). */
export const dynamicLights = new DynamicLights();
