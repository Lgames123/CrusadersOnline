import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Enhanced lighting's image pipeline (not original): the scene drawn in HDR (half float, 4x
 * MSAA), a faint bloom on what goes well past white (flames, sparks; at half resolution and
 * below, as UnrealBloomPass does), then a grade: a highlight shoulder in place of a hard clip
 * (shadows and mid-tones stay exactly as the classic picture), a touch of saturation and a faint
 * vignette. Off, the scene is drawn straight to the screen as before, untouched.
 */

const BLOOM_STRENGTH = 0.25;
const BLOOM_RADIUS = 0.2;
/** Linear brightness a pixel needs to bloom: past lit texture (up to 2 with the lightmap's x2 gain), so flames and sparks. */
const BLOOM_THRESHOLD = 2;
/** Linear level above which highlights roll off towards white instead of clipping. */
const SHOULDER = 0.8;
const SATURATION = 1.03;
const VIGNETTE = 0.1;

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uShoulder: { value: SHOULDER },
    uSaturation: { value: SATURATION },
    uVignette: { value: VIGNETTE },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uShoulder;
    uniform float uSaturation;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 t = texture2D( tDiffuse, vUv );
      // Linear HDR in, linear [0, 1] out (OutputPass converts to sRGB).
      vec3 c = max( t.rgb, 0.0 );
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c = max( mix( vec3( l ), c, uSaturation ), 0.0 );
      c *= mix( 1.0 - uVignette, 1.0, smoothstep( 0.85, 0.35, length( vUv - 0.5 ) ) );
      // Unchanged up to the shoulder, then easing towards 1 (never past it).
      vec3 over = max( c - uShoulder, 0.0 );
      c = min( c, uShoulder ) + over / ( 1.0 + over / ( 1.0 - uShoulder ) );
      gl_FragColor = vec4( c, t.a );
    }`,
};

export class PostFx {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private on = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.renderer = renderer;
    this.scene = scene;
  }

  get enabled(): boolean {
    return this.on;
  }

  /** On: built on first use. Off: the composer's targets are freed. */
  set enabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (!on && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.renderPass = null;
    }
  }

  render(camera: THREE.Camera, dt: number): void {
    if (!this.on) {
      this.renderer.render(this.scene, camera);
      return;
    }
    const composer = (this.composer ??= this.build());
    this.renderPass!.camera = camera;
    composer.render(dt);
  }

  setSize(width: number, height: number): void {
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(width, height);
  }

  private build(): EffectComposer {
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(this.scene, new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    composer.addPass(new UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD));
    composer.addPass(new ShaderPass(GradeShader));
    composer.addPass(new OutputPass());
    return composer;
  }
}
