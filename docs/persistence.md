# State Persistence: Transactions, Dirty Flushing & Crash Recovery

## 1. Objective

Specify the database persistence strategy, including transactional state transitions, periodic in-memory dirty flushing, disconnect handling, and graceful shutdown recovery.

---

## 2. In-Memory Simulation vs Database Writes

Writing to PostgreSQL on every 50ms tick would overwhelm disk I/O. Therefore:
1. **Live State in Memory:** High-frequency changes (position coordinates, ongoing combat hits, dynamic mana regeneration) update in Node.js server heap memory.
2. **Periodic Dirty Flush (60 seconds):** Every 60 seconds, a background worker flushes characters whose attributes, XP, or position have changed.
3. **Immediate Transactional Flush:** Security-critical operations write to PostgreSQL immediately with explicit database transactions:
   - Item trades or drops.
   - Bank storage transfers.
   - Equipment changes.
   - Character level-ups.
   - Player disconnect / zone exit.

---

## 3. Disconnect Handling & Graceful Shutdown

### 3.1 Player Disconnect Flow
```
[ Player Closes Browser / Drops Connection ]
                    |
                    v
[ Server Detects Socket Close Event ]
                    |
                    v
[ Mark Character as "Pending Despawn" (15s grace window) ]
                    |
                    v
[ Execute Flush Character Query to PostgreSQL ]
                    |
                    v
[ Broadcast SC_ENTITY_DESPAWN to Nearby Players ]
```

### 3.2 Server Graceful Shutdown Flow
```typescript
process.on('SIGTERM', async () => {
  console.log('[*] SIGTERM received. Initiating graceful shutdown...');
  // 1. Stop accepting new WebSocket connections
  gateway.close();
  // 2. Flush all currently active characters to PostgreSQL
  const flushPromises = Array.from(world.getActiveCharacters()).map(char =>
    characterRepo.saveCharacter(char)
  );
  await Promise.all(flushPromises);
  // 3. Close database connection pool
  await dbPool.end();
  console.log('[+] Graceful shutdown complete. Exiting.');
  process.exit(0);
});
```
