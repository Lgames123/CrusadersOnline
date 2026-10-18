/**
 * The original's decals: marks stamped onto the level's faces (executable-analysis §8.6c).
 * Kinds, textures and sizes from the decal manager (init 0x00442B05: names 0x004EE974 → ids
 * 0x004EE9A0, texture names 0x004EE834 one per 0x20 bytes, size per kind at +0xC630, 4 ft unless
 * set). A melee weapon's kind is its items.ctx `Decal`; spells use fixed kinds.
 */
export const DECAL_KINDS = ['SCORCH', 'SCRATCH', 'LIGHTNING', 'CHOP', 'SLAM', 'FROST', 'CLAW', 'L_FOOTPRINT', 'R_FOOTPRINT', 'BLOODSTAIN'] as const;
export type DecalKind = (typeof DECAL_KINDS)[number];

const FT = 0.3048;

/** Texture and half size (metres; the original's feet × 0.3048): the stamped square is twice it across. */
export const DECAL_LOOKS: Readonly<Record<DecalKind, { texture: string; size: number }>> = {
  SCORCH: { texture: 'scorch1', size: 4 * FT },
  SCRATCH: { texture: 'slash-25', size: 2 * FT },
  LIGHTNING: { texture: 'lightninghit', size: 4 * FT },
  CHOP: { texture: 'axe-15', size: 2 * FT },
  SLAM: { texture: 'blunt', size: 2.5 * FT },
  FROST: { texture: 'frost2', size: 4 * FT },
  CLAW: { texture: 'claw-40', size: 4 * FT },
  L_FOOTPRINT: { texture: 'footprint', size: 0.8 * FT },
  R_FOOTPRINT: { texture: 'footprint', size: 0.8 * FT },
  BLOODSTAIN: { texture: 'bloodhit', size: 3 * FT },
};

/** The kind an items.ctx `Decal` names, or null (`NONE`, absent, unknown). */
export function decalKind(name: unknown): DecalKind | null {
  return typeof name === 'string' && (DECAL_KINDS as readonly string[]).includes(name) ? (name as DecalKind) : null;
}

/**
 * Timing and placement (0x00442E30 / 0x00443580 / 0x00443B30): full for 5 s, then fading out over
 * 1.5 s; a new decal ends the ones within twice its size at once (they start fading); a face takes
 * it when the point lies in front of it with size² − distance² ≥ 0.2 ft²; drawn 0.07 ft off the face.
 */
export const DECAL_RULES = {
  hold: 5,
  fade: 1.5,
  minSpan: 0.2 * FT * FT,
  lift: 0.07 * FT,
  /** Footprints only on floors (normal y ≥ 0.7). */
  floorY: 0.7,
} as const;
