import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { itemPreviewModelFile } from '../assets/item_models.ts';

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
    this.scene.add(new THREE.HemisphereLight(0xffeed0, 0x1f1912, 2.8));
    const key = new THREE.DirectionalLight(0xffdf88, 3.2);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7ea0c0, 1.4);
    fill.position.set(-3, -2, 2);
    this.scene.add(fill);
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
    this.camera.aspect = renderWidth / renderHeight;
    this.camera.updateProjectionMatrix();

    const pivot = new THREE.Group();
    const mesh = clone(source);
    // Align & angle appropriately:
    const isArmor = (model >= 80 && model <= 83) || model === 247;
    if (isArmor) {
      mesh.rotation.y = 0.22;
      mesh.rotation.x = -0.05;
      mesh.rotation.z = 0;
    } else if (height > width) {
      // Tall weapons (swords, staves, axes): tilt ~12 deg to showcase full blade & guard
      mesh.rotation.z = -0.15;
      mesh.rotation.y = 0.38;
      mesh.rotation.x = 0.08;
    } else if (width > height) {
      mesh.rotation.z = 0.25;
      mesh.rotation.y = 0.35;
    } else {
      // Shields / Potions / Rings (square): showcase surface
      mesh.rotation.y = 0.25;
      mesh.rotation.x = -0.08;
    }

    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    mesh.position.set(-center.x, -center.y, -center.z);
    pivot.add(mesh);
    this.scene.add(pivot);

    const fovRad = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const aspect = renderWidth / renderHeight;
    const distY = (size.y / 2) / Math.tan(fovRad);
    const distX = (size.x / 2) / (Math.tan(fovRad) * aspect);
    const distZ = size.z;
    const dist = Math.max(distY, distX) * 1.06 + distZ / 2;
    this.camera.position.set(0, 0, Math.max(0.2, dist));
    this.camera.lookAt(0, 0, 0);

    this.renderer.render(this.scene, this.camera);
    pivot.removeFromParent();

    const dataUrl = this.canvas.toDataURL('image/png');
    this.cache.set(key, dataUrl);
    this.pending.delete(key);
    for (const listener of this.listeners) listener(key, dataUrl);
  }
}
