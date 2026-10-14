import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LevelLight } from '../engine/level_light.ts';
import { dynamicLights } from '../engine/dynamic_lights.ts';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LEVEL_PREFIX, LEVEL_UNIT_METRES, buildLevelArena, type ArenaDef, type LevelObject, type LevelBrush, type LevelPlacements, type WorldObjectDef, type WorldObjectState, type DoorMotion, type DoorSwing, stepDoorMotion, swingPose } from '@crusaders/shared';

/**
 * An original level converted from the player's own installation (imported in the browser, or
 * `pnpm convert` in development), served at /generated. The collision mesh
 * and placements go through the same buildLevelArena() as the server, so client prediction and
 * the authoritative simulation share the exact geometry. Never shipped with the game.
 */
interface Manifest {
  levels?: Record<string, { render: string; collision: string }>;
  placements?: Record<string, string>;
  textures?: Record<string, string>;
  textureSizes?: Record<string, [number, number]>;
}

/**
 * The lightmap texels are stored dark; the original modulates the texture with them at a gain
 * (×2, as in common "modulate 2x" lightmapping; tuned by eye against the original).
 */
const LIGHTMAP_GAIN = 2;
const SKY_PREFIX = 'wld_sy_sky';
/** Distance to the sky box's corners, metres (the camera's far plane is ~490 m). */
const SKY_RADIUS = 300;

export interface LevelObjectView {
  def: LevelObject;
  object: THREE.Object3D;
  /** World position, metres. */
  position: THREE.Vector3;
  state: WorldObjectState;
}

/**
 * A door or lever brush: its world object and the drawn piece (swinging doors turn about their
 * hinge, other doors slide up, levers tip over).
 */
export interface DoorView {
  def: WorldObjectDef;
  mesh: THREE.Mesh;
  state: WorldObjectState;
  /** 0 closed .. 1 open. */
  open: number;
  /** Swinging doors: the swing and its motion (null = shut), stepped every frame. */
  swing?: { def: DoorSwing; motion: DoorMotion | null };
}

/** Footstep surfaces (Sound.ctx has a step pair for each). */
export type Surface = 'stone' | 'metal' | 'wood' | 'gravel' | 'grass' | 'snow' | 'squishy';

/**
 * Surface of a level texture from its material code (<set>_<code>_<n>: ST stone, ML metal, WD
 * wood, ER earth, OG organic, LQ liquid...). Earth and organic textures mix dirt, grass and snow,
 * so those go by the texture's average colour.
 */
function surfaceOf(name: string, map: THREE.Texture | null): Surface {
  const code = /^[a-z0-9]+_([a-z]{2})_/.exec(name.toLowerCase())?.[1];
  if (code === 'ml') return 'metal';
  if (code === 'wd') return 'wood';
  if (code === 'lq') return 'squishy';
  if (code !== 'er' && code !== 'og') return 'stone';
  const img = map?.image as CanvasImageSource | undefined;
  if (!img) return 'gravel';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gr = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      gr += d[i + 1]!;
      b += d[i + 2]!;
    }
    if (r > 170 * 64 && gr > 170 * 64 && b > 170 * 64) return 'snow';
    if (gr > r * 1.08 && gr > b) return 'grass';
  } catch {
    /* image not ready */
  }
  return 'gravel';
}

export interface OriginalLevel {
  arena: ArenaDef;
  /** Level geometry in metres. */
  object: THREE.Object3D;
  /** Placed objects (props, items, chests) by placement index, the world-object id. */
  objects: Map<number, LevelObjectView>;
  /** Doors by world-object id. */
  doors: Map<number, DoorView>;
  /** Torch flame positions (metres), e.g. for ambient fire sounds. */
  torches: THREE.Vector3[];
  /** The baked light of the level's floors (characters and props take it), if it has a lightmap. */
  light: LevelLight | null;
  /** `swing`: a swinging door's motion as of now (from the server). */
  setObjectState(id: number, state: WorldObjectState, swing?: DoorMotion | null): void;
  /** Surface under a point (metres), for footsteps; null off the level. */
  surfaceAt(pos: THREE.Vector3): Surface | null;
  /** Music track of the level act (Music/<n>.mp3), if any. */
  music?: number;
  /** Dungeon atmosphere: dim ambient light, dark fog. */
  applyAtmosphere(scene: THREE.Scene): void;
  /** Call every frame: sky box, torch flicker and the torch light pool. */
  update(camera: THREE.Camera, dt: number): void;
}

const TORCH_LIGHTS = 8;
/** Seconds a door takes to slide open. */
const DOOR_OPEN_SECONDS = 0.9;
/** Brush colours (their face textures are not decoded): wood, metal, stone. */
const BRUSH_COLOURS: [RegExp, number][] = [[/metal|cell|gate|gear|wheel|crusher/i, 0x4c4c52], [/door|sign|plat|bridge|tort/i, 0x5a3c22]];
const BRUSH_STONE = 0x5d554a;

/**
 * Brush texture units per picture: brush faces span 15 units across a door picture (an 8 ft and
 * a 14 ft door alike), and the original shows the whole picture once on them.
 */
