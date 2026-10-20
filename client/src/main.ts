import * as THREE from 'three';
import {
  ANIM,
  BOOMER_THROW,
  DEFAULT_MOVEMENT_STATS,
  MOB_ARCHETYPES,
  INPUT,
  INPUT_ATTACK_SHIFT,
  BUILTIN_SPELLS,
  CASTABLE_SPELLS,
  SPELL_CONJURE_TICKS,
  SPELL_INFO,
  SPELLS,
  spellClipSeconds,
  THRUST_WALL_DISTANCE,
  THRUST_WALL_HEIGHT,
  wallAhead,
  wallDistance,
  rayDistance,
  PLAYER_REACH,
  attackTiming,
  LEVEL_PREFIX,
  MAIN_QUESTS,
  NPC_VOICES,
  ASM_STATE_NAMES,
  PLAYER_RADIUS,
  LEVEL_UNIT_METRES,
  floorAt,
  stagedPlayerSpot,
  stagedPlayerYaw,
  PORTAL_OBJECT_BASE,
  PORTAL_USE_REACH,
  inPortal,
  doorUseAt,
  ENDING_EXIT,
  DOOR_USE_SLACK,
  MESSAGE_MS,
  inStoryVolume,
  type StoryMessage,
  attackKindFor,
  type AttackKind,
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
  type DoorMotion,
  type MoverMotion,
  type InventoryItemView,
  isManaCrystals,
  type SpellId,
  type CharacterLook,
  type DecalKind,
  type WorldObjectDef,
  type Difficulty,
} from '@crusaders/shared';
import { outfitFor, lookFromInventory, weaponDecal } from './assets/item_models.ts';
import { createRenderContext } from './engine/renderer.ts';
import { CameraRig } from './engine/camera_rig.ts';
import { classicVerticalFov } from './engine/classic_camera.ts';
import { SettingsStore, type Settings } from './settings.ts';
import { SettingsPanel } from './ui/settings_panel.ts';
import { CONTROLS_HELP } from './input/keybindings.ts';
import { buildArenaMeshes } from './entities/arena.ts';
import { ProceduralAvatar, type Avatar, type AvatarKind } from './entities/avatar.ts';
import { LocalPlayer } from './entities/local_player.ts';
import { RemoteEntities, type RemoteEntity } from './entities/remote_entities.ts';
import { loadOriginalAvatars, type HeldOverride } from './assets/original_models.ts';
import { loadOriginalLevel, type OriginalLevel } from './assets/original_level.ts';
import { CREATURE_SFX, SFX, SoundBank, impactSound, pick } from './audio/sound_bank.ts';
import { registerAssetServiceWorker } from './assets/game_files.ts';
import { GameFilesPanel } from './ui/game_files_panel.ts';
import { InputManager } from './input/input_manager.ts';
import { installBrowserGuards } from './input/browser_guards.ts';
import { MusicPlayer } from './audio/music.ts';
import { EFFECTS_SCALE, Effects, SMALL_EFFECTS_SCALE } from './engine/effects.ts';
import { Decals } from './engine/decals.ts';
import { SpellVisuals } from './engine/spell_visuals.ts';
import { Debris } from './engine/debris.ts';
import { SwingTrails } from './engine/swing_trail.ts';
import { ModelLighting } from './engine/model_light.ts';
import { dynamicLights } from './engine/dynamic_lights.ts';
import { Foliage } from './engine/foliage.ts';
import { propShadows } from './engine/prop_shadows.ts';
import { propFixes } from './assets/prop_fixes.ts';
import { PostFx } from './engine/post_fx.ts';
import { TORCH_LIGHT_COLOR, TORCH_LIGHT_HEIGHT, TORCH_LIGHT_INTENSITY, TORCH_DYNAMIC_INTENSITY } from './entities/torch_light.ts';
import { connectToWorld } from './network/connect.ts';
import { CombatUi } from './ui/combat_ui.ts';
import { Hud } from './ui/hud.ts';
import { ClassicHud } from './ui/classic_hud.ts';
import { InventoryPanels, type InventoryPanelKind } from './ui/inventory_panels.ts';
import { Hotbar, hotbarItemEntry, type HotbarEntry } from './ui/hotbar.ts';
import { ChatWindow } from './ui/chat.ts';
import { logout } from './frontend/api.ts';
import { CHARACTER_SCREEN_FLAG, runFrontEnd } from './frontend/front_end.ts';
import { TitleScene } from './frontend/title_scene.ts';
import { QuestBook, loadGameStrings } from './ui/quest_book.ts';
import { CharacterSheet } from './ui/character_sheet.ts';
import { Cutscene, type Puppet } from './story/cutscene.ts';
import { NecrosDeath } from './story/necros_death.ts';

const MAX_FRAME_MS = 250;

