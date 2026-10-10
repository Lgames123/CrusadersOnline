/**
 * Dev-only viewer for models converted from the user's own installation (local/generated).
 * Open http://localhost:3000/viewer.html after running `pnpm convert`.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

interface Manifest {
  models: Record<string, string>;
  levels?: Record<string, { render: string; collision: string }>;
}

/** Lightmap texels are stored dark; the original modulates with this gain (tuned by eye). */
const LIGHTMAP_GAIN = 2;
interface SphereExtra {
  node: number;
  center: [number, number, number];
  radius: number;
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2d35);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444033, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 10, 7);
scene.add(sun);
scene.add(new THREE.GridHelper(20, 20, 0x888888, 0x444444));
scene.add(new THREE.AxesHelper(1.5)); // red +X, green +Y, blue +Z

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 500);
camera.position.set(4, 4, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);

const select = document.getElementById('model') as HTMLSelectElement;
const info = document.getElementById('info')!;
const toggles = {
  skeleton: document.getElementById('skeleton') as HTMLInputElement,
  spheres: document.getElementById('spheres') as HTMLInputElement,
  wire: document.getElementById('wire') as HTMLInputElement,
};

const loader = new GLTFLoader();
let current: THREE.Object3D | null = null;
let helpers: THREE.Object3D[] = [];
let mixer: THREE.AnimationMixer | null = null;
let clips: THREE.AnimationClip[] = [];
const animSelect = document.getElementById('anim') as HTMLSelectElement;
const clock = new THREE.Clock();

function playClip(name: string): void {
  if (!mixer || !current) return;
  mixer.stopAllAction();
  const clip = clips.find((c) => c.name === name);
  if (!clip) {
    current.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.pose());
    return;
  }
  mixer.clipAction(clip).reset().play();
}

function clear(): void {
  for (const h of helpers) h.removeFromParent();
  helpers = [];
  if (current) scene.remove(current);
  current = null;
}

function applyToggles(): void {
  for (const h of helpers) {
    if (h.userData['kind'] === 'skeleton') h.visible = toggles.skeleton.checked;
    if (h.userData['kind'] === 'spheres') h.visible = toggles.spheres.checked;
  }
  current?.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && 'wireframe' in m) m.wireframe = toggles.wire.checked;
  });
}

/** Levels: unlit materials modulated by the lightmap atlas on UV set 1. */
async function setupLevel(root: THREE.Object3D, lightmapUrl: string): Promise<void> {
  const lightMap = await new THREE.TextureLoader().loadAsync(lightmapUrl);
  lightMap.channel = 1;
  lightMap.colorSpace = THREE.SRGBColorSpace;
  lightMap.flipY = false;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const old = mesh.material as THREE.MeshStandardMaterial;
    mesh.material = new THREE.MeshLambertMaterial({ map: old.map, lightMap, lightMapIntensity: LIGHTMAP_GAIN * Math.PI, name: old.name });
    old.dispose();
  });
}

async function show(name: string, url: string): Promise<void> {
  clear();
  const gltf = await loader.loadAsync(`/generated/${url}`);
  current = gltf.scene;
  const isLevel = url.startsWith('levels/');
  if (isLevel) {
    const lm = (gltf.scenes[0]?.userData as { lightmap?: string })['lightmap'];
    if (lm) await setupLevel(current, `/generated/${url.replace(/[^/]+$/, '')}${lm}`);
  }
  camera.near = isLevel ? 0.5 : 0.01;
  camera.far = isLevel ? 20000 : 500;
  camera.updateProjectionMatrix();
  scene.add(current);
  mixer = new THREE.AnimationMixer(current);
  clips = gltf.animations;
  animSelect.length = 1;
  for (const c of [...clips].sort((a, b) => a.name.localeCompare(b.name))) {
    const label = (c.userData as { label?: string } | undefined)?.label ?? '';
    animSelect.add(new Option(label ? `${c.name} — ${label}` : c.name, c.name));
  }

  const skel = new THREE.SkeletonHelper(current);
  skel.userData['kind'] = 'skeleton';
  helpers.push(skel);
  scene.add(skel);

  // Collision spheres are stored in node-local space on the root extras.
  const root = current.children[0];
  const spheres = (root?.userData['spheres'] ?? []) as SphereExtra[];
  const group = new THREE.Group();
  group.userData['kind'] = 'spheres';
  const bones: THREE.Bone[] = [];
  current.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) bones.push(...(o as THREE.SkinnedMesh).skeleton.bones);
  });
  current.updateMatrixWorld(true);
  for (const s of spheres) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(s.radius, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff5050, wireframe: true, transparent: true, opacity: 0.6 }),
    );
    mesh.position.set(...s.center);
    mesh.userData['kind'] = 'spheres';
    helpers.push(mesh);
    const bone = bones[s.node];
    if (bone) bone.add(mesh);
    else group.add(mesh);
  }
  helpers.push(group);
  scene.add(group);

  const box = new THREE.Box3().setFromObject(current);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0.6, 0.4, 1).multiplyScalar(Math.max(size.x, size.y, size.z) * 1.6 + 0.5));
  let tris = 0;
  current.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g) tris += (g.index?.count ?? g.attributes['position']!.count) / 3;
  });
  info.textContent =
    `${name}\n` +
    `size ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} (original units)\n` +
    `triangles ${tris}  bones ${bones.length}  collision spheres ${spheres.length}  animations ${clips.length}`;
  applyToggles();
  history.replaceState(null, '', `#${name}`);
}

async function main(): Promise<void> {
  const res = await fetch('/generated/manifest.json');
  if (!res.ok) {
    info.textContent = 'No converted assets found. Run `pnpm convert` first (needs your own game installation).';
    return;
  }
  const manifest = (await res.json()) as Manifest;
  const levels = Object.fromEntries(Object.entries(manifest.levels ?? {}).map(([k, v]) => [`level:${k}`, v.render]));
  const all: Record<string, string> = { ...levels, ...manifest.models };
  manifest.models = all;
  const names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  for (const n of names) select.add(new Option(n, n));
  const initial = decodeURIComponent(location.hash.slice(1)) || (names.includes('drake') ? 'drake' : names[0]!);
  select.value = initial;
  select.addEventListener('change', () => void show(select.value, manifest.models[select.value]!));
  for (const t of Object.values(toggles)) t.addEventListener('change', applyToggles);
  animSelect.addEventListener('change', () => playClip(animSelect.value));
  await show(initial, manifest.models[initial]!);
  (window as unknown as { __viewer: unknown }).__viewer = {
    show: (n: string) => show(n, manifest.models[n]!),
    play: (n: string) => playClip(n),
    clips: () => clips.map((c) => ({ name: c.name, duration: c.duration, extras: c.userData })),
    seek: (t: number) => mixer?.setTime(t),
    scene, camera, renderer, controls,
  };
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
renderer.setAnimationLoop(() => {
  mixer?.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});
void main();
