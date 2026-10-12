import * as THREE from 'three';
import {
  DEFAULT_MOVEMENT_STATS,
  INPUT,
  INPUT_ATTACK_SHIFT,
  BUILTIN_SPELLS,
  CASTABLE_SPELLS,
  SPELL_CONJURE_TICKS,
  THRUST_WALL_DISTANCE,
  THRUST_WALL_HEIGHT,
  wallAhead,
  wallDistance,
  ACTION_BASH,
  PLAYER_REACH,
  attackTiming,
  LEVEL_PREFIX,
  attackKindFor,
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
import { CameraRig } from './engine/camera_rig.ts';
import { CLASSIC_SETTINGS, SettingsStore } from './settings.ts';
import { SettingsPanel } from './ui/settings_panel.ts';
import { CONTROLS_HELP } from './input/keybindings.ts';
import { buildArenaMeshes } from './entities/arena.ts';
import { ProceduralAvatar } from './entities/avatar.ts';
import { LocalPlayer } from './entities/local_player.ts';
import { RemoteEntities } from './entities/remote_entities.ts';
import { loadOriginalAvatars } from './assets/original_models.ts';
import { loadOriginalLevel, type OriginalLevel } from './assets/original_level.ts';
import { CREATURE_SFX, SFX, SoundBank, pick } from './audio/sound_bank.ts';
import { registerAssetServiceWorker } from './assets/game_files.ts';
import { GameFilesPanel } from './ui/game_files_panel.ts';
import { InputManager } from './input/input_manager.ts';
import { MusicPlayer } from './audio/music.ts';
import { Effects } from './engine/effects.ts';
import { TORCH_LIGHT_COLOR, TORCH_LIGHT_HEIGHT, TORCH_LIGHT_INTENSITY } from './entities/torch_light.ts';
import { connectToWorld } from './network/connect.ts';
import { CombatUi } from './ui/combat_ui.ts';
import { Hud } from './ui/hud.ts';
import { InventoryPanel } from './ui/inventory.ts';
import { chooseAuth, logout } from './ui/login.ts';

const MAX_FRAME_MS = 250;

/** Side of `target` (facing its rotation.y, 0 = -Z) that `from` stands on: 0 front, 1 left, 2 right, 3 back. */
function impactSide(target: THREE.Object3D, from: THREE.Object3D): number {
  const yaw = target.rotation.y;
  const dx = from.position.x - target.position.x;
  const dz = from.position.z - target.position.z;
  const ahead = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
  const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
  if (Math.abs(ahead) >= Math.abs(right)) return ahead >= 0 ? 0 : 3;
  return right >= 0 ? 2 : 1;
}

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const overlay = document.getElementById('overlay')!;

  // Original assets: imported in this browser (service worker over Cache Storage) or dev server.
  await registerAssetServiceWorker();
  const gameFiles = new GameFilesPanel(document.getElementById('game-files')!);
  void gameFiles.init().then(() => (gameFiles.visible = true));
  const [rapier, originals, sounds] = await Promise.all([initPhysics(), loadOriginalAvatars(), SoundBank.load()]);
  const { renderer, scene } = createRenderContext(container);
  const remotes = new RemoteEntities(scene, originals);
  const combatUi = new CombatUi(document.getElementById('world-ui')!);
  const hud = new Hud(document.getElementById('hud')!, document.getElementById('player-panel')!, document.getElementById('death')!);
  const inventoryPanel = new InventoryPanel(document.getElementById('inventory')!);

  // Online: the session predicts and reconciles. Offline: plain local simulation.
  const auth = await chooseAuth();

  // Zones: online, the server announces the arena on login and on every portal transition
  // (SC_ZONE_CHANGE); offline it is ?level=<act> or the synthetic arena. Original levels come
  // from the player's own game files.
  const errorBox = document.getElementById('error')!;
  let arena: ArenaDef = createSyntheticArena();
  let levelView = null as OriginalLevel | null;
  let arenaObject: THREE.Object3D | null = null;
  /** Loads an arena into the scene, replacing the previous one. Null if it cannot be shown. */
  /** The level act's music (the original's CD tracks, looped). */
  const music = new MusicPlayer(CLASSIC_SETTINGS.musicVolume);
  const showArena = async (name: string): Promise<ArenaDef | null> => {
    let next: ArenaDef;
    let view: OriginalLevel | null = null;
    if (name.startsWith(LEVEL_PREFIX)) {
      try {
        view = await loadOriginalLevel(name);
      } catch (err) {
        console.warn('[assets] level unavailable:', err);
        errorBox.textContent = 'This world takes place in an original Crusaders of Might and Magic level. Import your game files (top right) to enter.';
        gameFiles.visible = true;
        return null;
      }
      next = view.arena;
    } else {
      next = createSyntheticArena();
    }
    if (arenaObject) scene.remove(arenaObject);
    arenaObject = view ? view.object : buildArenaMeshes(next);
    scene.add(arenaObject);
    view?.applyAtmosphere(scene);
    levelView = view;
    void music.play(view?.music);
    arena = next;
    return next;
  };
  const levelParam = new URLSearchParams(location.search).get('level');
  if (auth.kind === 'offline' && !(await showArena(levelParam ? `${LEVEL_PREFIX}${levelParam}` : 'synthetic-arena'))) return;
  let player: LocalPlayer | null = null;
  /** View camera between the original's (default) and the modern one (mouse wheel). */
  let chase!: CameraRig;
  const headPos = new THREE.Vector3();
  const prompt = document.getElementById('prompt')!;
  let lastStats: { level: number; dead: boolean } | null = null;
  /** The original's special effects (sparks, blood, bone chips), when the game files are imported. */
  let effects: Effects | null = null;
  void Effects.load(scene).then((e) => (effects = e));
  const fxPos = new THREE.Vector3();
  /** Pending wall-spark checks of the local swings (seconds to the impact frame, heading). */
  const wallChecks: { t: number; yaw: number }[] = [];
  /** The local character's timed action on the previous step (to catch a rush starting). */
  let lastAction = 0;
  const fxDir = new THREE.Vector3();
  /** Spawns `count` copies of an effect along a short line from `at` (the engine spaces them ~0.2 m apart). */
  const fxBurst = (name: string, count: number, at: THREE.Vector3, step: THREE.Vector3, dir: THREE.Vector3 | null = null) => {
    for (let i = 0; i < count; i++) effects?.spawn(name, fxPos.copy(at).addScaledVector(step, i), dir);
  };
  /** The local player's Torch Light (radius from the server's stats). */
  const myTorch = new THREE.PointLight(TORCH_LIGHT_COLOR, TORCH_LIGHT_INTENSITY, 1, 1.4);
  myTorch.visible = false;
  scene.add(myTorch);
  /** Edge of the local player's weapon, for impact sounds (stronger of slash / bash). */
  let myEdge: 'sharp' | 'blunt' = 'blunt';
  /** Set as soon as the session exists: zone / enter events fire before connectToWorld resolves. */
  let live: ClientSession | null = null;
  const session: ClientSession | null =
    auth.kind === 'offline'
      ? null
      : await connectToWorld(rapier, arena, auth.kind, {
          spawn: (id, _name, info) => remotes.spawn(id, info),
          despawn: (id) => remotes.despawn(id),
          correction: (dx, dy, dz) => player?.correct(dx, dy, dz),
          stats: (s) => {
            hud.stats(s);
            myTorch.distance = s.light;
            myTorch.visible = s.light > 0;
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
            // Hit reaction from the attacker's side (ASM_IMPACT_FRONT/LEFT/RIGHT/BACK).
            const from = mine ? player?.object : remotes.byId.get(e.attacker)?.avatar.object;
            const avatar = isMe ? player?.avatar : target?.avatar;
            if (from && avatar?.react && !e.blocked && !e.killed && e.damage > 0) avatar.react(impactSide(obj, from));
            if (e.rush) {
              // Shield rush contact: the shield's thud and a blunt impact on the target's material.
              const sfx = CREATURE_SFX[target?.info.archetype ?? ''];
              sounds?.play(SFX.shieldBlockWood, headPos);
              sounds?.play(SFX.impact[sfx?.material ?? 'flesh'].blunt, headPos);
              return;
            }
            // Original hit effects (executable-analysis §8.6): a blocked blow throws sparks and an
            // ember off the shield (x3); a landed one bone chips (skeletons, 3-7) or blood (2-3).
            if (effects && from) {
              const toward = fxDir.subVectors(from.position, obj.position).setY(0).normalize();
              const at = new THREE.Vector3().copy(obj.position).addScaledVector(toward, 0.35);
              at.y += 1.2;
              const step = new THREE.Vector3(0, 0.2, 0).addScaledVector(toward, -0.1);
              if (e.blocked) {
                fxBurst('SWORD_DAMAGE', 3, at, step);
                fxBurst('SWORD_METAL', 3, at, step);
              } else if (e.damage > 0) {
                const bone = !isMe && CREATURE_SFX[target?.info.archetype ?? '']?.material === 'bone';
                // Undead blows carry dark damage: the original adds its green flame on the victim.
                const undeadAttacker = !mine && CREATURE_SFX[remotes.byId.get(e.attacker)?.info.archetype ?? '']?.material === 'bone';
                if (undeadAttacker) effects.spawn('FIREBALL_PROJ_EVIL_SPAWN', at);
                if (bone) fxBurst('BONE', 3 + Math.floor(Math.random() * 5), at, step.clone().multiplyScalar(-1));
                else fxBurst('BLOOD', 2 + Math.floor(Math.random() * 2), at, step.clone().multiplyScalar(-1));
              }
            }
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
                // Struck props throw stone-like sparks upwards (SWORD_STONE x6, logged on a barrel).
                fxPos.copy(at);
                fxPos.y += 0.8;
                fxBurst('SWORD_STONE', 6, fxPos.clone(), new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, 1, 0));
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
          zone: (name) => {
            // Portal transitions (and the first entry): swap the level, then tell the server.
            errorBox.textContent = `Entering ${name.replace(LEVEL_PREFIX, '').toUpperCase()}…`;
            remotes.clear();
            void showArena(name).then((next) => {
              if (!next || !live) return;
              live.setArena(next);
              live.zoneReady(name);
            });
          },
          enter: () => {
            errorBox.textContent = '';
            if (!live || !player) return; // first entry: the player is created below
            player.character = live.character!;
            chase.mw = live.mw;
            chase.snap();
            for (const [id, state] of live.objectStates) levelView?.setObjectState(id, state);
          },
          close: (code, reason) => {
            document.getElementById('error')!.textContent = `Disconnected from server (${code}${reason ? `: ${reason}` : ''}). Reload to reconnect.`;
          },
        }, (created) => (live = created));
  const selfAvatar = originals?.('self') ?? new ProceduralAvatar('self');
  if (session) selfAvatar.seed = session.entityId;
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

  const settings = new SettingsStore();
  music.volume = settings.current.musicVolume;
  settings.onChange((s) => (music.volume = s.musicVolume));
  // Footsteps on the original clips' own LEFT/RIGHT FOOTSTEP events, in step with the animation,
  // with the step sound of the surface underfoot.
  const stepSounds = (): readonly number[] => SFX.footsteps[levelView?.surfaceAt(local.object.position) ?? 'stone'];
  local.avatar.onEvent = (name) => {
    if (!sounds || !name.includes('FOOTSTEP') || !local.character.grounded) return;
    const foot = name.includes('RIGHT') ? 1 : 0;
    sounds.play(stepSounds()[foot]!, local.object.position, { volume: name.includes('SOFT') ? 0.2 : 0.35 });
  };
  chase = new CameraRig(mw, container.clientWidth / container.clientHeight);
  const input = new InputManager(renderer.domElement);
  const applySettings = () => {
    const s = settings.current;
    chase.zoom = s.cameraZoom;
    input.sensitivity = s.mouseSensitivity;
    input.invertY = s.invertMouseY;
  };
  applySettings();
  settings.onChange(applySettings);
  new SettingsPanel(document.getElementById('settings')!, settings);
  document.getElementById('controls-help')!.textContent = CONTROLS_HELP;
  // Mouse wheel: zoom between the classic camera (closest) and the modern one (farthest).
  renderer.domElement.addEventListener('wheel', (e) => {
    if (!input.locked) return;
    e.preventDefault();
    settings.update({ cameraZoom: Math.round((settings.current.cameraZoom + Math.sign(e.deltaY) * 0.1) * 100) / 100 });
  }, { passive: false });
  input.onAttack = () => {
    // The movement key held with the click picks the attack (original controls).
    // Holding C (ducked) ignores clicks, as in the original.
    if (input.heldFlags & INPUT.DUCK) return;
    let kind = attackKindFor(input.heldFlags, local.character.grounded);
    // A plain click with a wall within 5 ft ahead plays the jab instead (combo routine).
    const feet = local.character.position;
    if (kind === 'normal' && wallAhead(session?.mw ?? mw, feet, input.yaw, THRUST_WALL_DISTANCE, THRUST_WALL_HEIGHT)) kind = 'thrust';
    const started = local.swing(input.yaw, kind);
    if (started) {
      // Check for a wall at the swing's impact frame (sparks off the stone).
      const timing = attackTiming(started, 1);
      wallChecks.push({ t: (timing.startup + timing.active / 2) * TICK_DT, yaw: input.yaw });
      session?.attack(started);
      sounds?.play(pick(SFX.swing), local.object.position, { volume: 0.7 });
    }
  };

  overlay.addEventListener('click', () => {
    sounds?.unlock();
    music.unlock();
    input.requestLock();
  });

  // Nearest item, chest or door within reach (the server re-checks); Tab picks up / opens.
  const INTERACT_RANGE = 2.3;
  const DOOR_RANGE = 1.6;
  const nearestInteractable = () => {
    if (!levelView || !session) return null;
    let best: { id: number; label: string; d: number; key?: boolean } | null = null;
    const p = local.object.position;
    for (const [id, door] of levelView.doors) {
      const b = door.def.bounds!;
      if (door.state !== 'present' || door.def.byLever || p.y < b[1] - 2 || p.y > b[4]) continue;
      const d = Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[3]), Math.max(b[2] - p.z, 0, p.z - b[5]));
      if (d > DOOR_RANGE || (best && best.d < d)) continue;
      const lock = door.def.lock;
      const hasKey = !!lock && (session.inventory?.items ?? []).some((i) => i.name === lock);
      const label = door.def.kind === 'lever' ? 'Tab — pull lever' : !lock ? 'Tab — open door' : hasKey ? `Z — unlock door (${lock})` : `Locked — needs ${lock}`;
      best = { id, label, d, ...(lock ? { key: true } : {}) };
    }
    for (const [id, v] of levelView.objects) {
      if (v.state !== 'present' || (v.def.kind !== 'item' && v.def.kind !== 'chest')) continue;
      const d = Math.hypot(v.position.x - p.x, v.position.z - p.z);
      if (d > INTERACT_RANGE || Math.abs(v.position.y - p.y) > 2 || (best && best.d < d)) continue;
      const label = v.def.kind === 'chest' ? 'open chest' : `pick up ${v.def.item?.quantity && v.def.item.quantity > 1 ? `${v.def.item.quantity} ` : ''}${v.def.item?.name ?? v.def.name}`;
      best = { id, label: `Tab — ${label}`, d };
    }
    return best;
  };
  input.onAction = (action) => {
    if (action === 'interact') {
      const target = nearestInteractable();
      if (target && !target.key) session?.interact(target.id);
    } else if (action === 'useItem') {
      // Z: the key on a locked door in reach, otherwise the weakest healing potion.
      const target = nearestInteractable();
      if (target?.key) session?.interact(target.id, true);
      else {
        const potion = (session?.inventory?.items ?? []).filter((i) => i.type === 'potion').sort((a, b) => (a.heal ?? 0) - (b.heal ?? 0))[0];
        if (potion) session?.useItem(potion.slot);
      }
    } else if (action === 'castSpell') {
      // R: conjure the selected spell (the server checks mana and state; the caster stands still).
      const st = session?.playerStats;
      const known = st?.spells.find((k) => k.spell === st.spell);
      const cost = known && st?.spell ? BUILTIN_SPELLS[st.spell]?.[known.level - 1]?.mana ?? 0 : 0;
      if (st?.spell && CASTABLE_SPELLS.has(st.spell) && st.mana >= cost && local.startCast(SPELL_CONJURE_TICKS * TICK_DT)) session?.castSpell();
    } else if (action === 'nextSpell') {
      // T: the next known spell.
      const st = session?.playerStats;
      if (st && st.spells.length) {
        const i = st.spells.findIndex((k) => k.spell === st.spell);
        session?.selectSpell(st.spells[(i + 1) % st.spells.length]!.spell);
      }
    } else if (action === 'healthPotion') {
      // H: drink the weakest healing potion carried (the original's quick potion key).
      const potions = (session?.inventory?.items ?? []).filter((i) => i.type === 'potion');
      const potion = potions.sort((a, b) => (a.heal ?? 0) - (b.heal ?? 0))[0];
      if (potion) session?.useItem(potion.slot);
    }
  };
  overlay.classList.remove('hidden');
  const logoutLink = document.getElementById('btn-logout')!;
  logoutLink.hidden = auth.kind !== 'account';
  logoutLink.addEventListener('click', async (e) => {
    e.stopPropagation();
    session?.close();
    await logout();
    location.reload();
  });
  input.onLockChange = (locked) => {
    overlay.classList.toggle('hidden', locked || inventoryPanel.open);
    gameFiles.visible = !locked;
  };

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
    chase.resize(container.clientWidth / container.clientHeight);
  });

  if (import.meta.env.DEV) {
    // Debug/E2E hook: lets tests drive input without pointer lock.
    (window as unknown as { __co: unknown }).__co = { input, player: local, mw, session, remotes, inventory: inventoryPanel, scene, get camera() { return chase.camera; }, cameras: { classic: chase.classic, modern: chase.modern }, rig: chase, settings, renderer, level: levelView, get effects() { return effects; }, render: () => renderer.render(scene, chase.camera) };
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
      if (local.rooted) frame.flags |= INPUT.ROOTED;
      // An attack whose clip carries Drake starts its root motion on this step (shared movement).
      frame.flags |= local.takeAttackMotion() << INPUT_ATTACK_SHIFT;
      local.fixedStep(frame);
      // The shield rush starts with Drake's effort grunt.
      const action = local.character.rollDir;
      if (action === ACTION_BASH && lastAction !== ACTION_BASH) sounds?.play(SFX.swingGrunt, local.object.position);
      lastAction = action;
      acc -= TICK_MS;
    }
    const dt = frameMs / 1000;
    local.viewHeading = input.yaw;
    local.render(acc / TICK_MS, dt);
    if (myTorch.visible) myTorch.position.set(local.object.position.x, local.object.position.y + TORCH_LIGHT_HEIGHT, local.object.position.z);
    if (session) remotes.update(session, dt);
    effects?.update(dt);
    // A swing that reaches a wall throws sparks off it at its impact frame (SWORD_DAMAGE + SWORD_METAL x3).
    for (let i = wallChecks.length - 1; i >= 0; i--) {
      const w = wallChecks[i]!;
      if ((w.t -= dt) > 0) continue;
      wallChecks.splice(i, 1);
      const feet = local.character.position;
      const d = wallDistance(session?.mw ?? mw, feet, w.yaw, PLAYER_REACH + 0.6, 1.2);
      if (d === null || !effects) continue;
      const fwd = new THREE.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
      const at = new THREE.Vector3(feet.x, feet.y + 1.2, feet.z).addScaledVector(fwd, d - 0.05);
      const normal = fwd.clone().negate().setY(0.6).normalize();
      fxBurst('SWORD_DAMAGE', 3, at, normal.clone().multiplyScalar(0.2), normal);
      fxBurst('SWORD_METAL', 3, at, normal.clone().multiplyScalar(0.2), normal);
    }
    input.updateView(dt);
    const movingNow = Math.hypot(local.object.position.x - target.x, local.object.position.z - target.z) > 1e-4;
    target.copy(local.object.position);
    chase.update(target, input.yaw, local.bodyHeading, input.pitch, dt, movingNow);
    levelView?.update(chase.camera, dt);
    if (sounds) {
      sounds.setListener(chase.camera);
      // Footsteps on stone while running on the ground (catacomb floors are ST materials).
      // Placeholder avatars have no clip events: approximate steps by distance.
      const moving = !local.avatar.hasEvents && local.character.grounded && Math.hypot(local.object.position.x - lastStep.x, local.object.position.z - lastStep.z) > 1.1;
      if (moving) {
        lastStep.copy(local.object.position);
        sounds.play(stepSounds()[stepFoot = 1 - stepFoot]!, local.object.position, { volume: 0.35 });
      }
    }
    if (levelView && session) {
      const t = nearestInteractable();
      prompt.hidden = !t;
      if (t) prompt.textContent = t.label;
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
