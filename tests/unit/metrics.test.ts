import { describe, expect, it } from 'vitest';
import { pino } from 'pino';
import { startServer } from '@crusaders/server';
import { metricsAllowed, renderMetrics } from '@crusaders/server/http/metrics';

describe('GET /metrics (operations.md §2)', () => {
  it('renders the Prometheus text format', () => {
    const text = renderMetrics({
      onlinePlayers: 3,
      zones: [
        { name: 'level:ca1a', players: 2, metrics: { zone: 'level:ca1a', players: 2, ticks: 100, p50: 4.5, p99: 9.25, max: 12, late: 0 } },
        { name: 'level:cs"1a', players: 1, metrics: null },
      ],
      pendingSaves: 0,
      uptimeSeconds: 61.4,
      rssBytes: 1000,
      heapUsedBytes: 500,
    });
    expect(text).toContain('# TYPE crusaders_online_players gauge\ncrusaders_online_players 3\n');
    expect(text).toContain('crusaders_zone_tick_p99_ms{zone="level:ca1a"} 9.25');
    expect(text).toContain('crusaders_zone_players{zone="level:cs\\"1a"} 1');
    expect(text).not.toContain('crusaders_zone_tick_p99_ms{zone="level:cs');
    expect(text).toContain('crusaders_uptime_seconds 61');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('a token, when set, is required as a bearer', () => {
    expect(metricsAllowed(null, undefined)).toBe(true);
    expect(metricsAllowed('s3cret', undefined)).toBe(false);
    expect(metricsAllowed('s3cret', 'Bearer nope')).toBe(false);
    expect(metricsAllowed('s3cret', 'Bearer s3cret')).toBe(true);
  });

  it('is served by the server', async () => {
    const server = await startServer(
      { port: 0, host: '127.0.0.1', env: 'test', logLevel: 'silent', databaseUrl: 'pglite:memory', metricsToken: 'tok' },
      pino({ level: 'silent' }),
    );
    try {
      const base = `http://127.0.0.1:${server.port}/metrics`;
      expect((await fetch(base)).status).toBe(401);
      const res = await fetch(base, { headers: { authorization: 'Bearer tok' } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
      expect(await res.text()).toMatch(/^crusaders_zones \d+$/m);
    } finally {
      await server.close();
    }
  });
});
