import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { addItemLights, fitItemCamera, ItemThumbnails, poseItem } from './item_thumbnails.ts';

/** How much larger than its footprint the held item is drawn (lifted off the grid). */
const LIFT = 1.15;
/** Sway of the held model around its display pose (radians, per side). */
const SWAY = 0.35;

/**
 * The item carried by a drag: its 3D model sized to its grid footprint, posed and lit like its
 * slot thumbnail, swaying gently and kept under the cursor at the point where it was grabbed.
 * One reusable WebGL canvas (never one per drag); without a model or WebGL, the item's glyph.
 */
export class HeldItemPreview {
  private readonly element = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly glyph = document.createElement('span');
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  private held: THREE.Group | null = null;
  private animation = 0;
  private started = 0;
  /** Bumped by every show/hide so a model that loads late is not added to a newer drag. */
  private token = 0;
  private grab = { x: 0, y: 0 };

  constructor() {
    this.element.className = 'inv-drag-preview';
    this.glyph.className = 'inv-drag-glyph';
    this.element.append(this.canvas, this.glyph);
    addItemLights(this.scene);
  }

  /**
   * Shows the held item over everything: `cell` is the bag cell size in CSS pixels, `grab` the
   * point of the footprint (pixels from its top-left) that stays under the cursor.
   */
  show(item: { model?: number; width: number; height: number; glyph: string }, cell: number, grab: { x: number; y: number }): void {
    this.hide();
    const token = ++this.token;
    const w = Math.round(item.width * cell * LIFT);
    const h = Math.round(item.height * cell * LIFT);
    this.grab = { x: grab.x * LIFT, y: grab.y * LIFT };
    this.element.style.width = `${w}px`;
    this.element.style.height = `${h}px`;
    this.glyph.textContent = item.glyph;
    this.element.classList.remove('inv-drag-has-model');
    document.body.append(this.element);
    if (item.model === undefined || !this.ensureRenderer()) return;
    this.renderer!.setSize(w, h, false);
    void ItemThumbnails.get().loadModel(item.model).then((source) => {
      if (!source || token !== this.token) return;
      const pivot = new THREE.Group();
      const size = poseItem(pivot, clone(source), item.model!, item.width, item.height);
      // Room for the sway: the posed model never touches the canvas edge.
      fitItemCamera(this.camera, size, w / h, 1.12);
      this.scene.add(pivot);
      this.held = pivot;
      this.element.classList.add('inv-drag-has-model');
      this.started = performance.now();
      this.animation ||= requestAnimationFrame((now) => this.frame(now));
    });
  }

  move(x: number, y: number): void {
    this.element.style.transform = `translate(${Math.round(x - this.grab.x)}px, ${Math.round(y - this.grab.y)}px)`;
  }

  hide(): void {
    this.token++;
    cancelAnimationFrame(this.animation);
    this.animation = 0;
    this.held?.removeFromParent();
    this.held = null;
    this.element.remove();
  }

  private ensureRenderer(): boolean {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      return true;
    } catch {
      return false;
    }
  }

  private frame(now: number): void {
    if (!this.animation || !this.held) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.held.rotation.y = still ? 0 : Math.sin((now - this.started) / 650) * SWAY;
    this.renderer?.render(this.scene, this.camera);
    this.animation = requestAnimationFrame((next) => this.frame(next));
  }
}
