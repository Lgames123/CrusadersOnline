import * as THREE from 'three';

/**
 * A refined weapon's star dust (MMO items; not original, after Rappelz's galaxy stones): from +3
 * twinkling four-point stars rise off the held weapon's surface and swirl round its long axis,
 * with soft nebula motes from +7. Particles live in world space from the moment they spawn, so a
 * swing leaves a spiral of stars behind the blade. Count, size, reach, swirl and brightness all
 * grow with the refinement; the palette follows the glow's tiers (weapon_glow.ts).
 */
const PALETTES: readonly { from: number; colors: readonly number[] }[] = [
  { from: 9, colors: [0xffd700, 0xffab40, 0xfff59d, 0xffffff, 0xd500f9] },
  { from: 7, colors: [0xd500f9, 0x7c4dff, 0x3d5afe, 0xff80ab, 0xffffff] },
  { from: 5, colors: [0x00e5ff, 0x4fc3f7, 0x7c4dff, 0xffffff] },
  { from: 3, colors: [0xcfd8dc, 0xe3f2fd, 0xffffff] },
];
const FIRST = 3;
const MAX = 256;
/** Surface points sampled per weapon model, to spawn on. */
const SAMPLES = 256;

interface Star {
  /** World: the point on the weapon's axis it swirls round, the axis, and its radial frame. */
  c: THREE.Vector3;
  axis: THREE.Vector3;
  u: THREE.Vector3;
  w: THREE.Vector3;
  r0: number;
  drift: number;
  rise: number;
  spin: number;
  age: number;
  life: number;
  size: number;
  twinkle: number;
  phase: number;
  turn: number;
  soft: number;
  color: THREE.Color;
}

const VERTEX = /* glsl */ `
uniform float scale;
attribute float size;
attribute float alpha;
attribute float angle;
attribute float soft;
attribute vec3 tint;
varying float vAlpha;
varying float vAngle;
varying float vSoft;
varying vec3 vTint;
void main() {
  vAlpha = alpha;
  vAngle = angle;
  vSoft = soft;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(-mv.z, 0.01);
  gl_Position = projectionMatrix * mv;
}`;

/** A four-point star with a white-hot core and a faint halo; a soft disc for nebula motes. */
const FRAGMENT = /* glsl */ `
varying float vAlpha;
varying float vAngle;
varying float vSoft;
varying vec3 vTint;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vAngle), s = sin(vAngle);
  p = mat2(c, -s, s, c) * p;
  float r2 = dot(p, p);
  float core = exp(-r2 * 20.0);
  float rays = exp(-abs(p.x) * 24.0) * exp(-abs(p.y) * 3.2) + exp(-abs(p.y) * 24.0) * exp(-abs(p.x) * 3.2);
  float star = core + rays * 0.75 + exp(-r2 * 3.5) * 0.3;
  float a = mix(star, exp(-r2 * 3.0) * 0.8, vSoft) * (1.0 - smoothstep(0.8, 1.0, sqrt(r2)));
  vec3 color = mix(vTint, vec3(1.0), core * 0.7 * (1.0 - vSoft));
  gl_FragColor = vec4(color, a * vAlpha);
}`;

/** The star dust of the weapon held at 'WPN RIGHT'. */
export class WeaponSparkles {
  private readonly points: THREE.Points;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private readonly stars: Star[] = [];
  private readonly attrs: { position: Float32Array; size: Float32Array; alpha: Float32Array; angle: Float32Array; soft: Float32Array; tint: Float32Array };
  /** The held model sampled, and in its frame: surface points, the long axis and its length. */
  private held: THREE.Object3D | null = null;
  private surface: THREE.Vector3[] = [];
  private axis = new THREE.Vector3(0, 1, 0);
  private axisAt = new THREE.Vector3();
  private length = 1;
  private owed = 0;
  private t = 0;

  /** 0-1 of the full strength (the itemGlow / itemGlowIntensity settings); 0 = none. */
  intensity = 1;

