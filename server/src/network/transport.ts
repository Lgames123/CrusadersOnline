/**
 * Transport abstraction (ADR-004). Game/session code only sees ClientConnection, so the
 * `ws` implementation can later be swapped for uWebSockets.js or WebTransport.
 */
export interface ClientConnection {
  readonly id: number;
  readonly remoteAddress: string;
  /** Uint8Array => binary frame, string => text (JSON) frame. */
  send(data: Uint8Array | string): void;
  close(code: number, reason: string): void;
}

export interface TransportHandlers {
  open(conn: ClientConnection): void;
  message(conn: ClientConnection, data: Uint8Array | string): void;
  close(conn: ClientConnection): void;
}

export interface Transport {
  close(): Promise<void>;
  readonly connectionCount: number;
}

/** WebSocket close codes used by the server. */
export const CLOSE = {
  POLICY: 1008,
  TOO_BIG: 1009,
  SHUTDOWN: 1001,
  AUTH_FAILED: 4001,
  AUTH_TIMEOUT: 4002,
} as const;
