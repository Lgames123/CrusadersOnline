import * as THREE from 'three';
import { ANIM, LEVEL_PREFIX, LEVEL_UNIT_METRES, PLAYER_RADIUS } from '@crusaders/shared';
import { loadOriginalLevel, type OriginalLevel } from '../assets/original_level.ts';
import type { AvatarFactory } from '../assets/original_models.ts';
import { ProceduralAvatar, type Avatar } from '../entities/avatar.ts';
import { ModelLighting } from '../engine/model_light.ts';
import { dynamicLights } from '../engine/dynamic_lights.ts';
import { PostFx } from '../engine/post_fx.ts';
import type { SettingsStore } from '../settings.ts';

/**
 * Backdrop of the login, server and character screens (not original; the original opens on its
 * menus): Celestia among her guards in the Citadel's hall (act Ci1b: her briefing), filmed by a
 * slow drifting camera. Drake stands on the floor below her on the character screen. Without
 * the game files: a dusk sky and the placeholder Drake.
 */

const TITLE_ACT = 'ci1b';
/** Creatures shown: Celestia and her army (High Guards, Old Guards). */
const CAST = new Set(['npc_153', 'npc_113', 'npc_114']);
const ft = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).multiplyScalar(LEVEL_UNIT_METRES);

export type Shot = 'title' | 'character';

/** A camera move played back and forth: eye and target travel from a to b. */
interface Move {
  eye: [THREE.Vector3, THREE.Vector3];
  look: [THREE.Vector3, THREE.Vector3];
  seconds: number;
  /** Vertical field of view at 16:9; narrower windows widen it to keep the sides in view. */
  fov: number;
}

/** Shots in the Citadel hall (level units: feet, the converter's mirrored Z). */
const LEVEL_SHOTS: Record<Shot, Move> = {
  // Across the hall's floor towards the dais, Celestia among her guards, the sky behind.
  title: {
    eye: [ft(2028, 917, -1550), ft(2064, 919, -1558)],
    look: [ft(2052, 913.5, -1597), ft(2045, 913.5, -1597)],
    seconds: 45,
    fov: 42,
  },
  // Drake on the marble floor before the dais, Celestia over his shoulder.
  character: {
    eye: [ft(2054, 918.3, -1524.5), ft(2052.5, 918.3, -1524.5)],
    look: [ft(2050.2, 916.2, -1545), ft(2050.2, 916.2, -1545)],
    seconds: 20,
    fov: 40,
  },
};
/** Where Drake stands on the character screen (Ci1b's arrival point, on the floor before Celestia). */
const LEVEL_STAGE = ft(2049.4, 912, -1540);
/** Drake's default turn from facing the camera (a three-quarter view), radians. */
const PREVIEW_TURN = -0.35;

/** The same shots around the placeholder stage at the origin. */
const PLAIN_SHOTS: Record<Shot, Move> = {
  title: { eye: [new THREE.Vector3(-3, 1.8, 7), new THREE.Vector3(3, 1.8, 7)], look: [new THREE.Vector3(0, 2.5, -10), new THREE.Vector3(0, 2.5, -10)], seconds: 45, fov: 42 },
  character: { eye: [new THREE.Vector3(1.4, 1.9, 4.6), new THREE.Vector3(1.0, 1.9, 4.6)], look: [new THREE.Vector3(0.6, 1.0, 0), new THREE.Vector3(0.6, 1.0, 0)], seconds: 20, fov: 40 },
};

const smooth = (k: number) => k * k * (3 - 2 * k);