  constructor(scene: THREE.Scene) {
    this.attrs = {
      position: new Float32Array(MAX * 3),
      size: new Float32Array(MAX),
      alpha: new Float32Array(MAX),
      angle: new Float32Array(MAX),
      soft: new Float32Array(MAX),
      tint: new Float32Array(MAX * 3),
    };
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.attrs.position, 3).setUsage(THREE.DynamicDrawUsage));
    for (const name of ['size', 'alpha', 'angle', 'soft'] as const) this.geometry.setAttribute(name, new THREE.BufferAttribute(this.attrs[name], 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(this.attrs.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 1 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'weapon-sparkles';
    this.points.frustumCulled = false;
    this.points.visible = false;
    // Point sizes are world metres: pixels per metre at distance 1 for this frame's camera.
    const size = new THREE.Vector2();
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      this.material.uniforms['scale']!.value = (renderer.getDrawingBufferSize(size).y * camera.projectionMatrix.elements[5]!) / 2;
    };
    scene.add(this.points);
  }

  /** Each frame: the avatar's model and the held weapon's refinement (0 = none). */
  update(model: THREE.Object3D, plus: number, dt: number): void {
    this.t += dt;
    let mount: THREE.Object3D | undefined;
    model.traverse((o) => {
      if (!mount && o.name.trim().endsWith('WPN RIGHT')) mount = o;
    });
    const held = mount?.children.find((c) => c.name !== 'held-glow') ?? null;
    if (held !== this.held) this.sample(held);
    // Stars already out finish their life when the weapon is put away or the setting drops.
    if (held && plus >= FIRST && this.intensity > 0 && this.surface.length && model.visible) this.spawn(held, plus, dt);
    this.step(dt);
  }

  private sample(held: THREE.Object3D | null): void {
    this.held = held;
    this.surface = [];
    if (!held) return;
    held.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(held.matrixWorld).invert();
    const tris: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; area: number }[] = [];
    const box = new THREE.Box3();
    held.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const toHeld = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      const pos = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      const n = index ? index.count : pos.count;
      const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(toHeld);
      for (let i = 0; i + 2 < n; i += 3) {
        const [a, b, c] = [at(i), at(i + 1), at(i + 2)];
        box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
        const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
        if (area > 0) tris.push({ a, b, c, area });
      }
    });
    if (!tris.length) return;
    // The long axis runs through the box centre along its largest side; the grip is the held
    // model's origin, so points farther from it along the axis (the blade, the head) weigh more.
    const extent = box.getSize(new THREE.Vector3());
    const k = extent.x >= extent.y && extent.x >= extent.z ? 0 : extent.y >= extent.z ? 1 : 2;
    this.axis.set(0, 0, 0).setComponent(k, 1);
    box.getCenter(this.axisAt);
    this.length = Math.max(extent.getComponent(k), 0.05);
    const reach = Math.max(Math.abs(box.min.getComponent(k)), Math.abs(box.max.getComponent(k)), 1e-6);
    const weight = tris.map((t) => t.area * (0.25 + Math.abs((t.a.getComponent(k) + t.b.getComponent(k) + t.c.getComponent(k)) / 3) / reach));
    const total = weight.reduce((s, w) => s + w, 0);
    for (let i = 0; i < SAMPLES; i++) {
      let pick = Math.random() * total;
      let j = 0;
      while (j < tris.length - 1 && (pick -= weight[j]!) > 0) j++;
      const { a, b, c } = tris[j]!;
      let u = Math.random(), v = Math.random();
      if (u + v > 1) [u, v] = [1 - u, 1 - v];
      this.surface.push(new THREE.Vector3().copy(a).addScaledVector(new THREE.Vector3().subVectors(b, a), u).addScaledVector(new THREE.Vector3().subVectors(c, a), v));
    }
  }

  private spawn(held: THREE.Object3D, plus: number, dt: number): void {
    // 0.125 at +3, 1 at +10.
    const k = THREE.MathUtils.clamp((plus - 2) / 8, 0, 1);
    this.owed += (4 + 60 * k * k) * dt;
    const palette = PALETTES.find((p) => plus >= p.from)!.colors;
    const toWorld = held.matrixWorld;
    const axis = this.axis.clone().transformDirection(toWorld);
    const scale = held.getWorldScale(new THREE.Vector3()).x || 1;
    const len = this.length * scale;
    for (; this.owed >= 1 && this.stars.length < MAX; this.owed--) {
      const local = this.surface[(Math.random() * this.surface.length) | 0]!;
      const p = local.clone().applyMatrix4(toWorld);
      const c = this.axisAt.clone().applyMatrix4(toWorld);
      c.addScaledVector(axis, p.clone().sub(c).dot(axis));
      const u = p.clone().sub(c);
      const r0 = u.length();
      if (r0 < 1e-5) u.set(1, 0, 0).cross(axis);
      if (u.lengthSq() < 1e-10) u.set(0, 0, 1).cross(axis);
      u.normalize();
      const soft = plus >= 7 && Math.random() < 0.15 ? 1 : 0;
      const color = new THREE.Color(plus >= 10 && Math.random() < 0.7 ? new THREE.Color().setHSL((this.t * 0.06 + Math.random() * 0.25) % 1, 0.85, 0.65) : palette[(Math.random() * palette.length) | 0]!);
      this.stars.push({
        c,
        axis,
        u,
        w: new THREE.Vector3().crossVectors(axis, u),
        r0,
        drift: len * (0.03 + 0.12 * k) * (0.3 + Math.random()) * (soft ? 0.5 : 1),
        rise: len * (Math.random() - 0.5) * 0.12,
        // One way round for all: the dust swirls like a galaxy's arms.
        spin: (1.2 + 2.8 * k) * (0.6 + 0.8 * Math.random()),
        age: 0,
        life: (0.7 + 0.9 * Math.random() + 0.5 * k) * (soft ? 1.6 : 1),
        size: len * (0.03 + 0.05 * k) * (0.5 + Math.random()) * (soft ? 3 : 1),
        twinkle: 6 + 10 * Math.random(),
        phase: Math.random() * Math.PI * 2,
        turn: (Math.random() - 0.5) * 3,
        soft,
        color,
      });
    }
    this.owed = Math.min(this.owed, 1);
    this.strength = (0.45 + 0.55 * k) * this.intensity;
  }

  /** Brightness of the stars spawned last (0.45-1 by refinement, times intensity). */
  private strength = 1;

  private step(dt: number): void {
    const { position, size, alpha, angle, soft, tint } = this.attrs;
    let n = 0;
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i]!;
      s.age += dt;
      if (s.age >= s.life) continue;
      this.stars[n] = s;
      const theta = s.spin * s.age;
      const r = s.r0 + s.drift * s.age;
      const x = s.c.x + s.axis.x * s.rise * s.age + (s.u.x * Math.cos(theta) + s.w.x * Math.sin(theta)) * r;
      const y = s.c.y + s.axis.y * s.rise * s.age + (s.u.y * Math.cos(theta) + s.w.y * Math.sin(theta)) * r;
      const z = s.c.z + s.axis.z * s.rise * s.age + (s.u.z * Math.cos(theta) + s.w.z * Math.sin(theta)) * r;
      position[n * 3] = x;
      position[n * 3 + 1] = y;
      position[n * 3 + 2] = z;
      const life = Math.sin((Math.PI * s.age) / s.life);
      const twinkle = s.soft ? 1 : 0.45 + 0.55 * Math.abs(Math.sin(s.age * s.twinkle + s.phase));
      size[n] = s.size * (0.6 + 0.4 * life) * (s.soft ? 1 : 0.7 + 0.3 * twinkle);
      alpha[n] = life * twinkle * this.strength * (s.soft ? 0.22 : 1);
      angle[n] = s.phase + s.turn * s.age;
      soft[n] = s.soft;
      s.color.toArray(tint, n * 3);
      n++;
    }
    this.stars.length = n;
    this.geometry.setDrawRange(0, n);
    this.points.visible = n > 0;
    if (!n) return;
    for (const name of ['position', 'size', 'alpha', 'angle', 'soft', 'tint']) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Drops every star at once (a level change). */
  clear(): void {
    this.stars.length = 0;
    this.held = null;
    this.surface = [];
    this.step(0);
  }
}
