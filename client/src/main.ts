import * as THREE from 'three';
import {
  DEFAULT_MOVEMENT_STATS,
  TICK_DT,
  TICK_MS,
  createCharacter,
  createInputFrame,
  createMovementWorld,
  createSyntheticArena,
  initPhysics,
  stepCharacter,
  type ClientSession,
  type MovementWorld,
} from '@crusaders/shared';
import { createRenderContext } from './engine/renderer.ts';
import { ChaseCamera } from './engine/camera.ts';
import { buildArenaMeshes } from './entities/arena.ts';
import { LocalPlayer } from './entities/local_player.ts';
import { RemotePlayers } from './entities/remote_players.ts';
import { InputManager } from './input/input_manager.ts';
import { connectToWorld } from './network/connect.ts';
import { Hud } from './ui/hud.ts';
import { chooseAuth, logout } from './ui/login.ts';

const MAX_FRAME_MS = 250;

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const overlay = document.getElementById('overlay')!;

  const rapier = await initPhysics();
  const arena = createSyntheticArena();

  const { renderer, scene } = createRenderContext(container);
  scene.add(buildArenaMeshes(arena));
  const remotes = new RemotePlayers(scene);

  // Online: the session predicts and reconciles. Offline: plain local simulation.
  const auth = await chooseAuth();
  let player: LocalPlayer | null = null;
  const session: ClientSession | null =
    auth.kind === 'offline'
      ? null
      : await connectToWorld(rapier, arena, auth.kind, {
          spawn: (id) => remotes.spawn(id),
          despawn: (id) => remotes.despawn(id),
          correction: (dx, dy, dz) => player?.correct(dx, dy, dz),
          close: (code, reason) => {
            document.getElementById('error')!.textContent = `Disconnected from server (${code}${reason ? `: ${reason}` : ''}). Reload to reconnect.`;
          },
        });
  let mw: MovementWorld;
  if (session) {
    mw = session.mw;
    player = new LocalPlayer(session.character!, (f) => session.tick(f));
  } else {
    const offline = createMovementWorld(rapier, arena);
    mw = offline;
    const character = createCharacter(offline, arena.spawnPoints[0]!);
    player = new LocalPlayer(character, (f) => stepCharacter(offline, character, f, DEFAULT_MOVEMENT_STATS, TICK_DT));
  }
  const local = player;
  scene.add(local.object);

  const chase = new ChaseCamera(mw, container.clientWidth / container.clientHeight);
  const input = new InputManager(renderer.domElement);
  const hud = new Hud(document.getElementById('hud')!);

  overlay.addEventListener('click', () => input.requestLock());
  overlay.classList.remove('hidden');
  const logoutLink = document.getElementById('btn-logout')!;
  logoutLink.hidden = auth.kind !== 'account';
  logoutLink.addEventListener('click', async (e) => {
    e.stopPropagation();
    session?.close();
    await logout();
    location.reload();
  });
  input.onLockChange = (locked) => overlay.classList.toggle('hidden', locked);

  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    chase.camera.aspect = container.clientWidth / container.clientHeight;
    chase.camera.updateProjectionMatrix();
  });

  if (import.meta.env.DEV) {
    // Debug/E2E hook: lets tests drive input without pointer lock.
    (window as unknown as { __co: unknown }).__co = { input, player: local, mw, session, remotes, render: () => renderer.render(scene, chase.camera) };
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
      local.fixedStep(frame);
      acc -= TICK_MS;
    }
    const dt = frameMs / 1000;
    local.render(acc / TICK_MS, dt);
    if (session) remotes.update(session);
    target.copy(local.object.position);
    chase.update(target, input.yaw, input.pitch, dt);
    renderer.render(scene, chase.camera);
    hud.update(dt, tick, local.character, session, remotes.count);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  document.getElementById('error')!.textContent = `Failed to start: ${(err as Error).message ?? err}`;
});
