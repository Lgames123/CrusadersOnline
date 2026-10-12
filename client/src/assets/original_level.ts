import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LEVEL_PREFIX, LEVEL_UNIT_METRES, buildLevelArena, type ArenaDef, type LevelObject, type LevelPlacements, type WorldObjectState } from '@crusaders/shared';

/**
 * An original level converted from the player's own installation (imported in the browser, or
 * `pnpm convert` in development), served at /generated. The collision mesh
 * and placements go through the same buildLevelArena() as the server, so client prediction and
 * the authoritative simulation share the exact geometry. Never shipped with the game.
 */
interface Manifest {
  levels?: Record<string, { render: string; collision: string }>;
  placements?: Record<string, string>;
}

/**
 * The lightmap texels are stored dark; the original modulates the texture with them at a gain
 * (×2, as in common "modulate 2x" lightmapping; tuned by eye against the original).
 */
const LIGHTMAP_GAIN = 2;
const SKY_PREFIX = 'wld_sy_sky';

export interface LevelObjectView {
  def: LevelObject;
  object: THREE.Object3D;
  /** World position, metres. */
  position: THREE.Vector3;
  state: WorldObjectState;
}

export interface OriginalLevel {
  arena: ArenaDef;
  /** Level geometry in metres. */
  object: THREE.Object3D;
  /** Placed objects (props, items, chests) by placement index, the world-object id. */
  objects: Map<number, LevelObjectView>;
  /** Torch flame positions (metres), e.g. for ambient fire sounds. */
  torches: THREE.Vector3[];
  setObjectState(id: number, state: WorldObjectState): void;
  /** Music track of the level act (Music/<n>.mp3), if any. */
  music?: number;
  /** Dungeon atmosphere: dim ambient light, dark fog. */
  applyAtmosphere(scene: THREE.Scene): void;
  /** Call every frame: sky box, torch flicker and the torch light pool. */
  update(camera: THREE.Camera, dt: number): void;
}

const TORCH_LIGHTS = 8;

function flameTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 36, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,150,40,0.85)');
  grad.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Column-vector matrix from the stored row-major rotation (Direct3D row-vector convention: transpose). */
