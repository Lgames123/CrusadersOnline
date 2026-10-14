import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ItemThumbnails } from './item_thumbnails.ts';

/**
 * Reusable transparent WebGL viewport for the 3D model held during a drag.
 * Renders ONLY the rotating 3D item directly, enlarged, without background or glyph overlays.
 * Rotates strictly on its own center axis without orbiting.
 */
export class HeldItemPreview {
  private readonly element = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  private held: THREE.Group | null = null;
  private animation = 0;
  private last = 0;

  constructor() {
    this.element.className = 'inv-drag-preview';
    this.canvas.width = this.canvas.height = 160;
    this.element.append(this.canvas);
    this.scene.add(new THREE.HemisphereLight(0xffeed0, 0x1f1912, 2.8));
    const key = new THREE.DirectionalLight(0xffdf88, 3.4);
    key.position.set(2, 4, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7ea0c0, 1.4);
    fill.position.set(-2, -3, 3);
    this.scene.add(fill);
    this.camera.position.set(0, 0, 3);
  }

  show(parent: HTMLElement, model: number | undefined): void {
    if (model === undefined) return;
    parent.append(this.element);
    if (!this.renderer) {
      try {
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        this.renderer.setSize(160, 160, false);
      } catch {
        return;
      }
    }
    void this.setModel(model);
    this.last = performance.now();
    this.animation ||= requestAnimationFrame((now) => this.frame(now));
  }

  move(x: number, y: number): void {
    // Center the 160px rotating 3D preview on the cursor
    this.element.style.transform = `translate(${x - 80}px, ${y - 80}px)`;
  }

  hide(): void {
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.held?.removeFromParent();
    this.held = null;
    this.element.remove();
  }

  private async setModel(model: number): Promise<void> {
    const source = await ItemThumbnails.get().loadModel(model);
    if (!source || !this.element.isConnected) return;
    this.held?.removeFromParent();

    // Use a pivot container centered at (0, 0, 0) so the model rotates strictly in place without orbiting
    const pivot = new THREE.Group();
    const mesh = clone(source);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(0.1, size.length() / 2);

    // Shift mesh inside the pivot so its geometric center is exactly at (0, 0, 0)
    mesh.position.set(-centre.x, -centre.y, -centre.z);
    pivot.add(mesh);

    // Enlarge the model in the 160px viewport
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const dist = (radius / Math.tan(fovRad)) * 0.88;
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(pivot);
    this.held = pivot;
  }

  private frame(now: number): void {
    if (!this.animation) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.held && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Rotates strictly on its geometric center axis
      this.held.rotation.y += dt * 0.75;
    }
    this.renderer?.render(this.scene, this.camera);
    this.animation = requestAnimationFrame((next) => this.frame(next));
  }
}
