import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { clientIp } from '@crusaders/server/http/api';

const req = (headers: Record<string, string | string[]>, socket = '172.18.0.4') =>
  ({ headers, socket: { remoteAddress: socket } }) as unknown as IncomingMessage;

describe('clientIp (per-IP rate limits behind a proxy)', () => {
  it('uses the socket address without a configured header', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }), null)).toBe('172.18.0.4');
  });

  it('takes the first entry of the configured header', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), 'x-forwarded-for')).toBe('1.2.3.4');
    expect(clientIp(req({ 'cf-connecting-ip': '5.6.7.8' }), 'cf-connecting-ip')).toBe('5.6.7.8');
  });

  it('falls back to the socket when the header is missing or empty', () => {
    expect(clientIp(req({}), 'cf-connecting-ip')).toBe('172.18.0.4');
    expect(clientIp(req({ 'cf-connecting-ip': ' ' }), 'cf-connecting-ip')).toBe('172.18.0.4');
  });
});
