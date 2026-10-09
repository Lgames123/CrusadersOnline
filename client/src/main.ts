import * as THREE from 'three';
import {
  TICK_MS,
  createInputFrame,
  createMovementWorld,
  createSyntheticArena,
  initPhysics,
} from '@crusaders/shared';
import { createRenderContext } from './engine/renderer.ts';
import { ChaseCamera } from './engine/camera.ts';
import { buildArenaMeshes } from './entities/arena.ts';
import { LocalPlayer } from './entities/local_player.ts';
import { InputManager } from './input/input_manager.ts';
import { Hud } from './ui/hud.ts';

const MAX_FRAME_MS = 250;

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const overlay = document.getElementById('overlay')!;

  const rapier = await initPhysics();
  const arena = createSyntheticArena();
  const mw = createMovementWorld(rapier, arena);

  const { renderer, scene } = createRenderContext(container);
  scene.add(buildArenaMeshes(arena));

  const player = new LocalPlayer(mw, arena.spawnPoints[0]!);
  scene.add(player.object);

  const chase = new ChaseCamera(mw, container.clientWidth / container.clientHeight);
  const input = new InputManager(renderer.domElement);
  const hud = new Hud(document.getElementById('hud')!);

  overlay.addEventListener('click', () => input.requestLock());
  input.onLockChange = (locked) => overlay.classList.toggle('hidden', locked);

  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    chase.camera.aspect = container.clientWidth / container.clientHeight;
    chase.camera.updateProjectionMatrix();
  });

  if (import.meta.env.DEV) {
    // Debug/E2E hook: lets tests drive input without pointer lock.
    (window as unknown as { __co: unknown }).__co = { input, player, mw };
  }

  // Fixed-step simulation (same 20 Hz step as the server), interpolated rendering.
  const frame = createInputFrame();
  let tick = 0;
  let acc = 0;
  let last = performance.now();
  const target = new THREE.Vector3();

  renderer.setAnimationLoop((now) => {
    const frameMs = Math.min(now - last, MAX_FRAME_MS);
    last = now;
    acc += frameMs;
    while (acc >= TICK_MS) {
      input.sample(frame, ++tick);
      player.fixedStep(frame);
      acc -= TICK_MS;
    }
    const dt = frameMs / 1000;
    player.render(acc / TICK_MS, dt);
    target.copy(player.object.position);
    chase.update(target, input.yaw, input.pitch, dt);
    renderer.render(scene, chase.camera);
    hud.update(dt, tick, player.character);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  document.getElementById('error')!.textContent = `Failed to start: ${(err as Error).message ?? err}`;
});
