import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { itemPreviewModelFile } from '../assets/item_models.ts';

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

/**
 * Angles an item's mesh for display by its footprint and centres it in `pivot`; returns its
 * posed size. Tall weapons tilt to show blade and guard, square items show their face.
 */
export function poseItem(pivot: THREE.Group, mesh: THREE.Object3D, model: number, width: number, height: number): THREE.Vector3 {
  const isArmor = (model >= 80 && model <= 83) || model === 247;
  if (isArmor) {
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
  private readonly models = new Map<number, Promise<THREE.Object3D | null>>();
  private manifest: Promise<Record<string, string>> | null = null;
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

  getThumbnail(model: number | undefined, width = 1, height = 1): string | null {
    if (model === undefined) return null;
    const key = `${model}_${width}x${height}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (!this.pending.has(key)) {
      this.pending.add(key);
      void this.renderThumbnail(model, width, height, key);
    }
    return null;
  }

  async loadModel(model: number): Promise<THREE.Object3D | null> {
    let entry = this.models.get(model);
    if (!entry) {
      entry = (async () => {
        const fileKey = itemPreviewModelFile(model);
        if (!fileKey) return null;
        this.manifest ??= fetch('/generated/manifest.json')
          .then(async (r): Promise<{ models?: Record<string, string> }> => (r.ok ? ((await r.json()) as { models?: Record<string, string> }) : {}))
          .then((m) => m.models ?? {})
          .catch(() => ({}));
        const url = (await this.manifest)[fileKey];
        if (!url) return null;
        const gltf = await this.loader.loadAsync(`/generated/${url}`).catch(() => null);
        return gltf?.scene ?? null;
      })();
      this.models.set(model, entry);
    }
    return entry;
  }

  private async renderThumbnail(model: number, width: number, height: number, key: string): Promise<void> {
    const source = await this.loadModel(model);
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
