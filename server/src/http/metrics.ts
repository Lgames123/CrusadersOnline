import { timingSafeEqual } from 'node:crypto';
import type { ZoneMetrics } from '../zone/messages.ts';

/**
 * GET /metrics in the Prometheus text format (operations.md §2). Served on the server's own
 * port only: the Caddy front proxies /api, /ws and /healthz, never this, so it is reachable from
 * the compose network (a Prometheus or Grafana Agent there) and not from the internet. With
 * METRICS_TOKEN set it also wants `Authorization: Bearer <token>`.
 */
export interface MetricsInput {
  onlinePlayers: number;
  zones: { name: string; players: number; metrics: ZoneMetrics | null }[];
  pendingSaves: number;
  uptimeSeconds: number;
  rssBytes: number;
  heapUsedBytes: number;
}

/** A tick past this is an alarm (performance-testing.md §4). */
export const TICK_ALARM_MS = 45;

const label = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export function renderMetrics(m: MetricsInput): string {
  const out: string[] = [];
  const metric = (name: string, type: 'gauge' | 'counter', help: string, rows: [string, number][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, v] of rows) out.push(`${name}${labels} ${Number.isFinite(v) ? v : 0}`);
  };
  const z = (name: string) => `{zone="${label(name)}"}`;
  metric('crusaders_online_players', 'gauge', 'Players in the world.', [['', m.onlinePlayers]]);
  metric('crusaders_zones', 'gauge', 'Running zone workers.', [['', m.zones.length]]);
  metric('crusaders_zone_players', 'gauge', 'Players per zone.', m.zones.map((x) => [z(x.name), x.players]));
  const withTicks = m.zones.filter((x) => x.metrics);
  metric('crusaders_zone_tick_p50_ms', 'gauge', 'Median tick duration over the last report window (5 s).', withTicks.map((x) => [z(x.name), x.metrics!.p50]));
  metric('crusaders_zone_tick_p99_ms', 'gauge', '99th percentile tick duration over the last report window.', withTicks.map((x) => [z(x.name), x.metrics!.p99]));
  metric('crusaders_zone_tick_max_ms', 'gauge', 'Slowest tick over the last report window.', withTicks.map((x) => [z(x.name), x.metrics!.max]));
  metric('crusaders_zone_late_ticks', 'gauge', 'Ticks over 90 % of the 50 ms budget in the last report window.', withTicks.map((x) => [z(x.name), x.metrics!.late]));
  metric('crusaders_pending_saves', 'gauge', 'Character saves in flight.', [['', m.pendingSaves]]);
  metric('crusaders_uptime_seconds', 'counter', 'Seconds since the server started.', [['', Math.round(m.uptimeSeconds)]]);
  metric('crusaders_process_rss_bytes', 'gauge', 'Resident memory of the server process (zone workers included).', [['', m.rssBytes]]);
  metric('crusaders_process_heap_used_bytes', 'gauge', 'V8 heap in use on the main thread.', [['', m.heapUsedBytes]]);
  return `${out.join('\n')}\n`;
}

/** Whether a request may read /metrics: always without a token, else a matching bearer. */
export function metricsAllowed(token: string | null, authorization: string | undefined): boolean {
  if (!token) return true;
  const given = Buffer.from(/^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? '');
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}