export class TitleScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  /** Music track of the hall's act, when the game files are there. */
  readonly music: number | undefined;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly postFx: PostFx;
  private readonly lighting: ModelLighting;
  private readonly level: OriginalLevel | null;
  private readonly cast: Avatar[] = [];
  private readonly shots: Record<Shot, Move>;
  private readonly stage: THREE.Vector3;
  private readonly originals: AvatarFactory | null;
  private readonly unsubscribe: () => void;
  private shot: Shot = 'title';
  private t = 0;
  /** Camera blend from the previous shot (1 = arrived). */
  private blend = 1;
  private readonly fromEye = new THREE.Vector3();
  private readonly fromLook = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private fromFov = 50;
  private preview: Avatar | null = null;
  /** Character screen: Drake's turn (dragged), radians. */
  previewYaw = 0;
  private embers: THREE.Points | null = null;
  private last = performance.now();
  private running = false;

  private constructor(renderer: THREE.WebGLRenderer, settings: SettingsStore, originals: AvatarFactory | null, level: OriginalLevel | null) {
    this.renderer = renderer;
    this.originals = originals;
    this.level = level;
    this.lighting = new ModelLighting(this.scene);
    this.postFx = new PostFx(renderer, this.scene);
    const applySettings = () => {
      dynamicLights.enabled = settings.current.enhancedLighting;
      this.postFx.enabled = settings.current.enhancedLighting;
      this.lighting.silhouettes = settings.current.silhouetteShadows;
      this.lighting.resample();
    };
    applySettings();
    this.unsubscribe = settings.onChange(applySettings);
    if (level) {
      this.shots = LEVEL_SHOTS;
      this.stage = LEVEL_STAGE;
      this.music = level.music;
      this.scene.add(level.object);
      level.applyAtmosphere(this.scene);
      this.lighting.setLevel(level.light);
      level.torches.forEach((p, i) => dynamicLights.set(`title-torch:${i}`, p, 0xff9a40, 1.2, 8, 0.15));
      for (const spawn of level.arena.mobSpawns) {
        if (!CAST.has(spawn.archetype)) continue;
        const avatar = originals?.(spawn.archetype);
        if (!avatar) continue;
        avatar.object.position.set(spawn.x, spawn.y - 0.1, spawn.z);
        avatar.object.rotation.y = spawn.yaw ?? 0;
        avatar.setState(ANIM.IDLE, 0);
        this.scene.add(avatar.object);
        this.lighting.track(avatar, avatar.object, PLAYER_RADIUS * 1.3, false, true);
        this.cast.push(avatar);
      }
    } else {
      this.shots = PLAIN_SHOTS;
      this.stage = new THREE.Vector3();
      this.music = undefined;
      this.buildPlainBackdrop();
    }
    const first = this.shots.title;
    this.eye.copy(first.eye[0]);
    this.look.copy(first.look[0]);
  }

  /** Loads the hall (or the placeholder backdrop when the game files are missing). */
  static async create(renderer: THREE.WebGLRenderer, settings: SettingsStore, originals: AvatarFactory | null): Promise<TitleScene> {
    let level: OriginalLevel | null = null;
    try {
      level = await loadOriginalLevel(`${LEVEL_PREFIX}${TITLE_ACT}`);
    } catch (err) {
      console.info('[title] the Citadel hall is unavailable, plain backdrop:', (err as Error).message);
    }
    return new TitleScene(renderer, settings, originals, level);
  }

  /** Whether the hall of the original game is shown (game files imported). */
  get original(): boolean {
    return this.level !== null;
  }

  setShot(shot: Shot): void {
    if (shot === this.shot) return;
    this.fromEye.copy(this.eye);
    this.fromLook.copy(this.look);
    this.fromFov = this.camera.fov;
    this.shot = shot;
    this.t = 0;
    this.blend = 0;
  }

  /** Drake on the character screen's stage (null: nobody), replacing the previous one. */
  setPreview(avatar: Avatar | null): void {
    if (this.preview) {
      this.scene.remove(this.preview.object);
      this.lighting.forget('preview');
      this.preview.dispose();
    }
    this.preview = avatar;
    if (!avatar) return;
    avatar.object.position.copy(this.stage);
    avatar.setState(ANIM.IDLE, 0);
    this.scene.add(avatar.object);
    this.lighting.track('preview', avatar.object, PLAYER_RADIUS * 1.3, false, true);
    this.lighting.playerKey = 'preview';
  }

  /** A Drake avatar for an outfit: the original model when available, else the placeholder. */
  async drake(outfit: Parameters<NonNullable<AvatarFactory['dressed']>>[0]): Promise<Avatar> {
    return (await this.originals?.dressed?.(outfit)) ?? this.originals?.('self') ?? new ProceduralAvatar('self');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Stops drawing and frees the scene (the game takes the renderer over). */
  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.unsubscribe();
    this.setPreview(null);
    for (const a of this.cast) a.dispose();
    this.lighting.clear();
    dynamicLights.removePrefix('title-torch:');
    this.postFx.enabled = false;
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh || (o as THREE.Points).isPoints) mesh.geometry?.dispose();
    });
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return; // hidden: nothing to draw into
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.postFx.setSize(w, h);
    }
    this.camera.aspect = w / Math.max(1, h);

    // The shot's move, eased back and forth; a new shot is reached in a short glide.
    const move = this.shots[this.shot];
    this.t += dt;
    const phase = (this.t / move.seconds) % 2;
    const k = smooth(phase < 1 ? phase : 2 - phase);
    const eye = new THREE.Vector3().lerpVectors(move.eye[0], move.eye[1], k);
    const look = new THREE.Vector3().lerpVectors(move.look[0], move.look[1], k);
    this.blend = Math.min(1, this.blend + dt / 1.6);
    const b = smooth(this.blend);
    this.eye.lerpVectors(this.fromEye, eye, b);
    this.look.lerpVectors(this.fromLook, look, b);
    const fov = (2 * Math.atan(Math.tan((move.fov * Math.PI) / 360) * Math.max(1, 16 / 9 / this.camera.aspect)) * 180) / Math.PI;
    this.camera.fov = this.fromFov + (fov - this.fromFov) * b;
    this.camera.position.copy(this.eye);
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();

    if (this.preview) {
      // Facing the camera, turned by dragging.
      const toCam = Math.atan2(-(this.eye.x - this.stage.x), -(this.eye.z - this.stage.z));
      this.preview.object.rotation.y = toCam + PREVIEW_TURN + this.previewYaw;
      this.preview.update(dt);
    }
    for (const a of this.cast) a.update(dt);
    if (this.embers) {
      this.embers.rotation.y += dt * 0.01;
      const pos = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * (0.15 + (i % 7) * 0.03);
        if (y > 12) y = -1;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    this.lighting.update(dt, now / 1000);
    this.level?.update(this.camera, dt);
    dynamicLights.update(this.camera, dt);
    this.postFx.render(this.camera, dt);
  }

  /** No game files: a dusk sky, a floor and drifting embers. */
  private buildPlainBackdrop(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {},
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
            vec3 low = vec3(0.42, 0.24, 0.16), mid = vec3(0.16, 0.12, 0.2), high = vec3(0.03, 0.04, 0.09);
            vec3 c = mix(low, mid, smoothstep(0.42, 0.55, h));
            c = mix(c, high, smoothstep(0.55, 0.9, h));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0x2a1c22, 12, 60);
    this.scene.add(new THREE.HemisphereLight(0xc8cfdd, 0x4a3020, 1.4));
    const key = new THREE.DirectionalLight(0xffc890, 2.2);
    key.position.set(4, 8, 6);
    this.scene.add(key);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 }));
    this.scene.add(floor);
    const n = 400;
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 3 + Math.random() * 25;
      const a = Math.random() * Math.PI * 2;
      pts.set([Math.cos(a) * r, Math.random() * 12, Math.sin(a) * r - 6], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.embers = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb060, size: 0.06, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(this.embers);
  }
}
