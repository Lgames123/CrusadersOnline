# MMORPG Architecture: Server-Authoritative Simulation & Topology

## 1. System Topology & Service Boundaries

CrusadersOnline is structured as a **High-Performance Modular Monolith** designed for low operational overhead and simple local deployment, while retaining clean boundaries for horizontal zone scaling.

```
                         [ Internet / Web Clients ]
                                      |
                         +------------v------------+
                         |  Reverse Proxy (Caddy)  |
                         |  - SSL / TLS 1.3        |
                         |  - Static Assets Cache  |
                         +------------+------------+
                                      |
                     +----------------+----------------+
                     | (HTTP /api/*)                   | (WSS /ws/*)
                     v                                 v
         +-----------------------+         +-----------------------+
         | Auth & REST Gateway   |         | Game Server Gateway   |
         | - Account Login/Reg   |         | - WebSocket Sessions  |
         | - Session Cookie      |         | - WS Ticket Redeem    |
         | - WS Ticket Issuance  |         | - Heartbeat & Ping    |
         +-----------+-----------+         +-----------+-----------+
                     |                                 |
                     +----------------+----------------+
                                      |
                                      v
         +---------------------------------------------------------+
         | ZONE WORKERS (one worker_thread per zone, 20Hz loop)    |
         | - Spatial Hash Grid (32x32m Cells)                      |
         | - Input-Driven Movement (shared Rapier controller)      |
         | - Melee Combat Hit Queries & Damage Calculation         |
         | - Monster AI State Machines & Aggro Threat Tables       |
         | - Dirty State Periodic Flush (60s Interval)             |
         +----------------------------+----------------------------+
                                      |
                                      v
         +---------------------------------------------------------+
         | POSTGRESQL 18 PERSISTENCE ENGINE (Kysely)               |
         | - Accounts & Characters                                 |
         | - Equipment & Inventory Items (Row-Level Locking)       |
         | - Zone Persistence & Progression Flags                  |
         +---------------------------------------------------------+
```

---

## 2. Server-Authoritative Principles

1. **The Client Never Dictates Truth:**
   - The client never sends "I hit skeleton #4 for 25 damage". It sends "I swung my sword at tick 1450 facing angle $\theta$".
   - The server computes whether the weapon arc intersected the skeleton's capsule at tick 1450 and applies damage accordingly.
2. **Input-Only Movement (ADR-006):**
   - The client sends only inputs (movement flags, yaw, pitch, client tick) — never positions.
   - The zone worker simulates movement with the shared Rapier character controller; the resulting position is the only truth.
   - The client predicts locally with the same code and reconciles against `lastProcessedInput` in each snapshot.
3. **Transactional Inventory Mutations:**
   - All equipment changes, item pickups, and trades execute with PostgreSQL row-level locks to prevent race conditions or item duplication.
