import * as THREE from 'three';
import {
  DEFAULT_MOVEMENT_STATS,
  LEVEL_PREFIX,
  TICK_DT,
  TICK_MS,
  createCharacter,
  createInputFrame,
  createMovementWorld,
  createSyntheticArena,
  initPhysics,
  stepCharacter,
  type ArenaDef,
  type ClientSession,
  type MovementWorld,
} from '@crusaders/shared';
import { createRenderContext } from './engine/renderer.ts';
import { ChaseCamera } from './engine/camera.ts';
import { buildArenaMeshes } from './entities/arena.ts';
import { ProceduralAvatar } from './entities/avatar.ts';
import { LocalPlayer } from './entities/local_player.ts';
import { RemoteEntities } from './entities/remote_entities.ts';
import { loadOriginalAvatars } from './assets/original_models.ts';
import { fetchServerArena, loadOriginalLevel, type OriginalLevel } from './assets/original_level.ts';
import { CREATURE_SFX, SFX, SoundBank, pick } from './audio/sound_bank.ts';
import { InputManager } from './input/input_manager.ts';
import { connectToWorld } from './network/connect.ts';
import { CombatUi } from './ui/combat_ui.ts';
import { Hud } from './ui/hud.ts';
import { InventoryPanel } from './ui/inventory.ts';
import { chooseAuth, logout } from './ui/login.ts';

