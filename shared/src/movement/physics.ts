import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import type { ArenaDef, BoxDef } from '../arena/types.ts';
import { GROUND_SNAP, MAX_SLOPE_DEG, STEP_HEIGHT } from '../constants.ts';

export type Rapier = typeof RAPIER;

let ready: Promise<Rapier> | null = null;

/** Loads the (deterministic, cross-platform) Rapier WASM module once per process / page. */
export function initPhysics(): Promise<Rapier> {
  const p = ready ?? RAPIER.init().then(() => RAPIER);
  ready = p;
  return p;
}

/** Collision groups: (membership << 16) | filter. */
export const GROUP_WORLD = 0x0001;
export const GROUP_CHARACTER = 0x0002;
export const WORLD_GROUPS = (GROUP_WORLD << 16) | 0xffff;
/** Characters only collide with level geometry, never with each other. */
export const CHARACTER_GROUPS = (GROUP_CHARACTER << 16) | GROUP_WORLD;

export interface MovementWorld {
  rapier: Rapier;
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
}

function boxRotation(b: BoxDef): { x: number; y: number; z: number; w: number } {
  // q = qY(rotY) * qX(rotX)
  const hx = (b.rotX ?? 0) / 2;
  const hy = (b.rotY ?? 0) / 2;
  const sx = Math.sin(hx), cx = Math.cos(hx);
  const sy = Math.sin(hy), cy = Math.cos(hy);
  return { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx };
}

/** Whether level geometry lies within `distance` ahead of a character (yaw 0 faces -Z), probed at `height` above its feet. */
export function wallAhead(mw: MovementWorld, feet: { x: number; y: number; z: number }, yaw: number, distance: number, height: number): boolean {
  return wallDistance(mw, feet, yaw, distance, height) !== null;
}

/** Distance to level geometry ahead (within `distance`, at `height` above the feet), or null. */
export function wallDistance(mw: MovementWorld, feet: { x: number; y: number; z: number }, yaw: number, distance: number, height: number): number | null {
  const dir = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
  const ray = new mw.rapier.Ray({ x: feet.x, y: feet.y + height, z: feet.z }, dir);
  const hit = mw.world.castRay(ray, distance, true, undefined, CHARACTER_GROUPS);
  return hit ? hit.timeOfImpact : null;
}

/** Builds the static collision world for a level. Identical on client and server. */
export function createMovementWorld(rapier: Rapier, arena: ArenaDef): MovementWorld {
  const world = new rapier.World({ x: 0, y: 0, z: 0 }); // gravity is applied by the controller, not the solver

  for (const b of arena.boxes) {
    const desc = rapier.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
      .setTranslation(b.x, b.y, b.z)
      .setRotation(boxRotation(b))
      .setCollisionGroups(WORLD_GROUPS);
    world.createCollider(desc);
  }
  for (const m of arena.meshes) {
    world.createCollider(rapier.ColliderDesc.trimesh(m.vertices, m.indices).setCollisionGroups(WORLD_GROUPS));
  }
  // Populate the broad phase so scene queries see the static geometry.
  world.step();

  const controller = world.createCharacterController(0.01);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setMaxSlopeClimbAngle((MAX_SLOPE_DEG * Math.PI) / 180);
  controller.setMinSlopeSlideAngle(((MAX_SLOPE_DEG + 5) * Math.PI) / 180);
  controller.enableAutostep(STEP_HEIGHT, 0.2, false);
  controller.enableSnapToGround(GROUND_SNAP);
  controller.setApplyImpulsesToDynamicBodies(false);

  return { rapier, world, controller };
}

export function disposeMovementWorld(mw: MovementWorld): void {
  mw.world.removeCharacterController(mw.controller);
  mw.world.free();
}
