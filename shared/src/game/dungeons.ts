/**
 * Instanced dungeons (MMO Stage 5, not original; docs/game-design/mmo/06), behind the server
 * feature `mmoDungeons`. A run is a zone of its own on an original act ("level:ca1d@crypt-3"):
 * the act's creatures are the way in, and a boss with phases waits at its far end. Entered from a
 * waypoint crystal (a finished story), the party leader taking his party.
 */
export interface DungeonBoss {
  archetype: string;
  name: string;
  hp: number;
  /** Model scale. */
  scale: number;
  /** Multiplier on its blows. */
  damage: number;
  xp: number;
  gold: [number, number];
  /** Phase 2 (below this fraction of its hit points): adds come. */
  addsBelow: number;
  adds: { archetype: string; count: number };
  /** Phase 3: telegraphed slams on a player (unblockable). */
  slamBelow: number;
  slam: { radius: number; damage: number; windup: number; every: number };
  /** Soft enrage: after `after` seconds of a fight, +`step` damage every 30 s. */
  enrage: { after: number; step: number };
}

export interface DungeonDef {
  id: string;
  name: string;
  /** The original act it runs on. */
  act: string;
  maxParty: number;
  /** The tracker's bonus objective: the act's hostile creatures (they do not come back in an instance). */
  clearText: string;
  boss: DungeonBoss;
}

export const DUNGEONS: readonly DungeonDef[] = [
  {
    id: 'crypt',
    name: 'The Crypt of the Catacombs',
    act: 'ca1d',
    maxParty: 5,
    clearText: 'Clear the crypt of the dead',
    boss: {
      archetype: 'black_knight',
      name: 'Crypt Overlord',
      hp: 3000,
      scale: 1.6,
      damage: 2.5,
      xp: 3000,
      gold: [500, 800],
      addsBelow: 0.75,
      adds: { archetype: 'skeleton_warrior', count: 3 },
      slamBelow: 0.4,
      slam: { radius: 4, damage: 45, windup: 1.5, every: 8 },
      enrage: { after: 360, step: 0.1 },
    },
  },
];

/**
 * The party's ready check before a run: everyone asked, one "no" calls it off, and whoever has
 * not answered when it runs out counts as ready.
 */
export const DUNGEON_READY_SECONDS = 15;

/** The waypoint "act" that enters a dungeon ("dg-crypt"). */
export const DUNGEON_ENTRY_PREFIX = 'dg-';

export function dungeonById(id: string): DungeonDef | undefined {
  return DUNGEONS.find((d) => d.id === id);
}

/** A zone name's base arena and its instance ("level:ca1d@crypt-3" -> base "level:ca1d", dungeon "crypt"). */
export function splitInstance(zone: string): { base: string; instance: string | null; dungeon: DungeonDef | null } {
  const at = zone.indexOf('@');
  if (at < 0) return { base: zone, instance: null, dungeon: null };
  const instance = zone.slice(at + 1);
  return { base: zone.slice(0, at), instance, dungeon: dungeonById(instance.split('-')[0] ?? '') ?? null };
}

/** The daily lockout's story flag for a dungeon's boss loot ("dg-crypt:20381"). */
export function dungeonLockFlag(dungeonId: string, now = Date.now()): string {
  return `dg-${dungeonId}:${Math.floor(now / 86_400_000)}`;
}
