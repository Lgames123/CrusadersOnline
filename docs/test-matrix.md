# Test Matrix: Feature Coverage & Verification Criteria

## 1. Feature Test Matrix

| Feature | Test Tier | Test Case Description | Pass Criteria |
|---|---|---|---|
| **Vector3 Math** | Unit | Dot, Cross, Distance, Normalize, Lerp | Outputs match IEEE 754 float tolerance |
| **AABB Collision** | Unit | Overlap of moving sphere against static box | Returns true on contact, false on miss |
| **Packet Validation** | Unit | Send invalid opcodes, truncated binary frames, NaN angles, malformed JSON | Binary decoder returns `null`; Zod rejects control payloads |
| **Damage Formula** | Unit | Calculate slash vs target with DR0=0.6 | Output matches `Base * (Might/2) * 0.6` |
| **Kinematic Clamp** | Integration | Send move delta exceeding $6.0 \text{ m/s} \times dt$ | Server rejects move and snaps position |
| **Interest Grid** | Integration | Place entity 100m away from player | Entity omitted from player's snapshot |
| **Multi-Client Sync**| E2E | Connect 2 clients; move Client A | Client B receives updated coordinates |
| **Combat Hit Sync** | E2E | Client A attacks synced Skeleton mob | Mob HP decreases; both clients see effect |
| **DB Persistence** | Integration | Update character XP; restart server | Re-queried character retains updated XP |
| **Graceful Shutdown**| Integration | Send SIGTERM while players connected | DB pool flushes character data cleanly |
