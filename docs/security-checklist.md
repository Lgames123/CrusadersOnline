# Security Checklist: Pre-Deployment Verification

## 1. Authentication & Session Controls
- [ ] Passwords hashed using argon2id (m >= 19 MiB, t >= 2, p = 1).
- [ ] Session IDs are >= 32 random bytes, stored server-side, sent only as `HttpOnly; Secure; SameSite=Strict` cookies.
- [ ] Sessions expire server-side and are revoked on logout, password change and ban.
- [ ] WebSocket tickets are single-use, expire in <= 30 seconds, and never appear in URLs or logs.
- [ ] Login, registration and ticket endpoints are rate-limited per IP and per account.

## 2. Network & Packet Validation
- [ ] WebSocket packet payload sizes clamped to <= 4,096 bytes.
- [ ] Binary hot-path packets rejected on any structural violation; control packets strictly validated against Zod schemas.
- [ ] Connection rate limits enforced (token bucket per IP).
- [ ] Disconnected sockets cleanly pruned from memory.

## 3. Authoritative Gameplay Validation
- [ ] Client protocol carries no position fields; movement simulated server-side; at most one input applied per player per tick.
- [ ] Combat hitboxes and damage calculated exclusively server-side.
- [ ] Enemy aggro tables and loot drops calculated exclusively server-side.
- [ ] Inventory and equipment modifications executed in PostgreSQL transactions with row locks.

## 4. Environment & Secrets Management
- [ ] No secrets or private keys committed to Git (`.gitignore` verified).
- [ ] Database credentials loaded strictly via `.env` environment variables.
- [ ] No proprietary 3DO game files committed to repository.

## 5. Naming & Trademarks (ADR-011)
- [ ] UI strings, page titles, package metadata and public listings use only "CrusadersOnline".
- [ ] No original game title, logos or franchise terms used as branding.
