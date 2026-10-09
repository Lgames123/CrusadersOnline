# Threat Model: Attack Surface Enumeration & Mitigations

## 1. System Threat Model (STRIDE)

| Threat Category | Target Subsystem | Attack Scenario | Implemented Mitigation |
|---|---|---|---|
| **Spoofing** | WebSocket Gateway | Player connects claiming to be another player's entity | Single-use WS ticket bound to a server-side session; character ownership checked on `CS_SELECT_CHARACTER` |
| **Tampering** | Movement / Combat | Client modifies coordinates or injects false hit confirmations | Client sends inputs only; server simulates movement and resolves hits with Rapier queries |
| **Repudiation** | Trade / Inventory | Player claims items were lost or denies transferring currency | All inventory mutations logged in PostgreSQL transaction audit ledger |
| **Information Disclosure** | World Interest | Radar cheats reading entire zone enemy and player locations | Spatial Hash Interest Management sends only entities within 64m |
| **Denial of Service** | Network Gateway | Malicious socket flood consuming server CPU/memory | Rate limiting, connection limits per IP, payload size limit (max 4KB) |
| **Elevation of Privilege** | Administrative Commands | Normal player sends admin kick/ban/spawn packets | Server validates `is_admin = TRUE` claim directly against database |

---

## 2. Trust Boundaries

1. **Boundary 1: Internet to WebSocket Gateway**
   - Untrusted -> DMZ. TLS termination via Caddy.
2. **Boundary 2: Gateway to World Simulation**
   - Binary hot-path packets structurally decoded (length, ranges, finite values); control packets validated via Zod schemas — both before touching game logic.
3. **Boundary 3: World Simulation to PostgreSQL**
   - Isolated private network. Kysely (parameterized) queries only.
