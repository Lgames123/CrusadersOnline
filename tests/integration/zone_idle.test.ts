import { describe, expect, it } from 'vitest';
import { ZoneManager } from '@crusaders/server/zone/zone_manager';

/** Idle zones are stopped (worker threads on the synthetic arena; no original data). */
describe('zone manager', () => {
  const events = { deliver: () => {}, persist: () => {}, portal: () => {}, transferred: () => {} };
  const base = { difficulty: 'medium' as const, itemRulesPath: null, generatedDir: '.' };

  it('stops a zone left empty past the idle time, keeps occupied and kept zones', async () => {
    const zones = new ZoneManager(base, events, { idleStopMs: 1000, sweepMs: 3_600_000 });
    try {
      const host = await zones.get('synthetic-arena');
      host.join(1, { name: 'Visitor', characterId: null });
      expect(await zones.stopIdle(Date.now() + 5000)).toEqual([]); // occupied
      host.leave(1);
      expect(await zones.stopIdle(Date.now())).toEqual([]); // empty, but not for long
      zones.keep('synthetic-arena');
      expect(await zones.stopIdle(Date.now() + 5000)).toEqual([]); // kept
    } finally {
      await zones.stopAll();
    }
    const other = new ZoneManager(base, events, { idleStopMs: 1000, sweepMs: 3_600_000 });
    try {
      await other.get('synthetic-arena');
      expect(await other.stopIdle(Date.now() + 5000)).toEqual(['synthetic-arena']);
      expect(other.host('synthetic-arena')).toBeNull();
      expect(other.names).toEqual([]);
      // Started again on the next use.
      expect((await other.get('synthetic-arena')).zone).toBe('synthetic-arena');
    } finally {
      await other.stopAll();
    }
  }, 30_000);
});