function placementMatrix(o: LevelObject): THREE.Matrix4 {
  const r = o.rotation;
  const [x, y, z] = o.position;
  return new THREE.Matrix4().set(r[0]!, r[3]!, r[6]!, x, r[1]!, r[4]!, r[7]!, y, r[2]!, r[5]!, r[8]!, z, 0, 0, 0, 1);
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

export async function loadOriginalLevel(arenaName: string): Promise<OriginalLevel> {
  if (!arenaName.startsWith(LEVEL_PREFIX)) throw new Error(`not a level arena: ${arenaName}`);
  const act = arenaName.slice(LEVEL_PREFIX.length);
  const manifest = (await (await fetchOk('/generated/manifest.json')).json()) as Manifest;
  const placementsFile = manifest.placements?.[act];
  if (!placementsFile) throw new Error(`level act "${act}" not converted (run pnpm convert)`);
  const placements = (await (await fetchOk(`/generated/${placementsFile}`)).json()) as LevelPlacements;
  const files = manifest.levels?.[placements.mesh];
  if (!files) throw new Error(`level mesh "${placements.mesh}" not converted`);
  const collision = new Uint8Array(await (await fetchOk(`/generated/${files.collision}`)).arrayBuffer());
  const arena = buildLevelArena(arenaName, collision, placements);

  const gltf = await new GLTFLoader().loadAsync(`/generated/${files.render}`);
  const lmName = (gltf.scenes[0]?.userData as { lightmap?: string } | undefined)?.lightmap;
  const lightMap = lmName ? await new THREE.TextureLoader().loadAsync(`/generated/${files.render.replace(/[^/]+$/, '')}${lmName}`) : null;
  if (lightMap) {
    lightMap.channel = 1;
    lightMap.flipY = false;
    lightMap.colorSpace = THREE.SRGBColorSpace;
  }

  const level = new THREE.Group();
  level.name = arenaName;
  const sky = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const old = mesh.material as THREE.MeshStandardMaterial;
    const isSky = old.name.toLowerCase().startsWith(SKY_PREFIX);
    // Unlit like the original: texture x baked lightmap (the sky is unlit and unshadowed).
    const material = new THREE.MeshBasicMaterial({ map: old.map, name: old.name });
    if (lightMap && !isSky) {
      material.lightMap = lightMap;
      material.lightMapIntensity = LIGHTMAP_GAIN;
    }
    old.dispose();
    mesh.material = material;
    mesh.removeFromParent();
    if (isSky) {
      material.depthWrite = false;
      material.side = THREE.BackSide;
      mesh.renderOrder = -1;
      sky.add(mesh);
    } else {
      level.add(mesh);
    }
  }
  level.scale.setScalar(LEVEL_UNIT_METRES);

  // The sky box is a small cube modelled away from the map; draw it around the camera.
  const skyCentre = new THREE.Box3().setFromObject(sky).getCenter(new THREE.Vector3());
  sky.children.forEach((m) => m.position.sub(skyCentre));
  sky.scale.setScalar(LEVEL_UNIT_METRES * 20);
  const root = new THREE.Group();
  root.add(level);
  if (sky.children.length) root.add(sky);

  // Placed objects with their original models (props, ground items, chests) and torch flames.
  const props = new THREE.Group();
  props.scale.setScalar(LEVEL_UNIT_METRES);
  root.add(props);
  const loader = new GLTFLoader();
  const models = new Map<string, Promise<THREE.Object3D | null>>();
  const loadModel = (url: string) => {
    let p = models.get(url);
    if (!p) models.set(url, (p = loader.loadAsync(`/generated/${url}`).then((g) => g.scene as THREE.Object3D, () => null)));
    return p;
  };
  const objects = new Map<number, LevelObjectView>();
  const torches: THREE.Vector3[] = [];
  const flames: THREE.Sprite[] = [];
  const flameMat = new THREE.SpriteMaterial({ map: flameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  await Promise.all((placements.objects ?? []).map(async (o, id) => {
    if (o.kind === 'sprite') {
      if (o.effect !== 'TORCHFIRE') return;
      const flame = new THREE.Sprite(flameMat);
      flame.position.set(...o.position);
      flame.scale.setScalar(1.6); // original units (feet)
      props.add(flame);
      flames.push(flame);
      torches.push(new THREE.Vector3(...o.position).multiplyScalar(LEVEL_UNIT_METRES));
      return;
    }
    if (!o.model) return;
    const src = await loadModel(o.model);
    if (!src) return;
    const obj = cloneSkinned(src);
    obj.matrixAutoUpdate = false;
    obj.matrix.copy(placementMatrix(o));
    obj.traverse((m) => {
      m.castShadow = false;
      m.receiveShadow = false;
    });
    props.add(obj);
    objects.set(id, { def: o, object: obj, position: new THREE.Vector3(...o.position).multiplyScalar(LEVEL_UNIT_METRES), state: 'present' });
  }));

  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < TORCH_LIGHTS; i++) {
    const l = new THREE.PointLight(0xff9a40, 0, 9, 1.6);
    root.add(l);
    lights.push(l);
  }
  let reassign = 0;
  let t = 0;
  return {
    arena,
    ...(placements.music ? { music: placements.music } : {}),
    object: root,
    objects,
    torches,
    setObjectState(id, state) {
      const v = objects.get(id);
      if (!v) return;
      v.state = state;
      v.object.visible = state !== 'gone';
    },
    applyAtmosphere(scene) {
      scene.background = new THREE.Color(0x000000);
      scene.fog = new THREE.Fog(0x050403, 30, 160);
      scene.traverse((o) => {
        const light = o as THREE.Light;
        if ((light as THREE.HemisphereLight).isHemisphereLight) light.intensity = 0.7;
        if ((light as THREE.DirectionalLight).isDirectionalLight) light.intensity = 0.15;
      });
    },
    update(camera, dt) {
      if (sky.children.length) sky.position.copy(camera.position);
      t += dt;
      flames.forEach((f, i) => f.scale.setScalar(1.4 + 0.25 * Math.sin(t * 13 + i * 1.7) + 0.15 * Math.sin(t * 29 + i)));
      if ((reassign -= dt) <= 0) {
        reassign = 0.5;
        const near = torches
          .map((p, i) => ({ i, d: p.distanceToSquared(camera.position) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, TORCH_LIGHTS);
        lights.forEach((l, k) => {
          const n = near[k];
          l.intensity = n ? 6 : 0;
          if (n) l.position.copy(torches[n.i]!);
        });
      }
      lights.forEach((l, k) => {
        if (l.intensity > 0) l.intensity = 5 + 1.2 * Math.sin(t * 11 + k * 2.3);
      });
    },
  };
}

/** Asks the game server which arena the zone runs (GET /healthz). */
export async function fetchServerArena(): Promise<string | null> {
  try {
    const res = await fetch('/healthz');
    if (!res.ok) return null;
    return ((await res.json()) as { arena?: string }).arena ?? null;
  } catch {
    return null;
  }
}
