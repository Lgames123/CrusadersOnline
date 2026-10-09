# Milestone 07: Persistent Character Progression & Database

## 1. Objective
Integrate PostgreSQL persistence for accounts, sessions, characters, attributes and inventory with atomic transactions and graceful shutdown flushes.

## 2. Prerequisites
- Milestone 06 complete.
- PostgreSQL 18 (17 minimum) available locally or in Docker.

## 3. Implementation Steps
1. Write plain-SQL migrations (`001_initial_schema.sql`, including `sessions`) applied by the Kysely migrator (`pnpm db:migrate`).
2. Implement `server/src/persistence/` repositories with Kysely (transactions, `.forUpdate()` row locks for inventory).
3. Hook periodic dirty-state flushes (60s) and immediate disconnect save handlers.
4. Implement auth (ADR-008): argon2id hashing, opaque session cookie, `POST /api/ws-ticket` single-use tickets, rate limits.

## 4. Acceptance Criteria
- [ ] Registration and login set a server-side session cookie; logout revokes it.
- [ ] WebSocket tickets are single-use and expire after 30 seconds.
- [ ] Character XP, gold, and equipment changes survive server restarts.
- [ ] Concurrent duplicate-item attempts fail (integration test against real PostgreSQL).
- [ ] Graceful shutdown flushes all active characters cleanly.
