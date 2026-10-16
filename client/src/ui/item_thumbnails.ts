import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { itemPreviewModelFile, itemPreviewTexture } from '../assets/item_models.ts';

/** Lights shared by the slot thumbnails and the held-item preview, so both read the same. */
export function addItemLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xffeed0, 0x1f1912, 2.8));
  const key = new THREE.DirectionalLight(0xffdf88, 3.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7ea0c0, 1.4);
  fill.position.set(-3, -2, 2);
  scene.add(fill);
}

/** Shield models (items.ctx Model): wooden, metal (and its ice / reflecting / vampiric skins), family. */
const SHIELD_MODELS: ReadonlySet<number> = new Set([28, 86, 131]);

/**
 * Some item textures carry an alpha channel that is 0 everywhere (stone1, the Stone Key's: a
 * 32-bit TGA whose alpha was never painted). The converted material's alpha test then discards
 * the whole mesh; such a texture is drawn opaque instead.
 */
function opaqueIfNoAlpha(material: THREE.Material): void {
  const map = (material as THREE.MeshStandardMaterial).map;
  const image = map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!map || !image?.width || material.alphaTest <= 0) return;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(image, 0, 0, 16, 16);
  const data = ctx.getImageData(0, 0, 16, 16).data;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) return;
  material.alphaTest = 0;
  material.transparent = false;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a = 1.0;');
  };
  material.customProgramCacheKey = () => 'item-opaque';
  material.needsUpdate = true;
}

/**
 * Angles an item's mesh for display by its footprint and centres it in `pivot`; returns its
 * posed size. Tall weapons tilt to show blade and guard, square items show their face.
 */
export function poseItem(pivot: THREE.Group, mesh: THREE.Object3D, model: number, width: number, height: number): THREE.Vector3 {
  const isArmor = (model >= 80 && model <= 83) || model === 247;
  if (SHIELD_MODELS.has(model)) {
    // Shield meshes face the forearm they are strapped to: turned round, their face shows.
    mesh.rotation.set(-0.08, Math.PI + 0.25, 0);
  } else if (isArmor) {
    mesh.rotation.set(-0.05, 0.22, 0);
  } else if (height > width) {
    mesh.rotation.set(0.08, 0.38, -0.15);
  } else if (width > height) {
    mesh.rotation.set(0, 0.35, 0.25);
  } else {
    mesh.rotation.set(-0.08, 0.25, 0);
  }
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  mesh.position.set(-center.x, -center.y, -center.z);
  pivot.add(mesh);
  return box.getSize(new THREE.Vector3());
}

/** Puts the camera on +Z so a posed item of `size` fills a viewport of `aspect` (`margin` > 1 leaves room). */
export function fitItemCamera(camera: THREE.PerspectiveCamera, size: THREE.Vector3, aspect: number, margin: number): void {
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(size.y / 2 / tan, size.x / 2 / (tan * aspect)) * margin + size.z / 2;
  camera.position.set(0, 0, Math.max(0.2, dist));
  camera.lookAt(0, 0, 0);
}

/**
 * Renders static, crisp 3D thumbnails of items sized to fit their grid bounding boxes (width × height).
 * Reuses one offscreen WebGL renderer and caches data URLs to avoid multiple WebGL contexts.
 */
export class ItemThumbnails {
  private static instance: ItemThumbnails | null = null;
  static get(): ItemThumbnails {
    return (this.instance ??= new ItemThumbnails());
  }

  private readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  private readonly loader = new GLTFLoader();
  private readonly models = new Map<string, Promise<THREE.Object3D | null>>();
  private readonly textures = new THREE.TextureLoader();
  private manifest: Promise<{ models: Record<string, string>; textures: Record<string, string> }> | null = null;
  private readonly cache = new Map<string, string>();
  private readonly pending = new Set<string>();
  private readonly listeners = new Set<(key: string, url: string) => void>();

  constructor() {
    this.canvas.width = 128;
    this.canvas.height = 128;
    addItemLights(this.scene);
  }

  onChange(cb: (key: string, url: string) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Cache key of an item's thumbnail; `img[data-thumb-key]` uses the same. */
  static key(model: number, width: number, height: number, texture?: number): string {
    return `${model}_${texture ?? 0}_${width}x${height}`;
  }

  getThumbnail(model: number | undefined, width = 1, height = 1, texture?: number): string | null {
    if (model === undefined) return null;
    const key = ItemThumbnails.key(model, width, height, texture);
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (!this.pending.has(key)) {
      this.pending.add(key);
      void this.renderThumbnail(model, width, height, key, texture);
    }
    return null;
  }

  /**
   * The item's model (shared: clone before adding it to a scene), drawn with its items.ctx
   * texture variant when the model has several (potion colours, book covers...).
   */
  loadModel(model: number, texture?: number): Promise<THREE.Object3D | null> {
    const variant = itemPreviewTexture(model, texture);
    const id = `${model}:${variant ?? ''}`;
    let entry = this.models.get(id);
    if (!entry) {
      entry = (async () => {
        const fileKey = itemPreviewModelFile(model);
        if (!fileKey) return null;
        this.manifest ??= fetch('/generated/manifest.json')
          .then(async (r) => (r.ok ? ((await r.json()) as { models?: Record<string, string>; textures?: Record<string, string> }) : {}))
          .then((m) => ({ models: m.models ?? {}, textures: m.textures ?? {} }))
          .catch(() => ({ models: {}, textures: {} }));
        const manifest = await this.manifest;
        const url = manifest.models[fileKey];
        if (!url) return null;
        const gltf = await this.loader.loadAsync(`/generated/${url}`).catch(() => null);
        if (!gltf) return null;
        const scene = gltf.scene;
        const textureUrl = variant && manifest.textures[variant];
        const map = textureUrl ? await this.textures.loadAsync(`/generated/${textureUrl}`).catch(() => null) : null;
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const swap = (m: THREE.Material) => {
            if (!map) {
              opaqueIfNoAlpha(m);
              return m;
            }
            const std = m.clone() as THREE.MeshStandardMaterial;
            const own = std.map;
            // Same sampling as the converted model's own texture (glTF: not flipped, sRGB).
            map.flipY = own?.flipY ?? false;
            map.wrapS = own?.wrapS ?? THREE.RepeatWrapping;
            map.wrapT = own?.wrapT ?? THREE.RepeatWrapping;
            map.colorSpace = own?.colorSpace ?? THREE.SRGBColorSpace;
            std.map = map;
            std.needsUpdate = true;
            opaqueIfNoAlpha(std);
            return std;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
        });
        return scene;
      })();
      this.models.set(id, entry);
    }
    return entry;
  }

  private async renderThumbnail(model: number, width: number, height: number, key: string, texture?: number): Promise<void> {
    const source = await this.loadModel(model, texture);
    if (!source) {
      this.pending.delete(key);
      return;
    }
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
        this.renderer.setPixelRatio(1);
      } catch {
        this.pending.delete(key);
        return;
      }
    }
    const renderWidth = Math.max(64, width * 54);
    const renderHeight = Math.max(64, height * 54);
    this.renderer.setSize(renderWidth, renderHeight, false);

    const pivot = new THREE.Group();
    const size = poseItem(pivot, clone(source), model, width, height);
    this.scene.add(pivot);
    fitItemCamera(this.camera, size, renderWidth / renderHeight, 1.06);

    this.renderer.render(this.scene, this.camera);
    pivot.removeFromParent();

    const dataUrl = this.canvas.toDataURL('image/png');
    this.cache.set(key, dataUrl);
    this.pending.delete(key);
    for (const listener of this.listeners) listener(key, dataUrl);
  }
}
