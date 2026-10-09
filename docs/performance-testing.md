# Performance Testing: Benchmarks, Tick Latency & Bot Swarms

## 1. Objective

Provide automated load-testing tools and benchmarks to verify that the authoritative server sustains a stable 20 Hz simulation tick under concurrent player loads.

---

## 2. Bot Swarm Architecture (`tools/bot_swarm.ts`)

A headless WebSocket bot generator connects multiple simulated clients that authenticate with a WS ticket and emit **binary input frames** using the shared codec — the same packets a real client sends (inputs only, no positions):
```typescript
import WebSocket from 'ws';
import { encodeInput, type InputFrame } from '@crusaders/shared/protocol/binary';

export async function spawnBotSwarm(count: number, serverUrl: string, getTicket: () => Promise<string>): Promise<void> {
  for (let i = 0; i < count; i++) {
    const ws = new WebSocket(serverUrl);
    const buf = new DataView(new ArrayBuffer(64));
    const frame: InputFrame = { clientTick: 0, flags: 0b0001 /* W */, yaw: 0, pitch: 0 };
    let ackTick = 0;

    ws.on('open', async () => {
      ws.send(JSON.stringify({ op: 0x01, seq: 0, d: { ticket: await getTicket() } }));
      setInterval(() => {
        frame.clientTick++;
        frame.yaw = (frame.yaw + 0.05) % (Math.PI * 2); // walk in circles
        const len = encodeInput(buf, ackTick, [frame]);
        ws.send(new Uint8Array(buf.buffer, 0, len));
      }, 50);
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) ackTick = new DataView((data as Buffer).buffer, (data as Buffer).byteOffset).getUint32(1, true);
    });
  }
}
```

---

## 3. Benchmarking Metrics & Acceptance Targets

Figures below are **targets**, not measurements, until the bot swarm exists.

| Concurrency Level | Target Tick Latency | Max P99 Tick Latency | Network Out per Client |
|---|---|---|---|
| **10 Players** | < 2.0 ms | < 5.0 ms | < 2.5 KB/s |
| **50 Players** | < 5.0 ms | < 12.0 ms | < 4.0 KB/s |
| **100 Players** | < 10.0 ms | < 20.0 ms | < 5.0 KB/s |
| **200 Players** | < 18.0 ms | < 35.0 ms | < 6.5 KB/s |

Any tick duration exceeding 45.0 ms triggers a server alarm, indicating that spatial hash partitioning or vector pooling optimizations must be investigated.
