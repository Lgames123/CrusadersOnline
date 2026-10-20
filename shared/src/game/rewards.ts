/**
 * Who shares a kill, and how much (MMO Stage 2, not original; docs/game-design/mmo/02 §3, §6, §7).
 * The original is single player: the one who kills takes it all. Here every player who did a
 * meaningful part qualifies; alone it is exactly the original's reward.
 *
 * - Contribution = damage dealt to the creature, clamped to the hit points it still had (overkill
 *   does not count); a spectral ally's blows count for its owner.
 * - Only players present, active in the last ACTIVE_WINDOW_SECONDS and within LEASH_METRES of the
 *   creature count; the rest are dropped from the total.
 * - Party members' contributions add up. A party (or a lone player) with at least THRESHOLD of
 *   the total qualifies; in a qualifying party every active member within PARTY_RANGE_METRES
 *   qualifies, even one who dealt nothing (tanks, healers).
 * - XP: alone, base × share; a party, base × (1 + 0.1 × (n − 1)) × share, split evenly among its n
 *   qualifying members. At least 1 when the creature gives any. Gold follows the same split.
 * - Items: every qualifying player gets his own roll (the caller), never shared.
 */
export const KILL_SHARE = {
  threshold: 0.05,
  activeWindowSeconds: 12,
  leashMetres: 40,
  partyRangeMetres: 30,
  partyBonusPerMember: 0.1,
} as const;

export interface KillCandidate {
  id: number;
  /** Damage it dealt (overkill clamped); 0 for a party member who only stood by. */
  damage: number;
  party: string | null;
  /** Gave an active input within the window. */
  active: boolean;
  /** Metres from the creature at its death. */
  distance: number;
}

export interface KillShare {
  id: number;
  xp: number;
  /** Fraction of the creature's gold (0..1). */
  gold: number;
}

export function shareKill(candidates: readonly KillCandidate[], baseXp: number): KillShare[] {
  const R = KILL_SHARE;
  const counted = candidates.filter((c) => c.active && c.distance <= R.leashMetres && c.damage > 0);
  const total = counted.reduce((n, c) => n + c.damage, 0);
  if (total <= 0) return [];
  // Groups: a party, or a lone player.
  const groups = new Map<string, number>();
  const groupOf = (c: KillCandidate) => (c.party ? `p:${c.party}` : `s:${c.id}`);
  for (const c of counted) groups.set(groupOf(c), (groups.get(groupOf(c)) ?? 0) + c.damage);
  const out: KillShare[] = [];
  for (const [group, damage] of groups) {
    const share = damage / total;
    if (share < R.threshold) continue;
    const members = group.startsWith('p:')
      ? candidates.filter((c) => c.party && `p:${c.party}` === group && c.active && c.distance <= R.partyRangeMetres)
      : counted.filter((c) => groupOf(c) === group);
    // A party whose hitters wandered off still pays them if they are inside the leash.
    for (const c of counted) if (groupOf(c) === group && !members.includes(c)) members.push(c);
    const n = members.length;
    const pool = baseXp * (n > 1 ? 1 + R.partyBonusPerMember * (n - 1) : 1) * share;
    for (const m of members) out.push({ id: m.id, xp: baseXp > 0 ? Math.max(1, Math.floor(pool / n + 1e-9)) : 0, gold: share / n });
  }
  return out;
}