const BRUSH_UNITS_PER_PICTURE = 15;
/** Brushes have no lightmap: their textures are dimmed to sit in the lightmapped level. */
const BRUSH_SHADE = 0.6;

/**
 * Textured brush from its original faces (one polygon each, texel coordinates), positions in
 * metres; null when it has no faces or a texture is missing.
 */
function texturedBrushMesh(brush: LevelBrush, texture: (name: string) => { map: THREE.Texture; size: [number, number] } | null): THREE.Mesh | null {
  const faces = brush.faces ?? [];
  if (!faces.length) return null;
  const s = LEVEL_UNIT_METRES;
  const byTex = new Map<string, { pos: number[]; uv: number[] }>();
  for (const f of faces) {
    const tex = texture(f.texture);
    if (!tex) return null;
    let g = byTex.get(f.texture);
    if (!g) byTex.set(f.texture, (g = { pos: [], uv: [] }));
    const vert = (i: number) => {
      const p = brush.points[f.indices[i]!]!;
      g.pos.push(p[0] * s, p[1] * s, p[2] * s);
      // Brush V runs upwards (the level faces' downwards): flipped, the picture stands upright.
      g.uv.push(f.texels[2 * i]! / BRUSH_UNITS_PER_PICTURE, 1 - f.texels[2 * i + 1]! / BRUSH_UNITS_PER_PICTURE);
    };
    for (let i = 1; i + 1 < f.indices.length; i++) {
      vert(0);
      vert(i);
      vert(i + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [];
  const uv: number[] = [];
  const materials: THREE.Material[] = [];
  for (const [name, g] of byTex) {
    geo.addGroup(pos.length / 3, g.pos.length / 3, materials.length);
    pos.push(...g.pos);
    uv.push(...g.uv);
    // Both sides: the mirrored Z flips the winding of some faces.
    materials.push(new THREE.MeshBasicMaterial({ map: texture(name)!.map, color: new THREE.Color(BRUSH_SHADE, BRUSH_SHADE, BRUSH_SHADE), side: THREE.DoubleSide }));
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // For the enhanced lighting (unlit otherwise).
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, materials);
}

/** Convex piece with flat faces shaded by a fixed light (fallback without faces or textures). */
function brushMesh(points: Float32Array, name: string): THREE.Mesh | null {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i + 2 < points.length; i += 3) pts.push(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
  let geo: THREE.BufferGeometry;
  try {
    geo = new ConvexGeometry(pts);
  } catch {
    return null;
  }
  const base = new THREE.Color(BRUSH_COLOURS.find(([re]) => re.test(name))?.[1] ?? BRUSH_STONE);
  const light = new THREE.Vector3(0.4, 1, 0.3).normalize();
  const n = geo.getAttribute('normal');
  const colours = new Float32Array(n.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n.count; i++) {
    // Dim like the lightmapped level around it.
    const k = 0.25 + 0.25 * Math.max(0, n.getX(i) * light.x + n.getY(i) * light.y + n.getZ(i) * light.z);
    c.copy(base).multiplyScalar(k);
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

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

/**
 * Each sky piece is one tile of a face (sky1up_a..i) showing its texture once; Ws_a's texture
 * axes repeat it 3.75 times, so the UVs are stretched to 0..1 per piece.
 */
function fitSkyTile(geo: THREE.BufferGeometry): void {
  const uv = geo.getAttribute('uv');
  if (!uv) return;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    u0 = Math.min(u0, uv.getX(i));
    u1 = Math.max(u1, uv.getX(i));
    v0 = Math.min(v0, uv.getY(i));
    v1 = Math.max(v1, uv.getY(i));
  }
  if (u1 - u0 < 1e-6 || v1 - v0 < 1e-6) return;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - u0) / (u1 - u0), (uv.getY(i) - v0) / (v1 - v0));
  uv.needsUpdate = true;
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
    // Each polygon has its own small tile: mipmaps would blend neighbouring tiles into its light.
    lightMap.generateMipmaps = false;
    lightMap.minFilter = THREE.LinearFilter;
    lightMap.needsUpdate = true;
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
    if (!isSky) dynamicLights.enhance(material);
    old.dispose();
    mesh.material = material;
    mesh.removeFromParent();
    if (isSky) {
      material.depthWrite = false;
      // Seen from inside; Ws_a's faces point the other way.
      material.side = THREE.DoubleSide;
      fitSkyTile(mesh.geometry);
      // Drawn far around the camera: the level's fog would black it out.
      material.fog = false;
      mesh.renderOrder = -1;
      sky.add(mesh);
    } else {
      level.add(mesh);
    }
  }
  level.scale.setScalar(LEVEL_UNIT_METRES);
  level.updateMatrixWorld(true);
  const light = lightMap ? LevelLight.build(level.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh), lightMap, LIGHTMAP_GAIN) : null;

  // The sky box is a small cube modelled away from the map; draw it around the camera.
  // Scaled to a fixed size (its corners SKY_RADIUS away), inside the camera's far plane.
  const skyBox = new THREE.Box3().setFromObject(sky);
  const skyCentre = skyBox.getCenter(new THREE.Vector3());
  sky.children.forEach((m) => m.position.sub(skyCentre));
  const skyHalfDiagonal = skyBox.getSize(new THREE.Vector3()).length() / 2;
  sky.scale.setScalar(skyHalfDiagonal > 0 ? SKY_RADIUS / skyHalfDiagonal : 1);
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

  // Brushes: doors, gates, bridges, wheels... (convex pieces; doors slide up when opened).
  const doors = new Map<number, DoorView>();
  const doorDefs = new Map((arena.objects ?? []).filter((o) => o.kind === 'door' || o.kind === 'lever').map((o) => [o.id, o]));
  const brushTextures = new Map<string, { map: THREE.Texture; size: [number, number] } | null>();
  const brushTexture = (name: string) => {
    if (!brushTextures.has(name)) {
      const file = manifest.textures?.[name];
      const size = manifest.textureSizes?.[name];
      let entry: { map: THREE.Texture; size: [number, number] } | null = null;
      if (file && size) {
        const map = new THREE.TextureLoader().load(`/generated/${file}`);
        map.flipY = false; // as the level's glTF textures
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        entry = { map, size };
      }
      brushTextures.set(name, entry);
    }
    return brushTextures.get(name) ?? null;
  };
  (arena.brushes ?? []).forEach((b, i) => {
    const source = placements.brushes?.[i];
    const mesh = (source && texturedBrushMesh(source, brushTexture)) || brushMesh(b.points, b.name);
    if (!mesh) return;
    for (const m of [mesh.material].flat()) dynamicLights.enhance(m);
    mesh.name = b.name;
    root.add(mesh);
    const def = b.door !== undefined ? doorDefs.get(b.door) : undefined;
    if (def?.kind === 'lever') {
      // Pivot at its centre so it can tip over when pulled.
      const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      mesh.geometry.translate(-c.x, -c.y, -c.z);
      mesh.position.copy(c);
    }
    if (def && b.swing) {
      // Pivot at the hinge so it can turn.
      const k = b.swing.keys[0]!;
      mesh.geometry.translate(-k.cx, 0, -k.cz);
      mesh.position.set(k.cx, 0, k.cz);
      doors.set(def.id, { def, mesh, state: 'present', open: 0, swing: { def: b.swing, motion: null } });
    } else if (def) doors.set(def.id, { def, mesh, state: 'present', open: 0 });
  });

  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < TORCH_LIGHTS; i++) {
    const l = new THREE.PointLight(0xff9a40, 0, 9, 1.6);
    root.add(l);
    lights.push(l);
  }
  let reassign = 0;
  let t = 0;
  const surfaces = new Map<THREE.Material, Surface>();
  let matricesReady = false;
  let lastAt: THREE.Vector3 | null = null;
  let lastSurface: Surface | null = null;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const from = new THREE.Vector3();
  return {
    surfaceAt(pos) {
      if (!matricesReady) {
        level.updateWorldMatrix(true, true); // static geometry: once, also before the first frame
        matricesReady = true;
      }
      // A raycast costs a few ms on a whole level: reuse the last answer close by.
      if (lastAt && Math.hypot(pos.x - lastAt.x, pos.z - lastAt.z) < 0.75 && Math.abs(pos.y - lastAt.y) < 0.5) return lastSurface;
      lastAt = pos.clone();
      lastSurface = null;
      ray.set(from.set(pos.x, pos.y + 0.5, pos.z), down);
      ray.far = 1.5;
      const hit = ray.intersectObject(level, true)[0];
      const material = hit && ((hit.object as THREE.Mesh).material as THREE.MeshBasicMaterial);
      if (!material) return null;
      let s = surfaces.get(material);
      if (!s) surfaces.set(material, (s = surfaceOf(material.name, material.map)));
      lastSurface = s;
      return s;
    },
    arena,
    light,
    ...(placements.music ? { music: placements.music } : {}),
    object: root,
    objects,
    doors,
    torches,
    setObjectState(id, state, swing) {
      const door = doors.get(id);
      if (door) door.state = state;
      if (door?.swing && swing !== undefined) door.swing.motion = state === 'open' && swing ? { ...swing } : null;
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
      for (const d of doors.values()) {
        if (d.swing) {
          const m = d.swing.motion;
          if (m && !stepDoorMotion(d.swing.def, m, dt * 1000)) d.swing.motion = null;
          d.mesh.rotation.y = d.swing.motion ? swingPose(d.swing.def, d.swing.motion).angle : 0;
          continue;
        }
        const target = d.state === 'open' ? 1 : 0;
        if (d.open === target) continue;
        d.open = target > d.open ? Math.min(1, d.open + dt / DOOR_OPEN_SECONDS) : 0;
        const b = d.def.bounds!;
        if (d.def.kind === 'lever') d.mesh.rotation.z = (-Math.PI / 3) * d.open;
        else d.mesh.position.y = (b[4] - b[1]) * 0.95 * d.open;
      }
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