const MAX_FRAME_MS = 250;

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const overlay = document.getElementById('overlay')!;

  const [rapier, originals, sounds] = await Promise.all([initPhysics(), loadOriginalAvatars(), SoundBank.load()]);
  const { renderer, scene } = createRenderContext(container);
  const remotes = new RemoteEntities(scene, originals);
  const combatUi = new CombatUi(document.getElementById('world-ui')!);
  const hud = new Hud(document.getElementById('hud')!, document.getElementById('player-panel')!, document.getElementById('death')!);
  const inventoryPanel = new InventoryPanel(document.getElementById('inventory')!);

  // Online: the session predicts and reconciles. Offline: plain local simulation.
  const auth = await chooseAuth();

  // The zone's arena: the server's (online) or ?level=<act> / the synthetic arena (offline).
  // Original levels come from the user's own converted installation (dev only).
  const levelParam = new URLSearchParams(location.search).get('level');
  const arenaName = auth.kind === 'offline'
    ? (levelParam ? `${LEVEL_PREFIX}${levelParam}` : 'synthetic-arena')
    : ((await fetchServerArena()) ?? 'synthetic-arena');
  let arena: ArenaDef;
  let levelView: OriginalLevel | null = null;
  if (arenaName.startsWith(LEVEL_PREFIX)) {
    levelView = await loadOriginalLevel(arenaName);
    arena = levelView.arena;
    scene.add(levelView.object);
    levelView.applyAtmosphere(scene);
  } else {
    arena = createSyntheticArena();
    scene.add(buildArenaMeshes(arena));
  }
  let player: LocalPlayer | null = null;
  const headPos = new THREE.Vector3();
  const prompt = document.getElementById('prompt')!;
  let lastStats: { level: number; dead: boolean } | null = null;
  /** Edge of the local player's weapon, for impact sounds (stronger of slash / bash). */
  let myEdge: 'sharp' | 'blunt' = 'blunt';
  const session: ClientSession | null =
    auth.kind === 'offline'
      ? null
      : await connectToWorld(rapier, arena, auth.kind, {
          spawn: (id, _name, info) => remotes.spawn(id, info),
          despawn: (id) => remotes.despawn(id),
          correction: (dx, dy, dz) => player?.correct(dx, dy, dz),
          stats: (s) => {
            hud.stats(s);
            if (player) player.dead = s.dead;
            if (lastStats && s.level > lastStats.level) sounds?.play(SFX.levelUp);
            if (lastStats && s.dead && !lastStats.dead) sounds?.play(SFX.died);
            lastStats = { level: s.level, dead: s.dead };
          },
          combat: (e) => {
            const target = remotes.byId.get(e.target);
            const isMe = session !== null && e.target === session.entityId;
            const obj = isMe ? player?.object : target?.avatar.object;
            if (!obj) return;
            headPos.copy(obj.position);
            headPos.y += isMe ? player!.avatar.headHeight : target!.avatar.headHeight;
            const mine = session !== null && e.attacker === session.entityId;
            combatUi.damage(e, headPos, isMe ? 'taken' : mine ? 'dealt' : 'other');
            // Original impact / cry sounds (executable sound tables, Sound.ctx ids).
            if (sounds) {
              if (e.blocked) sounds.play(SFX.shieldBlockWood, headPos);
              else if (isMe) {
                sounds.play(SFX.impact.flesh.sharp, headPos);
                sounds.play(pick(e.killed ? SFX.drakeDeath : SFX.drakeDamage), headPos);
              } else if (target) {
                const sfx = CREATURE_SFX[target.info.archetype ?? ''];
                sounds.play(SFX.impact[sfx?.material ?? 'flesh'][mine ? myEdge : 'sharp'], headPos);
                if (sfx) sounds.play(e.killed ? sfx.death : sfx.damage, headPos);
              }
            }
          },
          objects: (d) => {
            for (const o of d.objects as { id: number; state: 'present' | 'gone' | 'open'; by?: number; loot?: string[]; damage?: number }[]) {
              const view = levelView?.objects.get(o.id);
              levelView?.setObjectState(o.id, o.state);
              if (!view || d.full) continue;
              const mine = session !== null && o.by === session.entityId;
              const at = view.position;
              if (view.def.kind === 'chest' && o.state === 'open') sounds?.play(SFX.chestOpen, at);
              else if (view.def.kind === 'item' && o.state === 'gone' && mine) sounds?.play(SFX.click);
              else if (view.def.kind === 'prop') {
                const glass = /bottle|glass/i.test(view.def.name);
                const barrel = /barrel/i.test(view.def.name);
                if (o.state === 'gone') sounds?.play(glass ? SFX.breakGlass : barrel ? SFX.breakBarrel : SFX.breakWood, at);
                else sounds?.play(SFX.hitWood, at);
              }
              if (mine && o.loot?.length) {
                headPos.copy(at);
                headPos.y += 1;
                combatUi.notice(`+ ${o.loot.join(', ')}`, headPos);
              }
            }
          },
          inventory: (inv) => {
            inventoryPanel.update(inv);
            player?.setWeaponSpeed(inv.weaponSpeed);
            const w = inv.items.find((i) => i.type === 'weapon' && i.equipped);
            myEdge = w?.damage && w.damage[0]! > w.damage[1]! ? 'sharp' : 'blunt';
          },
          close: (code, reason) => {
            document.getElementById('error')!.textContent = `Disconnected from server (${code}${reason ? `: ${reason}` : ''}). Reload to reconnect.`;
          },
        });
  const selfAvatar = originals?.('self') ?? new ProceduralAvatar('self');
  let mw: MovementWorld;
  if (session) {
    mw = session.mw;
    player = new LocalPlayer(session.character!, selfAvatar, (f) => session.tick(f));
    if (session.playerStats) {
      hud.stats(session.playerStats);
      lastStats = { level: session.playerStats.level, dead: session.playerStats.dead };
    }
    for (const [id, state] of session.objectStates) levelView?.setObjectState(id, state);
    if (session.inventory) {
      inventoryPanel.update(session.inventory);
      player.setWeaponSpeed(session.inventory.weaponSpeed);
    }
    for (const [id, info] of session.entities) remotes.spawn(id, info);
  } else {
    const offline = createMovementWorld(rapier, arena);
    mw = offline;
    const character = createCharacter(offline, arena.spawnPoints[0]!);
    player = new LocalPlayer(character, selfAvatar, (f) => stepCharacter(offline, character, f, DEFAULT_MOVEMENT_STATS, TICK_DT));
  }
  const local = player;
  scene.add(local.object);

  const chase = new ChaseCamera(mw, container.clientWidth / container.clientHeight);
  const input = new InputManager(renderer.domElement);
  input.onAttack = () => {
    if (local.swing(input.yaw)) {
      session?.attack();
      sounds?.play(pick(SFX.swing), local.object.position, { volume: 0.7 });
    }
  };

  overlay.addEventListener('click', () => {
    sounds?.unlock();
    input.requestLock();
  });

  // Nearest item or chest within reach (the server re-checks); E picks up / opens.
  const INTERACT_RANGE = 2.3;
  const nearestInteractable = () => {
    if (!levelView || !session) return null;
    let best: { id: number; label: string; d: number } | null = null;
    for (const [id, v] of levelView.objects) {
      if (v.state !== 'present' || (v.def.kind !== 'item' && v.def.kind !== 'chest')) continue;
      const p = local.object.position;
      const d = Math.hypot(v.position.x - p.x, v.position.z - p.z);
      if (d > INTERACT_RANGE || Math.abs(v.position.y - p.y) > 2 || (best && best.d < d)) continue;
      const label = v.def.kind === 'chest' ? 'open chest' : `pick up ${v.def.item?.quantity && v.def.item.quantity > 1 ? `${v.def.item.quantity} ` : ''}${v.def.item?.name ?? v.def.name}`;
      best = { id, label, d };
    }
    return best;
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyE' || !input.locked) return;
    const target = nearestInteractable();
    if (target) session?.interact(target.id);
  });
  overlay.classList.remove('hidden');
  const logoutLink = document.getElementById('btn-logout')!;
  logoutLink.hidden = auth.kind !== 'account';
  logoutLink.addEventListener('click', async (e) => {
    e.stopPropagation();
    session?.close();
    await logout();
    location.reload();
  });
  input.onLockChange = (locked) => overlay.classList.toggle('hidden', locked || inventoryPanel.open);

  // Inventory (online only): I toggles it, releasing the pointer so items can be clicked.
  const setInventoryOpen = (open: boolean) => {
    if (!session || open === inventoryPanel.open) return;
    inventoryPanel.open = open;
    if (open) document.exitPointerLock();
    else input.requestLock();
    overlay.classList.toggle('hidden', open || input.locked);
  };
  inventoryPanel.onToggleEquip = (slot, equip) => {
    const item = session?.inventory?.items.find((i) => i.slot === slot);
    if (item?.type === 'potion') session?.useItem(slot);
    else session?.equip(slot, equip);
  };
  inventoryPanel.onClose = () => setInventoryOpen(false);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyI' && !e.repeat) setInventoryOpen(!inventoryPanel.open);
    else if (e.code === 'Escape' && inventoryPanel.open) setInventoryOpen(false);
  });

  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    chase.camera.aspect = container.clientWidth / container.clientHeight;
    chase.camera.updateProjectionMatrix();
  });

  if (import.meta.env.DEV) {
    // Debug/E2E hook: lets tests drive input without pointer lock.
    (window as unknown as { __co: unknown }).__co = { input, player: local, mw, session, remotes, inventory: inventoryPanel, scene, camera: chase.camera, renderer, level: levelView, render: () => renderer.render(scene, chase.camera) };
  }

  // Fixed-step simulation (same 20 Hz step as the server), interpolated rendering.
  const frame = createInputFrame();
  let tick = 0;
  let acc = 0;
  let last = performance.now();
  const target = new THREE.Vector3();
  const lastStep = new THREE.Vector3();
  let stepFoot = 0;

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
    if (session) remotes.update(session, dt);
    target.copy(local.object.position);
    chase.update(target, input.yaw, input.pitch, dt);
    levelView?.update(chase.camera, dt);
    if (sounds) {
      sounds.setListener(chase.camera);
      // Footsteps on stone while running on the ground (catacomb floors are ST materials).
      const moving = local.character.grounded && Math.hypot(local.object.position.x - lastStep.x, local.object.position.z - lastStep.z) > 1.1;
      if (moving) {
        lastStep.copy(local.object.position);
        sounds.play(SFX.footstepStone[stepFoot = 1 - stepFoot]!, local.object.position, { volume: 0.35 });
      }
    }
    if (levelView && session) {
      const t = nearestInteractable();
      prompt.hidden = !t;
      if (t) prompt.textContent = `E — ${t.label}`;
    }
    renderer.render(scene, chase.camera);
    combatUi.update(dt, chase.camera, remotes, container.clientWidth, container.clientHeight);
    hud.update(dt, tick, local.character, session, remotes.count);
  });
}

main().catch((err: unknown) => {
  console.error(err);
  document.getElementById('error')!.textContent = `Failed to start: ${(err as Error).message ?? err}`;
});