/** Enhanced lighting (not original): wall torches, the player's Torch Light, sparks. */
const LEVEL_TORCH_KEY = 'level-torch:';
const LEVEL_TORCH_COLOR = 0xff9a40;
const LEVEL_TORCH_INTENSITY = 1.2;
const LEVEL_TORCH_RADIUS = 8;
const MY_TORCH_KEY = 'torch:me';
const SPARK_LIGHT_COLOR = 0xffc070;
const EVIL_LIGHT_COLOR = 0x60ff50;
const SPARK_LIGHT_INTENSITY = 2.5;
const SPARK_LIGHT_RADIUS = 3;
const SPARK_LIGHT_SECONDS = 0.18;
/** A stopped blow's light (0x44D290 → 0x44BEA0: grey 150 / 255, fading over 300 ms). */
const BLOCK_LIGHT_COLOR = new THREE.Color(150 / 255, 150 / 255, 150 / 255);
const BLOCK_LIGHT_SECONDS = 0.3;
/** Its sparks: SWORD_DAMAGE + SWORD_METAL this many times (1 at low detail), 0.8 ft apart along the sweep. */
const BLOCK_SPARK_PAIRS = 3;
const BLOCK_SPARK_SPACING = 0.8 * LEVEL_UNIT_METRES;
/** A blow on a prop: its sparks 0.7 ft apart along the sweep (0x44CEF0, constant 0x4E0904). */
const PROP_SPARK_SPACING = 0.7 * LEVEL_UNIT_METRES;
/** Height above the attacker's feet where his blade meets a prop (stand-in for the contact point). */
const PROP_HIT_HEIGHT = 1.0;

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
  installBrowserGuards();

  // Original assets: imported in this browser (service worker over Cache Storage) or dev server.
  await registerAssetServiceWorker();
  const gameFiles = new GameFilesPanel(document.getElementById('game-files')!);
  /** In the world, the game files panel (re-import) shows only with the options menu. */
  let inWorld = false;
  let optionsOpen = false;
  // Before the world the front end shows it (Game files); in the world, with the options.
  void gameFiles.init().then(() => {
    if (inWorld) gameFiles.visible = optionsOpen;
  });
  const [rapier, originals, sounds, gameStrings, assetManifest] = await Promise.all([
    initPhysics(), loadOriginalAvatars(), SoundBank.load(), loadGameStrings(),
    fetch('/generated/manifest.json').then((r) => (r.ok ? (r.json() as Promise<{ textures?: Record<string, string> }>) : null)).catch(() => null),
  ]);
  const { renderer, scene } = createRenderContext(container);
  // Enhanced lighting's HDR, bloom and tone mapping (off: drawn straight to the screen).
  const postFx = new PostFx(renderer, scene);
  const remotes = new RemoteEntities(scene, originals);
  /**
   * Creatures only a sequence plays (arena.puppets, e.g. Ws9a's cell guards): not the server's,
   * shown here when this player's sequence casts them and left where it ends (dead) until the
   * act is left; the trigger never fires again for this character.
   */
  const scenePuppets = new Map<number, Puppet>();
  const clearScenePuppets = () => {
    for (const [placement, p] of scenePuppets) {
      scene.remove(p.object);
      lighting.forget(`puppet:${placement}`);
      p.avatar.dispose();
    }
    scenePuppets.clear();
  };
  const scenePuppet = (placement: number): Puppet | null => {
    const known = scenePuppets.get(placement);
    if (known) return known;
    const def = levelView?.arena.puppets?.find((q) => q.placement === placement);
    if (!def) return null;
    const kind = def.archetype as AvatarKind;
    const avatar = originals?.(kind, placementLooks.get(placement)?.held) ?? new ProceduralAvatar(kind);
    const scale = placementLooks.get(placement)?.scale;
    if (scale) avatar.setScale?.(scale);
    avatar.object.position.set(def.x, def.y, def.z);
    avatar.object.rotation.y = def.yaw ?? 0;
    avatar.setState(ANIM.IDLE, 0);
    scene.add(avatar.object);
    lighting.track(`puppet:${placement}`, avatar.object, PLAYER_RADIUS * 1.3, false, true);
    const p: Puppet = { object: avatar.object, avatar, name: MOB_ARCHETYPES[def.archetype]?.name ?? '', archetype: def.archetype };
    scenePuppets.set(placement, p);
    return p;
  };
  const combatUi = new CombatUi(document.getElementById('world-ui')!);
  const classicHud = new ClassicHud(document.getElementById('classic-hud')!, assetManifest?.textures ?? {});
  const hud = new Hud(document.getElementById('hud')!, document.getElementById('player-panel')!, classicHud, document.getElementById('death')!);
  const inventoryPanel = new InventoryPanels(document.getElementById('inventory')!);
  const hotbar = new Hotbar(document.getElementById('hotbar')!);
  inventoryPanel.hotbar = hotbar;
  /** Text chat (online only): Local, Global, Server and Private tabs. */
  const chat = new ChatWindow(document.getElementById('chat')!);
  const questBook = new QuestBook(document.getElementById('quest-book')!, assetManifest?.textures ?? {});
  questBook.setStrings(gameStrings);
  const charSheet = new CharacterSheet(document.getElementById('char-sheet')!, assetManifest?.textures ?? {});
  charSheet.setStrings(gameStrings);
  // Scripted sequences (cutscenes): played here, the server waits for the end (CS_CUTSCENE_DONE).
  let cutscene: Cutscene | null = null;
  /** Necros's death timeline (SC_ENDING): the view until the ending act loads. */
  let ending: NecrosDeath | null = null;
  /** A scripted view is playing: the keys and the game's windows wait. */
  const inScene = () => !!cutscene || !!ending;
  /** The view flying back behind Drake after a sequence (OUTRO_SECONDS). */
  let outro: { camera: THREE.PerspectiveCamera; from: THREE.Vector3; fromQ: THREE.Quaternion; fromFov: number; t: number } | null = null;
  const OUTRO_SECONDS = 1.5;
  /** Snapshot count at the latest world entry, while the screen waits black for an opening sequence. */
  let entryFade: number | null = null;
  const cutsceneUi = document.getElementById('cutscene')!;
  // Cinema bars over a sequence (not the original's): each CINEMA_BAR of the screen's height, the
  // camera widened so the original's whole view fits between them.
  const CINEMA_BAR = 0.06;
  for (const bar of cutsceneUi.querySelectorAll<HTMLElement>('.bar')) bar.style.height = `${CINEMA_BAR * 100}vh`;
  const cinemaFov = (cam: THREE.PerspectiveCamera) => {
    cam.aspect = container.clientWidth / container.clientHeight;
    cam.fov = classicVerticalFov(cam.aspect, 1 - 2 * CINEMA_BAR);
    cam.updateProjectionMatrix();
  };
  const fadeEl = document.getElementById('fade')!;
  const fade = (out: boolean, ms: number, colour = '#000') => {
    fadeEl.style.background = colour;
    fadeEl.style.transition = ms > 0 ? `opacity ${ms}ms linear` : 'none';
    fadeEl.style.opacity = out ? '1' : '0';
    // Commit it now: an instant fade and a timed one started in the same frame (Ws9a's opening:
    // black, then 1.5 s back in) would otherwise merge, and the timed one start from clear.
    void fadeEl.offsetWidth;
  };
  /** Starts a sequence of the current level (SC_CUTSCENE); set up once the local player exists. */
  let playCutscene: (name: string, actors: (number | null)[]) => void = (name) => session?.cutsceneDone(name);
  /** Starts / ends Necros's death timeline (SC_ENDING; ended by the next world entry). */
  let startEnding: (at: { x: number; y: number; z: number }, yaw: number) => void = () => { };
  let endEnding: () => void = () => { };

  // Before anything that loads asynchronously reads it (the effects below).
  const settings = new SettingsStore();
  propFixes.enabled = settings.current.fixedPropUvs;
  settings.onChange((s) => (propFixes.enabled = s.fixedPropUvs));
  const applyHud = (s: Settings) => {
    hud.style = s.hudStyle;
    hud.showStats = s.showStats;
  };
  applyHud(settings.current);
  settings.onChange(applyHud);
  /** The level act's music (the original's CD tracks, looped). */
  const music = new MusicPlayer(settings.current.musicVolume);
  settings.onChange((s) => (music.volume = s.musicVolume));
  new SettingsPanel(document.getElementById('settings')!, settings);
  document.getElementById('controls-help')!.textContent = CONTROLS_HELP;

  // Login, server and character screens over the Citadel hall, then the world.
  // Online: the session predicts and reconciles. Offline: plain local simulation.
  const title = await TitleScene.create(renderer, settings, originals);
  if (import.meta.env.DEV) (window as unknown as { __title: TitleScene }).__title = title;
  const resumeButton = document.getElementById('btn-resume')!;
  const auth = await runFrontEnd({
    title,
    music,
    gameFiles,
    openOptions: (onClose) => {
      resumeButton.textContent = 'Close';
      overlay.classList.remove('hidden');
      const close = () => {
        overlay.classList.add('hidden');
        resumeButton.textContent = 'Resume';
        resumeButton.removeEventListener('click', close);
        overlay.removeEventListener('click', outside);
        window.removeEventListener('keydown', escKey, true);
        onClose();
      };
      const outside = (e: MouseEvent) => {
        if (e.target === overlay) close();
      };
      const escKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        close();
      };
      resumeButton.addEventListener('click', close);
      overlay.addEventListener('click', outside);
      window.addEventListener('keydown', escKey, true);
    },
  });
  title.dispose();

  // Zones: online, the server announces the arena on login and on every portal transition
  // (SC_ZONE_CHANGE); offline it is ?level=<act> or the synthetic arena. Original levels come
  // from the player's own game files.
  const errorBox = document.getElementById('error')!;
  let arena: ArenaDef = createSyntheticArena();
  let levelView = null as OriginalLevel | null;
  // Message triggers of this level: fired once-only ones (0x200), and the walk-in ones the player is in.
  const messagesDone = new Set<number>();
  const messagesInside = new Set<number>();
  let arenaObject: THREE.Object3D | null = null;
  /** Loads an arena into the scene, replacing the previous one. Null if it cannot be shown. */
  // Characters, props and items lit by the floor under them, with blob shadows.
  const lighting = new ModelLighting(scene);
  const lightingKeys = new Set<unknown>();
  /** Marks on the level's faces: weapons striking walls, scorches, frost (the original's decals). */
  let decals: Decals | null = null;
  void Decals.load(scene).then((d) => {
    decals = d;
    d?.setLevel(levelView?.light ?? null);
  });
  const PROP_KEY = 'prop:';
  /** Placed objects at least this tall cast object shadows (metres; a barrel is about 1). */
  const SHADOW_CASTER_HEIGHT = 0.5;
  /**
   * What each placed creature holds (the cap's inventory header: Captain Ursan nothing, a skeleton
   * its own weapon) and the gesture it talks with, by placement; their models are loaded first.
   */
  const placementLooks = new Map<number, { held?: HeldOverride; talkState?: string; scale?: number }>();
  remotes.placementLook = (placement) => placementLooks.get(placement);
  const loadPlacementLooks = async (def: ArenaDef) => {
    placementLooks.clear();
    const files = new Set<string>();
    for (const sp of [...def.mobSpawns, ...(def.puppets ?? [])]) {
      if (sp.placement === undefined) continue;
      const look: { held?: HeldOverride; talkState?: string; scale?: number } = {};
      if ('scale' in sp && sp.scale !== undefined) look.scale = sp.scale;
      if (sp.weapon !== undefined || sp.shield !== undefined) {
        const outfit = await outfitFor({ ...(sp.weapon ? { weapon: sp.weapon } : {}), ...(sp.shield ? { shield: sp.shield } : {}) });
        look.held = { right: outfit.right ?? null, left: outfit.left ?? null };
        if (outfit.right) files.add(outfit.right);
        if (outfit.left) files.add(outfit.left);
      }
      const gesture = 'gesture' in sp && sp.gesture !== undefined ? ASM_STATE_NAMES[sp.gesture] : undefined;
      if (gesture) look.talkState = gesture;
      placementLooks.set(sp.placement, look);
    }
    await originals?.preload?.([...files]);
  };
  /** Line of sight through the level's collision mesh, for culling foliage hidden behind it. */
  const foliageDir = { x: 0, y: 0, z: 0 };
  const foliageBlocked = (from: THREE.Vector3, to: THREE.Vector3): boolean => {
    const world = session?.mw ?? mw;
    if (!world) return false;
    const len = from.distanceTo(to);
    if (len < 0.5) return false;
    foliageDir.x = (to.x - from.x) / len;
    foliageDir.y = (to.y - from.y) / len;
    foliageDir.z = (to.z - from.z) / len;
    return rayDistance(world, from, foliageDir, len - 0.35) !== null;
  };
  const foliageAmounts = (s: Settings) => ({ grass: s.foliageGrass, bushes: s.foliageBushes, plants: s.foliagePlants });
  /** Grass and bushes (the foliage setting), grown for the level shown. */
  let foliage: Foliage | null = null;
  let foliageFor: OriginalLevel | null = null;
  const refreshFoliage = () => {
    const want = settings.current.foliage ? levelView : null;
    if (want === foliageFor) return;
    foliage?.dispose();
    foliage = null;
    propShadows.setSource(null);
    foliageFor = want;
    if (!want) return;
    void Foliage.build(want.foliageGround()).then((f) => {
      if (foliageFor !== want) return void f?.dispose();
      foliage = f;
      propShadows.setSource(f);
      f?.setDistance(settings.current.foliageDistance);
      f?.setAmounts(foliageAmounts(settings.current));
      if (f) want.object.add(f.object);
    });
  };
  settings.onChange((s) => {
    refreshFoliage();
    foliage?.setDistance(s.foliageDistance);
    foliage?.setAmounts(foliageAmounts(s));
  });
  const showArena = async (name: string, difficulty: Difficulty = 'medium'): Promise<ArenaDef | null> => {
    let next: ArenaDef;
    let view: OriginalLevel | null = null;
    if (name.startsWith(LEVEL_PREFIX)) {
      try {
        view = await loadOriginalLevel(name, difficulty);
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
    refreshFoliage();
    await loadPlacementLooks(next);
    messagesDone.clear();
    messagesInside.clear();
    lighting.setLevel(view?.light ?? null);
    decals?.setLevel(view?.light ?? null);
    // Enhanced lighting: the level's wall torches light the stone around them.
    dynamicLights.removePrefix(LEVEL_TORCH_KEY);
    view?.torches.forEach((p, i) => dynamicLights.set(`${LEVEL_TORCH_KEY}${i}`, p, LEVEL_TORCH_COLOR, LEVEL_TORCH_INTENSITY, LEVEL_TORCH_RADIUS, 0.15));
    for (const k of [...lightingKeys]) if (typeof k === 'string' && k.startsWith(PROP_KEY)) (lighting.forget(k), lightingKeys.delete(k));
    const casters: THREE.Object3D[] = [];
    for (const [id, v] of view?.objects ?? []) {
      const size = new THREE.Box3().setFromObject(v.object).getSize(new THREE.Vector3());
      const key = `${PROP_KEY}${id}`;
      lighting.track(key, v.object, v.def.kind === 'item' ? 0.25 : Math.min(1.5, Math.max(size.x, size.z) * 0.55), true);
      lightingKeys.add(key);
      // Object shadows: the placed things of some size (barrels, trees, crates...), not ground items.
      if (v.def.kind !== 'item' && size.y >= SHADOW_CASTER_HEIGHT) casters.push(v.object);
    }
    propShadows.setLevel(casters, view?.foliageGround().meshes ?? []);
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
  void Effects.load(scene).then((e) => {
    effects = e;
    if (e) e.scale = settings.current.smallEffects ? SMALL_EFFECTS_SCALE : EFFECTS_SCALE;
  });
  let debris: Debris | null = null;
  const trails = new SwingTrails(scene);
  void Debris.load(scene).then((d) => (debris = d));
  const fxPos = new THREE.Vector3();
  /** Pending wall-spark checks of the local swings (seconds to the impact frame, heading). */
  const wallChecks: { t: number; yaw: number }[] = [];
  /** The local blade's tip this frame and the last (its sweep orients a wall mark). */
  const bladeTip = new THREE.Vector3();
  const bladeTipBefore = new THREE.Vector3();
  const bladeBase = new THREE.Vector3();
  let bladeSeen = false;
  const fxDir = new THREE.Vector3();
  /** Spawns `count` copies of an effect along a short line from `at` (the engine spaces them ~0.2 m apart). */
  const fxBurst = (name: string, count: number, at: THREE.Vector3, step: THREE.Vector3, dir: THREE.Vector3 | null = null) => {
    for (let i = 0; i < count; i++) effects?.spawn(name, fxPos.copy(at).addScaledVector(step, i), dir);
  };
  /** Spells cast near the player (SC.SPELL_EVENT): effects, projectiles, bolts, bursts, timed effects. */
  const spellVisuals = new SpellVisuals(scene, {
    effects: () => effects,
    sounds: () => sounds,
    entity: (id) => {
      if (live && id === live.entityId && player) return { object: player.object, avatar: player.avatar };
      const e = remotes.byId.get(id);
      return e ? { object: e.avatar.object, avatar: e.avatar } : null;
    },
    self: () => live?.entityId ?? null,
    setRate: (id, rate) => {
      if (rate === 1) remotes.rates.delete(id);
      else remotes.rates.set(id, rate);
    },
  });
  /** The local player's Torch Light (radius from the server's stats). */
  const myTorch = new THREE.PointLight(TORCH_LIGHT_COLOR, TORCH_LIGHT_INTENSITY, 1, 1.4);
  myTorch.visible = false;
  scene.add(myTorch);
  /** Edge of the local player's weapon, for impact sounds (stronger of slash / bash). */
  let myEdge: 'sharp' | 'blunt' = 'blunt';
  /** The mark the local player's weapon leaves on a wall (items.ctx `Decal`). */
  let myDecal: DecalKind | null = null;
  /** Set as soon as the session exists: zone / enter events fire before connectToWorld resolves. */
  let live: ClientSession | null = null;
  /** Heading of the latest world entry, applied to the view once the input exists. */
  let enterYaw: number | null = null;
  const session: ClientSession | null =
    auth.kind === 'offline'
      ? null
      : await connectToWorld(rapier, arena, auth.kind, auth.kind === 'account' ? auth.characterId : null, {
          spawn: (id, _name, info) => {
            remotes.spawn(id, info);
            const e = remotes.byId.get(id);
            if (e) lighting.track(id, e.avatar.object, PLAYER_RADIUS * 1.3, false, true);
            if (info.statuses?.length) spellVisuals.syncStatuses(id, info.statuses);
          },
          spell: (d) => {
            spellVisuals.handle(d);
            for (const k of d.decals ?? []) decals?.stamp(k.kind, new THREE.Vector3(...k.at));
          },
          despawn: (id) => {
            spellVisuals.forget(id);
            remotes.despawn(id);
            trails.forget(id);
            lighting.forget(id);
          },
          correction: (dx, dy, dz) => player?.correct(dx, dy, dz),
          stats: (s) => {
            hud.stats(s);
            charSheet.update(s);
            if (live) spellVisuals.syncStatuses(live.entityId, (s.statuses ?? []).map((x) => x.tag));
            inventoryPanel.setGold(s.gold);
            inventoryPanel.setSpells(s);
            hotbar.setStats(s);
            myTorch.distance = s.light;
            myTorch.visible = s.light > 0;
            if (!myTorch.visible) dynamicLights.remove(MY_TORCH_KEY);
            if (player) player.dead = s.dead;
            if (player && s.speed) {
              player.clipRate = s.speed;
              player.avatar.clipRate = s.speed;
            }
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
            if (from && avatar?.react && !e.blocked && !e.killed && e.damage > 0) avatar.react(impactSide(obj, from), e.impact);
            if (e.rush) {
              // A shield rush's contact roll: DDam01 and HitMetal01 at the rusher (0x493F20). The
              // rush's own 1 HP cost (target = the rusher) has no sound of its own.
              if (e.attacker === e.target || !from) return;
              for (const id of SFX.rushContact) sounds?.play(id, from.position);
              // The victim is pushed away from the rusher, so its impact is the other way round
              // (0x4273F0 reads the push: met from the front, IMPACT_BACK).
              if (e.reel && target?.info.kind === 'mob' && avatar?.react) avatar.react([3, 1, 2, 0][impactSide(obj, from)]!);
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
                // 0x44D290: pairs of SWORD_DAMAGE + SWORD_METAL spaced along the attacker's blade sweep, a grey light.
                dynamicLights.flash(at, BLOCK_LIGHT_COLOR, SPARK_LIGHT_INTENSITY, SPARK_LIGHT_RADIUS, BLOCK_LIGHT_SECONDS);
                const along = e.sweep ? new THREE.Vector3(e.sweep[0], 0, e.sweep[1]).multiplyScalar(BLOCK_SPARK_SPACING) : step;
                for (let i = 0; i < BLOCK_SPARK_PAIRS; i++) {
                  fxPos.copy(at).addScaledVector(along, i);
                  effects.spawn('SWORD_DAMAGE', fxPos, null);
                  effects.spawn('SWORD_METAL', fxPos, null);
                }
              } else if (e.damage > 0) {
                const bone = !isMe && CREATURE_SFX[target?.info.archetype ?? '']?.material === 'bone';
                // Undead blows carry dark damage: the original adds its green flame on the victim.
                const undeadAttacker = !mine && CREATURE_SFX[remotes.byId.get(e.attacker)?.info.archetype ?? '']?.material === 'bone';
                if (undeadAttacker) {
                  effects.spawn('FIREBALL_PROJ_EVIL_SPAWN', at);
                  dynamicLights.flash(at, EVIL_LIGHT_COLOR, SPARK_LIGHT_INTENSITY, SPARK_LIGHT_RADIUS, 0.4);
                }
                if (bone) {
                  // The victim also sheds 5 chips in its own texture (debris spawner 0x43E310:
                  // ±1.2 ft about the hit, speed 40), small, so gone after 1.5 s.
                  const chip = 1.2 * LEVEL_UNIT_METRES;
                  const light = new THREE.Color(0.8, 0.8, 0.8);
                  levelView?.light?.sample(obj.position, light);
                  debris?.spawn(obj, 5, new THREE.Vector3(chip, chip, chip), at, 40, obj.position.y, light);
                  fxBurst('BONE', 3 + Math.floor(Math.random() * 5), at, step.clone().multiplyScalar(-1));
                }
                else {
                  // Living victims: the chips are blood (texture BLOODHIT, ±0.2 ft, speed 40).
                  const blood = debris?.texture('bloodhit');
                  if (blood) {
                    const r = 0.2 * LEVEL_UNIT_METRES;
                    debris?.spawn(blood, 5, new THREE.Vector3(r, r, r), at, 40, obj.position.y);
                  }
                  fxBurst('BLOOD', 2 + Math.floor(Math.random() * 2), at, step.clone().multiplyScalar(-1));
                }
              }
            }
            // Original impact / cry sounds (executable sound tables, Sound.ctx ids).
            if (sounds) {
              if (e.blocked) {
                // 0x44D290, at the attacker: the metal row by the attacker's edge, Drake's shield
                // too (he is type 142, block material 2; captured 339 / 340 / 341 off long swords).
                sounds.play(impactSound(SFX.impact.metal[e.sharp ? 'sharp' : 'blunt']), from?.position ?? headPos);
              } else if (isMe) {
                // Drake's own impact material is flesh (row 142), by the attacker's edge.
                sounds.play(impactSound(SFX.impact.flesh[e.sharp ? 'sharp' : 'blunt']), headPos);
                sounds.play(pick(e.killed ? SFX.drakeDeath : SFX.drakeDamage), headPos);
              } else if (target) {
                const sfx = CREATURE_SFX[target.info.archetype ?? ''];
                sounds.play(impactSound(SFX.impact[sfx?.material ?? 'flesh'][e.sharp ?? (mine ? myEdge === 'sharp' : true) ? 'sharp' : 'blunt']), headPos);
                if (sfx) sounds.play(e.killed ? sfx.death : sfx.damage, headPos);
              }
            }
          },
          objects: (d) => {
            for (const o of d.objects as { id: number; state: 'present' | 'gone' | 'open'; def?: WorldObjectDef; by?: number; loot?: string[]; damage?: number; sweep?: [number, number]; swing?: DoorMotion; mover?: MoverMotion }[]) {
              if (o.def && !levelView?.objects.has(o.id) && o.state === 'present') {
                levelView?.spawnDynamicObject(o.def);
              }
              const view = levelView?.objects.get(o.id);
              levelView?.setObjectState(o.id, o.state, o.swing ?? null, o.mover ?? null);
              // Someone else opening a door: its sound (our own plays on the key press).
              if (!d.full && o.swing?.phase === 'opening' && o.by !== undefined && o.by !== session?.entityId) doorSounds(o.id);
              if (!view || d.full) continue;
              const mine = session !== null && o.by === session.entityId;
              const at = view.position;
              if (view.def.kind === 'chest' && o.state === 'open') sounds?.play(SFX.chestOpen, at);
              else if (view.def.kind === 'item' && o.state === 'gone' && mine) sounds?.play(SFX.click);
              else if (view.def.kind === 'prop') {
                // As logged on barrels and decompiled (0x44CEF0): every hit throws 5 SWORD_STONE
                // sparks from the blade's contact point, 0.7 ft apart along its sweep (0x4E0904),
                // and 5 chips of the prop about that point (±1.2 ft, speed 40), and plays its
                // material's impact (306, the sharp flesh one, on a barrel; a mace's blunt one by
                // the same table); breaking it (0x4514E0) adds 3-12 pieces in a box of the prop's
                // extents about its origin (logged on a barrel: 3.77 × 4.67 × 3.77 ft about its
                // base, speed 1) and no sound of its own, only a piece landing (339, ~0.3 s later).
                const box = new THREE.Box3().setFromObject(view.object);
                const size = box.getSize(new THREE.Vector3());
                // Contact: the prop's box point nearest the attacker, at the height of his blade.
                const by = o.by === undefined ? undefined : mine ? player?.object : remotes.byId.get(o.by)?.avatar.object;
                const contact = box.getCenter(new THREE.Vector3());
                if (by) contact.set(by.position.x, by.position.y + PROP_HIT_HEIGHT, by.position.z).clamp(box.min, box.max);
                const along = o.sweep ? new THREE.Vector3(o.sweep[0], 0, o.sweep[1]).multiplyScalar(PROP_SPARK_SPACING) : new THREE.Vector3(0, -0.2, 0);
                fxBurst('SWORD_STONE', 5, contact, along, new THREE.Vector3(0, 1, 0));
                const chip = 1.2 * LEVEL_UNIT_METRES;
                const light = new THREE.Color(0.8, 0.8, 0.8);
                levelView?.light?.sample(contact, light);
                debris?.spawn(view.object, 5, new THREE.Vector3(chip, chip, chip), contact, 40, box.min.y, light);
                sounds?.play(SFX.hitOther, contact);
                if (o.state === 'gone') {
                  const base = view.position.clone();
                  debris?.spawn(view.object, 3 + Math.floor(Math.random() * 10), size, base, 1, box.min.y, light);
                  window.setTimeout(() => sounds?.play(SFX.debrisLand, base), 300);
                }
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
            hotbar.setInventory(inv.items);
            player?.setWeaponSpeed(inv.weaponSpeed);
            const w = inv.items.find((i) => i.type === 'weapon' && i.equipped);
            myEdge = w?.damage && w.damage[0]! > w.damage[1]! ? 'sharp' : 'blunt';
            void weaponDecal(w?.itemId).then((k) => (myDecal = k));
            void updatePlayerOutfit(inv.items);
          },
          zone: (name, difficulty) => {
            // Portal transitions (and the first entry): swap the level, then tell the server.
            errorBox.textContent = `Entering ${name.replace(LEVEL_PREFIX, '').toUpperCase()}…`;
            for (const id of remotes.byId.keys()) (lighting.forget(id), trails.forget(id));
            spellVisuals.clear();
            remotes.clear();
            clearScenePuppets();
            void showArena(name, difficulty).then((next) => {
              if (!next || !live) return;
              live.setArena(next);
              live.zoneReady(name);
            });
          },
          enter: (d) => {
            errorBox.textContent = '';
            enterYaw = d.yaw ?? null;
            // From black: an act's opening sequence (the server sends it on its first tick, before
            // that tick's snapshot) takes the fade over; otherwise the world fades in.
            endEnding();
            fade(true, 0);
            entryFade = live?.stats.snapshots ?? 0;
            outro = null;
            if (!live || !player) return; // first entry: the player is created below
            if (enterYaw !== null) input.yaw = enterYaw;
            player.character = live.character!;
            player.features = live.features;
            chase.mw = live.mw;
            chase.snap();
            for (const [id, state] of live.objectStates) levelView?.setObjectState(id, state, live.swings.get(id)?.motion ?? null, live.movers.get(id)?.motion ?? null);
          },
          cutscene: (d) => {
            // The server ran out of time for it (this page played it slowly): it is over here too.
            if (d.end) {
              if (cutscene?.sequence.name === d.sequence) endCutscene();
              return;
            }
            playCutscene(d.sequence, d.actors);
          },
          fade: (id, seconds) => remotes.fade(id, seconds),
          ending: (d) => startEnding(d.at, d.yaw),
          // A message trigger a relay or a death fired for this player (signs and hints are local).
          storyMessage: (id) => {
            const m = levelView?.arena.story?.messages?.find((x) => x.id === id);
            if (m) showMessage(m);
          },
          // A shop (cap type 0x1C): its offer beside the inventory; on opening, the merchant's line.
          shop: (d) => {
            shopAt = d.shop;
            inventoryPanel.openShop(d);
            const line = d.greeting !== undefined ? sounds?.lines.get(d.greeting) : undefined;
            if (d.greeting !== undefined) sounds?.play(d.greeting, local.object.position, { volume: 1 });
            if (line) showSubtitle(null, line.text, line.ms);
          },
          // A relay's sound trigger (gates opened by a lever, Ursan's cell door).
          storySound: (d) => {
            for (const [x, y, z] of d.positions) sounds?.play(d.sound, new THREE.Vector3(x, y, z), { volume: d.volume });
            // A spoken line (a guard's "Celestia is expecting you", Drake's remarks): its text too.
            const line = sounds?.lines.get(d.sound);
            if (line) showSubtitle(null, line.text, line.ms);
          },
          quests: (d) => {
            questBook.update(d.log);
            if (!d.news || !player) return;
            const s = (id: number) => gameStrings.get(id) ?? '';
            const lines = [
              ...d.news.assigned.map((i) => `New quest: ${s(MAIN_QUESTS[i]?.title ?? 0)}`),
              ...d.news.completed.map((i) => `Quest completed: ${s(MAIN_QUESTS[i]?.title ?? 0)}`),
              ...(d.news.journal.length ? ['Journal updated (F2)'] : []),
            ];
            headPos.copy(player.object.position);
            headPos.y += player.avatar.headHeight + 0.4;
            lines.forEach((l, i) => window.setTimeout(() => combatUi.notice(l, headPos), i * 900));
            sounds?.play(SFX.turnPage);
          },
          chat: (d) => chat.add(d),
          error: (_code, message) => {
            chat.notice(message, 'error');
            if (!player) return;
            headPos.copy(player.object.position);
            headPos.y += player.avatar.headHeight;
            combatUi.notice(message, headPos);
          },
          close: (code, reason) => {
            document.getElementById('error')!.textContent = `Disconnected from server (${code}${reason ? `: ${reason}` : ''}). Reload to reconnect.`;
          },
        }, (created) => (live = created));
  let currentLook: CharacterLook = session?.inventory
    ? lookFromInventory(session.inventory.items)
    : auth.kind === 'account' && auth.look
      ? auth.look
      : { weapon: 'long_sword', shield: 'wooden_shield' };
  void weaponDecal(currentLook.weapon).then((k) => (myDecal ??= k));
  let dressToken = 0;
  let pendingOutfitItems: readonly InventoryItemView[] | null = null;
  const updatePlayerOutfit = async (items: readonly InventoryItemView[]) => {
    if (!originals?.dressed || !player) return;
    const look = lookFromInventory(items);
    if (look.weapon === currentLook.weapon && look.shield === currentLook.shield && look.armor === currentLook.armor) {
      return;
    }
    if (cutscene) {
      pendingOutfitItems = items;
      return;
    }
    const token = ++dressToken;
    const outfit = await outfitFor(look);
    const dressed = await originals.dressed(outfit);
    if (!dressed || token !== dressToken || !player) {
      dressed?.dispose();
      return;
    }
    if (cutscene) {
      pendingOutfitItems = items;
      dressed.dispose();
      return;
    }
    currentLook = look;
    player.setAvatar(dressed);
    delete (player.object.userData as Record<string, unknown>)['unlit'];
    lighting.forget('me');
    lighting.track('me', player.object, PLAYER_RADIUS * 1.3, false, true);
    lighting.playerKey = 'me';
  };

  const initialOutfit = await outfitFor(currentLook);
  const selfAvatar = (await originals?.dressed?.(initialOutfit)) ?? originals?.('self') ?? new ProceduralAvatar('self');
  if (session) selfAvatar.seed = session.entityId;
  let mw: MovementWorld;
  if (session) {
    mw = session.mw;
    player = new LocalPlayer(session.character!, selfAvatar, (f) => session.tick(f));
    player.features = session.features;
    if (session.playerStats?.speed) {
      player.clipRate = session.playerStats.speed;
      (selfAvatar as Avatar).clipRate = session.playerStats.speed;
    }
    if (session.playerStats) {
      hud.stats(session.playerStats);
      inventoryPanel.setSpells(session.playerStats);
      hotbar.setStats(session.playerStats);
      lastStats = { level: session.playerStats.level, dead: session.playerStats.dead };
    }
    for (const [id, state] of session.objectStates) levelView?.setObjectState(id, state, session.swings.get(id)?.motion ?? null, session.movers.get(id)?.motion ?? null);
    if (session.inventory) {
      inventoryPanel.update(session.inventory);
      hotbar.setInventory(session.inventory.items);
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
  playCutscene = (name, actors) => {
    const sequence = levelView?.arena.story?.sequences.find((q) => q.name === name);
    if (!session || !sequence || !levelView?.arena.story || cutscene) {
      session?.cutsceneDone(name);
      return;
    }
    // The stand-in starts from a stand: what the keys were doing (running, a raised shield, a
    // swing) ends here, or its clip loops on (footsteps and all) under the sequence's own.
    local.avatar.setShield?.(false);
    local.avatar.setUpperSwing?.(null, 0);
    local.avatar.setState(ANIM.IDLE, 0);
    // Staged (not original): Drake stands where the sequence is framed for him, as the server puts him.
    const spot = stagedPlayerSpot(sequence);
    if (spot) {
      const x = spot[0] * LEVEL_UNIT_METRES, z = spot[2] * LEVEL_UNIT_METRES;
      const y = floorAt(levelView.arena, x, z, local.object.position.y);
      if (y !== null) {
        const yaw = stagedPlayerYaw(spot) ?? local.object.rotation.y;
        local.placeAt({ x, y: y + 0.1, z }, yaw);
        local.object.rotation.y = yaw;
        local.object.position.set(x, y + 0.1, z);
      }
    } else {
      // Where the character is: a sequence that starts on the first tick of an act (Cs5b's Seq24,
      // Ws9a's opening) comes before any frame has drawn him, his object still at the origin.
      const at = local.character.position;
      if (local.object.position.distanceTo(new THREE.Vector3(at.x, at.y, at.z)) > 0.5) {
        local.object.position.set(at.x, at.y, at.z);
        local.object.rotation.y = input.yaw;
      }
    }
    const standIn: Puppet = {
      object: local.object,
      get avatar() { return local.avatar; },
      name: 'Drake',
    };
    const puppets = new Map<number, Puppet>();
    sequence.actors.forEach((a, i) => {
      const index = i + 2;
      if (a && 'player' in a) puppets.set(index, standIn);
      const id = actors[i];
      const e = id !== null && id !== undefined ? remotes.byId.get(id) : undefined;
      if (e) {
        remotes.scripted.add(e.id);
        puppets.set(index, { object: e.avatar.object, avatar: e.avatar, name: e.info.name, ...(e.info.archetype ? { archetype: e.info.archetype } : {}) });
      } else if (a && 'creature' in a) {
        const own = scenePuppet(a.creature);
        if (own) puppets.set(index, own);
      }
    });
    closeInventoryPanels();
    setQuestBookOpen(false);
    setCharSheetOpen(false);
    hotbar.visible = false;
    chat.visible = false;
    cutsceneUi.hidden = false;
    prompt.hidden = true;
    cutscene = new Cutscene({
      story: levelView.arena.story,
      sequence,
      actor: (i) => puppets.get(i) ?? null,
      creature: (placement) => {
        for (const e of remotes.byId.values()) if (e.info.placement === placement) return { object: e.avatar.object, avatar: e.avatar, name: e.info.name };
        return scenePuppet(placement);
      },
      // The creatures' own cries, as a fight's: struck (impact clips) and killed (death clip).
      animation: (p, state) => {
        const sfx = CREATURE_SFX[p.archetype ?? ''];
        if (!sounds || !sfx) return;
        headPos.copy(p.object.position);
        headPos.y += p.avatar.headHeight;
        if (state === 'ASM_HIT_POINTS_DEPLETED') {
          sounds.play(impactSound(SFX.impact[sfx.material].sharp), headPos);
          sounds.play(sfx.death, headPos);
        } else if (state.startsWith('ASM_IMPACT')) {
          sounds.play(impactSound(SFX.impact[sfx.material].sharp), headPos);
          sounds.play(sfx.damage, headPos);
        }
      },
      useBrush: (name) => levelView?.useBrush(name),
      playerSpot: local.object.position.clone(),
      sounds,
      subtitle: (who, text, ms) => showSubtitle(who, text, ms),
      fade,
    }, chase.camera);
    cinemaFov(cutscene.camera);
  };
  const endCutscene = () => {
    const c = cutscene;
    if (!c) return;
    cutscene = null;
    c.dispose();
    remotes.scripted.clear();
    cutsceneUi.hidden = true;
    hotbar.visible = !!session;
    chat.visible = !!session;
    session?.cutsceneDone(c.sequence.name);
    // Drake stays in this act (no level load): the view flies from the sequence's last camera
    // to its place behind him, facing where the stand-in faces.
    // Exit "end" (the story's last scene) loads nothing: Drake stays (ending.ts).
    const loads = c.sequence.steps.some((st) => {
      const level = st.args['loadlevel'];
      return st.action === 'ScriptedSequenceDone' && !!level && !(typeof level === 'object' && 'exit' in level && level.exit.toLowerCase() === ENDING_EXIT);
    });
    if (!loads) {
      input.yaw = local.object.rotation.y;
      local.placeAt(local.object.position, local.object.rotation.y);
      chase.snap();
      outro = { camera: c.camera, from: c.camera.position.clone(), fromQ: c.camera.quaternion.clone(), fromFov: c.camera.fov, t: 0 };
    }
    // A sequence that faded out comes back once the next act (or the same place) is shown.
    window.setTimeout(() => fade(false, 800), 600);
    if (pendingOutfitItems) {
      const pending = pendingOutfitItems;
      pendingOutfitItems = null;
      void updatePlayerOutfit(pending);
    }
  };
  startEnding = (at, yaw) => {
    if (ending) return;
    if (cutscene) endCutscene();
    closeInventoryPanels();
    setQuestBookOpen(false);
    setCharSheetOpen(false);
    setOptionsOpen(false);
    hotbar.visible = false;
    chat.visible = false;
    cutsceneUi.hidden = false;
    prompt.hidden = true;
    local.avatar.setShield?.(false);
    local.avatar.setUpperSwing?.(null, 0);
    outro = null;
    // 0x0044F7B0's FADE events are white (colour 255, 255, 255).
    ending = new NecrosDeath(chase.camera, at, yaw, (out, ms) => fade(out, ms, '#fff'));
    cinemaFov(ending.camera);
  };
  endEnding = () => {
    if (!ending) return;
    ending = null;
    cutsceneUi.hidden = true;
    hotbar.visible = !!session;
    chat.visible = !!session;
    chase.snap();
  };
  lighting.track('me', local.object, PLAYER_RADIUS * 1.3, false, true);
  lighting.playerKey = 'me';
  scene.add(local.object);

  lighting.silhouettes = settings.current.silhouetteShadows;
  propShadows.enabled = settings.current.objectShadows;
  propShadows.strength = settings.current.objectShadowStrength;
  dynamicLights.enabled = settings.current.enhancedLighting;
  postFx.enabled = settings.current.enhancedLighting;
  settings.onChange((s) => {
    lighting.silhouettes = s.silhouetteShadows;
    propShadows.enabled = s.objectShadows;
    propShadows.strength = s.objectShadowStrength;
    if (dynamicLights.enabled !== s.enhancedLighting) {
      dynamicLights.enabled = s.enhancedLighting;
      postFx.enabled = s.enhancedLighting;
      lighting.resample();
    }
    if (effects) effects.scale = s.smallEffects ? SMALL_EFFECTS_SCALE : EFFECTS_SCALE;
  });
  // Footsteps on the original clips' own LEFT/RIGHT FOOTSTEP events, in step with the animation,
  // with the step sound of the surface underfoot.
  const stepSounds = (): readonly number[] => SFX.footsteps[levelView?.surfaceAt(local.object.position) ?? 'stone'];
  local.avatar.onEvent = (name) => {
    if (!sounds || !name.includes('FOOTSTEP') || !local.character.grounded) return;
    const foot = name.includes('RIGHT') ? 1 : 0;
    sounds.play(stepSounds()[foot]!, local.object.position, { volume: name.includes('SOFT') ? 0.2 : 0.35 });
  };
  chase = new CameraRig(mw, container.clientWidth / container.clientHeight);
  const input = new InputManager(renderer.domElement, settings.current.keybindings);
  if (enterYaw !== null) input.yaw = enterYaw;
  const applySettings = () => {
    const s = settings.current;
    chase.zoom = s.cameraZoom;
    input.sensitivity = s.mouseSensitivity;
    input.invertY = s.invertMouseY;
    input.setBindings(s.keybindings);
    hotbar.setKeys(input.hotbarKeys);
  };
  applySettings();
  settings.onChange(applySettings);
  // Mouse wheel: zoom between the classic camera (closest) and the modern one (farthest).
  renderer.domElement.addEventListener('wheel', (e) => {
    if (!input.locked) return;
    e.preventDefault();
    settings.update({ cameraZoom: Math.round((settings.current.cameraZoom + Math.sign(e.deltaY) * 0.1) * 100) / 100 });
  }, { passive: false });
  /** A swing starting locally: a wall check at its impact frame (sparks off the stone) and its sound. */
  const swingStarted = (kind: AttackKind, yaw: number) => {
    const timing = attackTiming(kind, 1, 1, local.clipRate);
    wallChecks.push({ t: (timing.startup + timing.active / 2) * TICK_DT, yaw });
    sounds?.play(pick(SFX.swing), local.object.position, { volume: 0.7 });
  };
  local.onQueuedSwing = (kind) => swingStarted(kind, input.yaw);
  input.onAttack = () => {
    if (inScene()) return;
    // The movement key held with the click picks the attack (original controls).
    // Holding C (ducked) ignores clicks, as in the original.
    if (input.heldFlags & INPUT.DUCK) return;
    // The Boomer Axe in hand is thrown (BOOMER_THROW), not swung; while it flies Drake punches.
    const held = session?.inventory?.items.find((i) => i.equipped && i.type === 'weapon');
    if (held?.boomer && live && !spellVisuals.axeOut(live.entityId)) {
      if (local.startItemAction(BOOMER_THROW.anim)) session?.attack('normal');
      return;
    }
    let kind = attackKindFor(input.heldFlags, local.character.grounded);
    // A plain click with a wall within 5 ft ahead plays the jab instead (combo routine).
    const feet = local.character.position;
    if (kind === 'normal' && wallAhead(session?.mw ?? mw, feet, input.yaw, THRUST_WALL_DISTANCE, THRUST_WALL_HEIGHT)) kind = 'thrust';
    const started = local.swing(input.yaw, kind);
    if (started === 'queued') session?.attack(kind);
    else if (started) {
      session?.attack(started);
      swingStarted(started, input.yaw);
    }
  };

  // Options menu (Esc): settings, controls, re-import, log out. Playing needs pointer lock:
  // the game takes it back by itself whenever nothing needs the cursor (no "click to play"), or
  // on a key or click if the browser refused; leaving it (Esc) opens the menu, except when the
  // inventory or the quest book released it.
  let releasing = false;
  /** Alt held: the cursor is out for the UI; letting go takes the camera back. */
  let altFree = false;
  let optionsAt = 0;
  input.wantsLock = () => !(altFree || chat.typing || optionsOpen || inventoryPanel.open || questBook.open || charSheet.open || inScene());
  const play = () => {
    sounds?.unlock();
    music.unlock();
    input.requestLock();
  };
  let resetOverlayConfirm = () => {};
  const setOptionsOpen = (open: boolean) => {
    if (open === optionsOpen) return;
    optionsOpen = open;
    resetOverlayConfirm();
    overlay.classList.toggle('hidden', !open);
    gameFiles.visible = open;
    if (open) {
      optionsAt = performance.now();
      closeInventoryPanels();
      setQuestBookOpen(false);
      setCharSheetOpen(false);
      if (input.locked) {
        releasing = true;
        document.exitPointerLock();
      }
    } else play();
  };
  renderer.domElement.addEventListener('click', () => {
    if (!input.locked && !optionsOpen && !inScene()) play();
  });
  document.getElementById('btn-resume')!.addEventListener('click', () => setOptionsOpen(false));
  const isAlt = (e: KeyboardEvent) => (e.code === 'AltLeft' || e.code === 'AltRight') && !input.isBound(e.code);
  window.addEventListener('keydown', (e) => {
    if (!isAlt(e) || e.repeat || !input.locked || inScene()) return;
    altFree = true;
    releasing = true;
    document.exitPointerLock();
  });
  window.addEventListener('keyup', (e) => {
    if (!isAlt(e) || !altFree) return;
    altFree = false;
    // A page that let go of the lock itself may take it back without a click (Pointer Lock 2.0).
    if (!optionsOpen && !chat.typing && !inventoryPanel.open && !questBook.open && !charSheet.open && !inScene()) input.requestLock();
  });
  // The chat line takes the keyboard (Enter): the camera lets go of the pointer, and takes it
  // back without a click when the line closes, unless a window was open before.
  let chatTookLock = false;
  chat.onSend = (channel, text, to) => session?.chat(channel, text, to);
  chat.onTyping = (typing) => {
    if (typing && input.locked) {
      chatTookLock = true;
      releasing = true;
      document.exitPointerLock();
    } else if (!typing && chatTookLock) {
      chatTookLock = false;
      if (!optionsOpen && !inventoryPanel.open && !questBook.open && !charSheet.open && !inScene()) input.requestLock();
    }
  };
  window.addEventListener('blur', () => {
    altFree = false;
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) setOptionsOpen(false);
  });

  // Talking (0x408980): each placed creature has one line of its own (stats +0x1E4), played by
  // the use key from within 12 ft (0x40DEB0); most have none and say nothing. Creatures of
  // synthetic arenas (no placement) keep a speaker of their voice role (Sound.ctx files
  // <speaker>_<role>_nn), every Tab the next line.
  const TALK_RANGE = 12 * 0.3048;
  const subtitle = document.getElementById('subtitle')!;
  let subtitleTimer = 0;
  const showSubtitle = (who: string | null, text: string, ms: number) => {
    subtitle.replaceChildren(...(who ? [Object.assign(document.createElement('span'), { className: 'who', textContent: `${who}:` })] : []), document.createTextNode(text));
    subtitle.hidden = false;
    clearTimeout(subtitleTimer);
    subtitleTimer = window.setTimeout(() => (subtitle.hidden = true), Math.max(2500, ms + 600));
  };
  const talked = new Map<number, number>();
  const npcVoice = (archetype: string): string | null => NPC_VOICES[Number(archetype.slice(4))] ?? null;
  /** A creature's talk line: its placement's own, or (no placement) one of its voice role's; null = none. */
  const talkLine = (e: RemoteEntity): number | null => {
    if (e.info.placement !== undefined && levelView) {
      return levelView.arena.mobSpawns.find((sp) => sp.placement === e.info.placement)?.talk ?? null;
    }
    const role = e.info.archetype ? npcVoice(e.info.archetype) : null;
    const speakers = role && sounds ? sounds.speakers(role) : [];
    if (!speakers.length) return null;
    const lines = speakers[e.id % speakers.length]!;
    return lines[(talked.get(e.id) ?? 0) % lines.length]!;
  };
  /** The shop open for this player (its trigger id), or null. */
  let shopAt: number | null = null;
  /** The shop whose volume the player stands in (use-key trigger, cap type 0x1C), or undefined. */
  const shopHere = () => {
    const p = local.object.position;
    const x = p.x / LEVEL_UNIT_METRES, y = p.y / LEVEL_UNIT_METRES, z = p.z / LEVEL_UNIT_METRES;
    return levelView?.arena.story?.shops?.find((s) => s.activation & 8 && inStoryVolume(s.volume, x, y, z));
  };
  const talk = (entityId: number) => {
    const e = remotes.byId.get(entityId);
    if (!e || !sounds) return;
    const id = talkLine(e);
    if (id === null) return;
    talked.set(entityId, (talked.get(entityId) ?? 0) + 1);
    const line = sounds.lines.get(id);
    if (!line) return;
    sounds.play(id, e.avatar.object.position, { volume: 1 });
    // The creature faces Drake and gestures through the line (server side, seen by everyone).
    session?.talk(entityId, line.ms);
    showSubtitle(e.info.name, line.text, line.ms);
  };

  // Nearest item, chest or door within reach (the server re-checks); Tab picks up / opens.
  const INTERACT_RANGE = 2.3;
  const DOOR_RANGE = 1.6;
  const nearestInteractable = () => {
    if (!levelView || !session) return null;
    let best: { id: number; label: string; d: number; key?: boolean; shop?: boolean } | null = null;
    // In a shop's volume (the merchant's counter): Tab trades.
    const shop = shopHere();
    if (shop) best = { id: shop.id, label: 'Tab — trade', d: 0.5, shop: true };
    const p = local.object.position;
    // Peaceful creatures within reach: Tab talks.
    for (const [id, e] of remotes.byId) {
      if (!e.visible || e.hp <= 0 || !e.info.archetype?.startsWith('npc_') || talkLine(e) === null) continue;
      const q = e.avatar.object.position;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > TALK_RANGE || Math.abs(q.y - p.y) > 2 || (best && best.d < d)) continue;
      best = { id: -id, label: `Tab — talk to ${e.info.name}`, d };
    }
    // Door exits (cell doors, inns, town gates): Tab goes through.
    for (const portal of levelView.arena.portals ?? []) {
      if (!portal.use || !inPortal(portal, p, PORTAL_USE_REACH)) continue;
      best = { id: PORTAL_OBJECT_BASE + portal.id, label: `Tab — go to ${portal.target.replace(LEVEL_PREFIX, '').toUpperCase()}`, d: 0 };
    }
    for (const [id, door] of levelView.doors) {
      const b = door.def.bounds!;
      // Swinging doors stay in reach while open: Tab plays their sound again, as the original.
      if ((door.state !== 'present' && !door.swing) || door.def.byLever || p.y < b[1] - 2 || p.y > b[4]) continue;
      const d = Math.hypot(Math.max(b[0] - p.x, 0, p.x - b[3]), Math.max(b[2] - p.z, 0, p.z - b[5]));
      if (d > DOOR_RANGE || (best && best.d < d)) continue;
      // Only from where the original's triggers open it (the server checks the same), but for a
      // character who finished the story (any door, either side).
      const use = session.playerStats?.storyComplete
        ? { open: true as const, walk: false }
        : doorUseAt(door.def, p, (item) => (session.inventory?.items ?? []).some((i) => i.name === item), DOOR_USE_SLACK);
      if (!use) continue;
      const label = door.def.kind === 'lever' ? 'Tab — pull lever' : 'needs' in use ? `Locked — needs ${use.needs}` : 'Tab — open door';
      best = { id, label, d };
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
  /** The ground panel is a view of the same level objects used by Tab; pickup stays authoritative. */
  const updateGroundItems = () => {
    if (!inventoryPanel.isOpen('ground') || !levelView) return;
    const p = local.object.position;
    inventoryPanel.setGroundItems(
      [...levelView.objects]
        .filter(([, view]) => view.state === 'present' && view.def.kind === 'item' && !!view.def.item)
        .map(([id, view]) => ({
          id,
          name: view.def.item!.name,
          quantity: Math.max(1, view.def.item!.quantity),
          distance: Math.hypot(view.position.x - p.x, view.position.z - p.z),
          vertical: Math.abs(view.position.y - p.y),
        }))
        .filter((item) => item.distance <= INTERACT_RANGE && item.vertical <= 2)
        .sort((a, b) => a.distance - b.distance || a.id - b.id)
        .map(({ vertical: _vertical, ...item }) => item),
    );
  };
  // A door's sound actions (Sound.ctx ids at its hinge): every use of the door plays them.
  const doorSounds = (id: number) => {
    const door = levelView?.doors.get(id);
    if (!door?.def.sounds || !sounds) return;
    const k = door.swing?.def.keys[0];
    const at = k ? new THREE.Vector3(k.cx, door.def.bounds![1], k.cz) : new THREE.Vector3(door.def.x, door.def.y, door.def.z);
    for (const s of door.def.sounds) sounds.play(s, at);
  };
  // Signs and hints (message triggers, 0x4632B0 through the touch test 0x460320): the use key
  // reads a sign whose volume the player stands in (activation bit 3); a hint's volume (bit 0)
  // fires on every check while the player is inside, so its text stays up there; 0x200 fires
  // once per visit of the level (0x100 only lets a script re-arm it). Text stays MESSAGE_MS.
  const MESSAGE_USE = 8;
  const MESSAGE_WALK = 1;
  const MESSAGE_ONCE = 0x200;
  const messagesAt = (bit: number): StoryMessage[] => {
    const p = local.object.position;
    const x = p.x / LEVEL_UNIT_METRES, y = p.y / LEVEL_UNIT_METRES, z = p.z / LEVEL_UNIT_METRES;
    return (levelView?.arena.story?.messages ?? []).filter((m) => m.activation & bit && m.volume && !messagesDone.has(m.id) && inStoryVolume(m.volume, x, y, z));
  };
  const showMessage = (m: StoryMessage) => {
    if (m.activation & MESSAGE_ONCE) messagesDone.add(m.id);
    showSubtitle(null, m.text, MESSAGE_MS);
  };
  let messageRefresh = 0;
  const updateWalkInMessages = () => {
    const now = performance.now();
    const inside = new Set<number>();
    for (const m of messagesAt(MESSAGE_WALK)) {
      inside.add(m.id);
      // Entering shows it; staying refreshes it (not every frame: the DOM is rebuilt each time).
      if (!messagesInside.has(m.id) || now > messageRefresh) {
        showMessage(m);
        messageRefresh = now + MESSAGE_MS / 2;
      }
    }
    messagesInside.clear();
    for (const id of inside) messagesInside.add(id);
  };
  /**
   * R (or a hotbar spell): cast `spell` (the server checks mana and state). Self spells conjure
   * first with the feet planted; fire ball, slow, lightning and soul drinker go at once. A spell
   * other than the selected one is selected first (the server casts the selected spell).
   */
  const castSpell = (spell: SpellId) => {
    const st = session?.playerStats;
    const known = st?.spells.find((k) => k.spell === spell);
    const cost = known ? BUILTIN_SPELLS[spell]?.[known.level - 1]?.mana ?? 0 : 0;
    if (!st || !known || !CASTABLE_SPELLS.has(spell) || st.mana < cost) return;
    const info = SPELL_INFO[spell];
    const plan = {
      conjure: info.conjure ? (SPELL_CONJURE_TICKS / local.clipRate) * TICK_DT : 0,
      clip: spellClipSeconds(spell, local.clipRate).end,
      anim: ANIM.SPELL_CAST + SPELLS.indexOf(spell),
      state: info.asm,
    };
    if (!local.startCast(plan)) return;
    if (st.spell !== spell) session?.selectSpell(spell);
    session?.castSpell();
  };
  /**
   * Drinks the potion in a bag slot (hotbar, H, Z, the inventory): not while it cools down; Drake
   * drinks it (PK12, or PJ01 for mana crystals; the server plays it for the others too).
   */
  const drink = (item: InventoryItemView | undefined) => {
    if (!item || item.type !== 'potion' || hotbar.cooling(item.itemId) || !session) return;
    local.startItemAction(isManaCrystals({ id: item.itemId }) ? ANIM.USE_CRYSTAL : ANIM.USE_POTION);
    session.useItem(item.slot);
  };
  /** Wears (or takes off) gear: a weapon is drawn, a shield readied (ASM_READY_WEAPON / _SHIELD). */
  const equip = (item: InventoryItemView | undefined, wear: boolean, to?: { x: number; y: number }) => {
    if (!item || !session) return;
    if (wear && !item.equipped && (item.type === 'weapon' || item.type === 'shield')) {
      local.startItemAction(item.type === 'weapon' ? ANIM.READY_WEAPON : ANIM.READY_SHIELD);
    }
    session.equip(item.slot, wear, item.itemId, to);
  };
  /** A hotbar slot used: cast its spell, drink its potion, or wear its gear (quick swap). */
  const useHotbar = (entry: HotbarEntry) => {
    if (inScene() || optionsOpen || !session) return;
    if (entry.kind === 'spell') {
      castSpell(entry.spell);
      return;
    }
    const owned = (session.inventory?.items ?? []).filter((i) => i.itemId === entry.itemId);
    if (entry.type === 'potion') {
      // The smallest stack first, so stacks run out one at a time.
      drink(owned.sort((a, b) => (a.quantity ?? 1) - (b.quantity ?? 1))[0]);
    } else {
      const spare = owned.find((i) => !i.equipped);
      if (spare && !owned.some((i) => i.equipped)) equip(spare, true);
    }
  };
  hotbar.onActivate = useHotbar;
  input.onHotbar = (slot) => {
    if (inScene() || optionsOpen) return;
    hotbar.activate(slot);
  };
  input.onAction = (action) => {
    if (inScene()) return;
    if (action === 'interact') {
      // The use key also reads any sign in reach, whatever else it does.
      const sign = messagesAt(MESSAGE_USE)[0];
      if (sign) showMessage(sign);
      const target = nearestInteractable();
      if (target?.shop) session?.shopOpen(target.id);
      else if (target && target.id < 0) talk(-target.id);
      else if (target && !target.key) {
        session?.interact(target.id);
        doorSounds(target.id);
      }
    } else if (action === 'useItem') {
      // Z: the key on a locked door in reach, otherwise the weakest healing potion.
      const target = nearestInteractable();
      if (target?.key) session?.interact(target.id, true);
      else {
        drink((session?.inventory?.items ?? []).filter((i) => i.type === 'potion' && !hotbar.cooling(i.itemId)).sort((a, b) => (a.heal ?? 0) - (b.heal ?? 0))[0]);
      }
    } else if (action === 'castSpell') {
      const spell = session?.playerStats?.spell;
      if (spell) castSpell(spell);
    } else if (action === 'nextSpell') {
      // T: the next known spell.
      const st = session?.playerStats;
      if (st && st.spells.length) {
        const i = st.spells.findIndex((k) => k.spell === st.spell);
        session?.selectSpell(st.spells[(i + 1) % st.spells.length]!.spell);
      }
    } else if (action === 'healthPotion') {
      // H: drink the weakest healing potion carried (the original's quick potion key) not cooling down.
      const potions = (session?.inventory?.items ?? []).filter((i) => i.type === 'potion' && !hotbar.cooling(i.itemId));
      drink(potions.sort((a, b) => (a.heal ?? 0) - (b.heal ?? 0))[0]);
    }
  };
  inWorld = true;
  hotbar.setCharacter(auth.kind === 'account' ? auth.characterId : null);
  hotbar.visible = !!session;
  chat.visible = !!session;
  gameFiles.visible = false;
  play();
  // Back to the character screen: the account session stays, the world is left.
  const navButtonsRow = document.getElementById('nav-buttons-row')!;
  const unstuckButton = document.getElementById('btn-unstuck')!;
  const characterButton = document.getElementById('btn-characters')!;
  const logoutButton = document.getElementById('btn-logout')!;
  const confirmBox = document.getElementById('confirm-box')!;
  const confirmPrompt = document.getElementById('confirm-prompt')!;
  const confirmYes = document.getElementById('btn-confirm-yes')!;
  const confirmCancel = document.getElementById('btn-confirm-cancel')!;

  let pendingAction: 'unstuck' | 'characters' | 'logout' | null = null;

  const resetConfirm = () => {
    pendingAction = null;
    confirmBox.hidden = true;
    navButtonsRow.hidden = false;
  };
  resetOverlayConfirm = resetConfirm;

  const showConfirm = (action: 'unstuck' | 'characters' | 'logout', prompt: string) => {
    pendingAction = action;
    confirmPrompt.textContent = prompt;
    confirmYes.className = action === 'logout' ? 'btn-danger' : 'btn-warn';
    navButtonsRow.hidden = true;
    confirmBox.hidden = false;
  };

  // Online only: the server puts the character back where it would respawn.
  unstuckButton.hidden = !session;
  unstuckButton.addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirm('unstuck', 'Move to the start of the area (or your last checkpoint)?');
  });

  if (auth.kind === 'account') {
    characterButton.hidden = false;
    logoutButton.hidden = false;
  } else {
    characterButton.hidden = true;
    logoutButton.hidden = true;
  }

  characterButton.addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirm('characters', 'Return to character selection?');
  });

  logoutButton.addEventListener('click', (e) => {
    e.stopPropagation();
    showConfirm('logout', 'Log out of Crusaders Online?');
  });

  confirmCancel.addEventListener('click', (e) => {
    e.stopPropagation();
    resetConfirm();
  });

  confirmYes.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (pendingAction === 'unstuck') {
      session?.unstuck();
      setOptionsOpen(false);
    } else if (pendingAction === 'characters') {
      session?.close();
      try {
        sessionStorage.setItem(CHARACTER_SCREEN_FLAG, 'characters');
      } catch {
        // Without session storage it opens on the server list.
      }
      location.reload();
    } else if (pendingAction === 'logout') {
      session?.close();
      await logout();
      location.reload();
    }
  });
  input.onLockChange = (locked) => {
    const ours = releasing;
    releasing = false;
    // A click on the world took the pointer back while typing: the line closes.
    if (locked) {
      chatTookLock = false;
      chat.blur();
    }
    // Esc released the pointer: the options (sequences play to their end, as in the original).
    if (!locked && !ours && !inventoryPanel.open && !questBook.open && !charSheet.open && !inScene()) setOptionsOpen(true);
  };

  // Inventory window (online only); the ground window opens beside it (and opens it).
  function setInventoryPanelOpen(kind: InventoryPanelKind, open: boolean): void {
    if (!session || open === inventoryPanel.isOpen(kind)) return;
    inventoryPanel.setOpen(kind, open);
    if (open && kind === 'ground') updateGroundItems();
    if (open && input.locked) {
      releasing = true;
      document.exitPointerLock();
    } else if (!open && !inventoryPanel.open && !optionsOpen) input.requestLock();
  }
  function setInventoryOpen(open: boolean): void {
    setInventoryPanelOpen('inventory', open);
  }
  function closeInventoryPanels(): void {
    if (!inventoryPanel.open) return;
    inventoryPanel.closeAll();
    if (!optionsOpen) input.requestLock();
  }
  inventoryPanel.onEquip = (slot, itemId, wear, to) => {
    const item = session?.inventory?.items.find((i) => i.slot === slot && i.itemId === itemId);
    if (item) equip(item, wear, to);
    else session?.equip(slot, wear, itemId, to);
  };
  inventoryPanel.onUse = (slot, itemId) => drink(session?.inventory?.items.find((i) => i.slot === slot && i.itemId === itemId));
  inventoryPanel.onMove = (slot, itemId, x, y) => session?.moveInventoryItem(slot, x, y, itemId);
  inventoryPanel.onMerge = (fromSlot, toSlot) => session?.mergeInventoryStacks(fromSlot, toSlot);
  inventoryPanel.onSplit = (slot, quantity) => session?.splitInventoryStack(slot, quantity);
  inventoryPanel.onDrop = (slot, itemId) => session?.dropInventoryItem(slot, itemId);
  inventoryPanel.onBuy = (shop, index, itemId) => session?.shopBuy(shop, index, itemId);
  inventoryPanel.onSell = (shop, slot, itemId) => session?.shopSell(shop, slot, itemId);
  inventoryPanel.onShopClosed = () => (shopAt = null);
  inventoryPanel.onPickup = (object) => session?.interact(object);
  inventoryPanel.onHotbar = (slot, item) => hotbar.set(slot, hotbarItemEntry(item));
  inventoryPanel.onSpellDrag = (spell, e) => hotbar.dragFrom({ kind: 'spell', spell }, e);
  inventoryPanel.onSelectSpell = (spell) => session?.selectSpell(spell);
  inventoryPanel.onToggle = (kind, open) => setInventoryPanelOpen(kind, open);
  inventoryPanel.onNotice = (message) => {
    if (!player) return;
    headPos.copy(player.object.position);
    headPos.y += player.avatar.headHeight;
    combatUi.notice(message, headPos);
  };
  // Quest book (F2, the original's key), online only.
  function setQuestBookOpen(open: boolean, swapping = false): void {
    if (!session || open === questBook.open) return;
    questBook.open = open;
    if (open) {
      setCharSheetOpen(false, true);
      if (input.locked) {
        releasing = true;
        document.exitPointerLock();
      }
      sounds?.play(SFX.turnPage);
    } else if (!swapping && !optionsOpen) input.requestLock();
  }
  questBook.onClose = () => setQuestBookOpen(false);
  // Character statistics (F1, the original's key), online only; F1 and F2 take each other's place.
  function setCharSheetOpen(open: boolean, swapping = false): void {
    if (!session || open === charSheet.open) return;
    charSheet.open = open;
    if (open) {
      setQuestBookOpen(false, true);
      if (input.locked) {
        releasing = true;
        document.exitPointerLock();
      }
    } else if (!swapping && !optionsOpen) input.requestLock();
  }
  charSheet.onClose = () => setCharSheetOpen(false);
  questBook.onTurn = () => sounds?.play(SFX.turnPage);
  window.addEventListener('keydown', (e) => {
    // Sequences cannot be skipped.
    if (inScene()) return;
    if (e.code === 'Escape') {
      if (e.repeat) return;
      // The Esc that released the pointer may arrive too: it opened the menu already.
      if (optionsOpen) {
        if (performance.now() - optionsAt > 250) setOptionsOpen(false);
      } else if (inventoryPanel.open) closeInventoryPanels();
      else if (questBook.open) setQuestBookOpen(false);
      else if (charSheet.open) setCharSheetOpen(false);
      else setOptionsOpen(true);
      return;
    }
    if (optionsOpen) return;
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement | null)?.isContentEditable;
    if (!typing && session && !e.repeat && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Slash') && !input.isBound(e.code) && !e.ctrlKey && !e.altKey) {
      // Enter opens the chat line; / opens it on a command.
      e.preventDefault();
      chat.focus(e.code === 'Slash' ? '/' : '');
    } else if (!typing && (e.ctrlKey || e.shiftKey) && !e.altKey && !e.repeat && e.code === 'KeyG') {
      // Ctrl+G (Shift+G too): the ground window beside the inventory.
      e.preventDefault();
      setInventoryPanelOpen('ground', !inventoryPanel.isOpen('ground'));
    } else if (!typing && e.shiftKey && !e.repeat && e.code === 'KeyC') {
      e.preventDefault();
      setInventoryOpen(!inventoryPanel.open);
    } else if (!typing && !e.defaultPrevented && !e.ctrlKey && !e.altKey && !e.shiftKey && !chat.typing && (inventoryPanel.open || questBook.open || charSheet.open) && input.isMoveKey(e.code)) {
      // Walking off with a window open: the windows close, the camera takes the pointer back and
      // the step starts at once (not after the key repeat).
      e.preventDefault();
      closeInventoryPanels();
      setQuestBookOpen(false);
      setCharSheetOpen(false);
      input.pressMove(e.code);
    } else if ((input.isKeyForAction('inventory', e.code) || e.code === 'KeyI') && !e.repeat) setInventoryOpen(!inventoryPanel.open);
    else if ((input.isKeyForAction('questBook', e.code) || e.code === 'F2') && !e.repeat) {
      e.preventDefault();
      setQuestBookOpen(!questBook.open);
    } else if ((input.isKeyForAction('characterSheet', e.code) || e.code === 'F1') && !e.repeat) {
      e.preventDefault();
      setCharSheetOpen(!charSheet.open);
    }
  });

  window.addEventListener('resize', () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    postFx.setSize(container.clientWidth, container.clientHeight);
    chase.resize(container.clientWidth / container.clientHeight);
    if (cutscene) cinemaFov(cutscene.camera);
    if (ending) cinemaFov(ending.camera);
  });

  if (import.meta.env.DEV) {
    // Debug/E2E hook: lets tests drive input without pointer lock.
    (window as unknown as { __co: unknown }).__co = { input, player: local, mw, session, remotes, inventory: inventoryPanel, scene, get camera() { return chase.camera; }, cameras: { classic: chase.classic, modern: chase.modern }, rig: chase, settings, renderer, level: levelView, get effects() { return effects; }, get decals() { return decals; }, get foliage() { return foliage; }, propShadows, render: () => postFx.render(chase.camera, 0) };
  }

  // Fixed-step simulation (same 20 Hz step as the server), interpolated rendering.
  const frame = createInputFrame();
  let tick = 0;
  let acc = 0;
  let last = performance.now();
  const target = new THREE.Vector3();
  const lastStep = new THREE.Vector3();
  let stepFoot = 0;

  const frameLoop = (now: number): void => {
    // Scripted views keep the real clock (up to 1 s a frame): a page in the background draws
    // seldom, and its sequence would fall behind the server's.
    const sceneDt = Math.min(now - last, 1000) / 1000;
    const frameMs = Math.min(now - last, MAX_FRAME_MS);
    last = now;
    acc += frameMs;
    while (acc >= TICK_MS) {
      // The original reads the attack button as held every frame (0x0042CA20): holding it swings
      // again as soon as it can, and chains the combo.
      if (input.attackHeld) input.onAttack();
      input.sample(frame, ++tick);
      // During a scripted sequence the character stands still (the server ignores the keys too).
      if (inScene()) frame.flags = 0;
      if (local.rooted) frame.flags |= INPUT.ROOTED;
      // An attack whose clip carries Drake starts its root motion on this step (shared movement).
      frame.flags |= local.takeAttackMotion() << INPUT_ATTACK_SHIFT;
      local.fixedStep(frame);
      acc -= TICK_MS;
    }
    const dt = frameMs / 1000;
    local.viewHeading = input.yaw;
    // Necros's death slows the world (its clips, effects and debris) under the timeline's real clock.
    const worldDt = ending ? dt * ending.timeScale : dt;
    if (ending) {
      ending.update(sceneDt);
      local.render(acc / TICK_MS, worldDt);
      if (ending.finished) {
        endEnding();
        fade(false, 800);
      }
    } else if (cutscene) {
      cutscene.update(sceneDt);
      local.avatar.update(sceneDt);
      if (cutscene?.finished) endCutscene();
    } else local.render(acc / TICK_MS, dt);
    if (myTorch.visible) {
      myTorch.position.set(local.object.position.x, local.object.position.y + TORCH_LIGHT_HEIGHT, local.object.position.z);
      dynamicLights.set(MY_TORCH_KEY, myTorch.position, TORCH_LIGHT_COLOR, TORCH_DYNAMIC_INTENSITY, myTorch.distance, 0.08);
    }
    // The puppets of a sequence keep its clock (their clips time its steps).
    if (session) remotes.update(session, cutscene ? sceneDt : worldDt);
    for (const p of scenePuppets.values()) p.avatar.update(cutscene ? sceneDt : worldDt);
    effects?.update(worldDt);
    decals?.update(worldDt);
    spellVisuals.update(worldDt);
    debris?.update(worldDt);
    lighting.update(dt, now / 1000);
    // Players' sword trails (every swing but the ducking chop).
    trails.update(dt);
    trails.track('me', (a, b) => local.avatar.blade?.(a, b) ?? null, dt);
    bladeTipBefore.copy(bladeTip);
    bladeSeen = !!local.avatar.blade?.(bladeBase, bladeTip);
    for (const [id, e] of remotes.byId) if (e.info.kind !== 'mob') trails.track(id, (a, b) => (e.visible ? e.avatar.blade?.(a, b) ?? null : null), dt);
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
      dynamicLights.flash(at, SPARK_LIGHT_COLOR, SPARK_LIGHT_INTENSITY, SPARK_LIGHT_RADIUS, SPARK_LIGHT_SECONDS);
      fxBurst('SWORD_DAMAGE', 3, at, normal.clone().multiplyScalar(0.2), normal);
      fxBurst('SWORD_METAL', 3, at, normal.clone().multiplyScalar(0.2), normal);
      // 0x0048CAB0: a clank (HitMetal01-04 or HitStone01: 338 + round(rand x 4)) at the striker and
      // the weapon's mark on the wall, laid along the blade's sweep.
      sounds?.play(SFX.wallHit + Math.round(Math.random() * 4), local.object.position);
      const sweep = bladeSeen ? bladeTip.clone().sub(bladeTipBefore) : null;
      if (myDecal) decals?.stamp(myDecal, at, sweep && sweep.lengthSq() > 1e-8 ? sweep : new THREE.Vector3(fwd.z, 0, -fwd.x));
    }
    input.updateView(dt);
    const movingNow = Math.hypot(local.object.position.x - target.x, local.object.position.z - target.z) > 1e-4;
    target.copy(local.object.position);
    chase.update(target, input.yaw, local.bodyHeading, input.pitch, dt, movingNow);
    if (entryFade !== null && (cutscene || (session && session.stats.snapshots >= entryFade + 3))) {
      if (!cutscene) fade(false, 600);
      entryFade = null;
    }
    let viewCamera = ending ? ending.camera : cutscene ? cutscene.camera : chase.camera;
    if (!cutscene && outro) {
      outro.t += dt;
      const k = Math.min(1, outro.t / OUTRO_SECONDS);
      const e = k * k * k * (k * (k * 6 - 15) + 10); // smootherstep
      outro.camera.position.lerpVectors(outro.from, chase.camera.position, e);
      outro.camera.quaternion.slerpQuaternions(outro.fromQ, chase.camera.quaternion, e);
      outro.camera.fov = outro.fromFov + (chase.camera.fov - outro.fromFov) * e;
      outro.camera.updateProjectionMatrix();
      viewCamera = outro.camera;
      if (k >= 1) outro = null;
    }
    levelView?.update(viewCamera, dt);
    foliage?.update(viewCamera, local.object.position, dt, foliageBlocked);
    if (sounds) {
      sounds.setListener(viewCamera);
      // Footsteps on stone while running on the ground (catacomb floors are ST materials).
      // Placeholder avatars have no clip events: approximate steps by distance.
      const moving = !local.avatar.hasEvents && local.character.grounded && Math.hypot(local.object.position.x - lastStep.x, local.object.position.z - lastStep.z) > 1.1;
      if (moving) {
        lastStep.copy(local.object.position);
        sounds.play(stepSounds()[stepFoot = 1 - stepFoot]!, local.object.position, { volume: 0.35 });
      }
    }
    if (levelView && session && !inScene()) {
      const t = nearestInteractable();
      const sign = !t && messagesAt(MESSAGE_USE).length > 0;
      prompt.hidden = !t && !sign;
      if (t) prompt.textContent = t.label;
      else if (sign) prompt.textContent = 'Tab — read sign';
      updateWalkInMessages();
    }
    updateGroundItems();
    // Leaving the shop's volume ends the visit (the server only trades inside it).
    if (shopAt !== null && (shopHere()?.id !== shopAt || inventoryPanel.shopId === null)) {
      inventoryPanel.closeShop();
      shopAt = null;
    }
    dynamicLights.update(viewCamera, dt);
    propShadows.update(renderer, scene, viewCamera, dt);
    postFx.render(viewCamera, dt);
    combatUi.update(dt, viewCamera, remotes, container.clientWidth, container.clientHeight);
    hud.update(dt, tick, local.character, session, remotes.count);
  };
  renderer.setAnimationLoop(frameLoop);
  // Debug/E2E: frames can be driven by hand where requestAnimationFrame does not run (hidden pane).
  if (import.meta.env.DEV) (window as unknown as { __co: Record<string, unknown> }).__co['frame'] = frameLoop;
}

main().catch((err: unknown) => {
  console.error(err);
  document.getElementById('error')!.textContent = `Failed to start: ${(err as Error).message ?? err}`;
});
