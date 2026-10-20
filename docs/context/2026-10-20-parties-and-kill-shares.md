# MMO Stage 2: parties and shared kills

Date: 2026-10-20 · Agent: Claude Code · Commit: Parties of five and kills shared by contribution (MMO Stage 2)

## Why
MMO roadmap Stage 2 (docs/game-design/mmo/02, 11): players fighting the same creature should
share it fairly. It needs a party system.

## Decisions and evidence
- **Parties** (`server/src/network/parties.ts`, main thread, in memory):
  - up to 5 members, the leader first; an invitation lapses after 60 s;
  - leaving or disconnecting passes the lead on, and a member left alone disbands it;
  - CS_PARTY 0x18 (invite / accept / decline / leave / kick / promote) and SC_PARTY_UPDATE 0x55
    (members with leader and zone, `self`, a pending `invite`);
  - zones learn a player's party through `JoinOptions.party` and `setParty`.
- **Kill shares** (`shared/src/game/rewards.ts`, `shareKill`), always on:
  - contribution = damage dealt with overkill clamped; an ally's blows count for its owner;
  - only players active in the last 12 s and within 40 m count;
  - a party's members add up; a group with 5 % or more qualifies, and in a qualifying party
    every active member within 30 m qualifies too;
  - XP = base × share, or for a party base × (1 + 0.1 (n − 1)) × share split by n, at least 1;
    gold follows the same split;
  - every qualifying player gets his own items (the archetype's rolls or the placement's
    carried items, on the ground for him alone) **and his own death trigger**, so story kills
    count for each.
  - Alone, the result equals the old killer-only reward. If nobody qualifies, the killer gets it.
- Client:
  - chat tab "Party", `/p`, `/invite`, `/accept`, `/decline`, `/leave`, `/kick`, `/promote`;
  - a party frame under the classic HUD, with a health bar when the member is seen in this
    zone and his act otherwise; clicking a name whispers him.

## Deviations from the original
- All of it is MMO (the original is single player). The design's level dampening of XP
  (02 §5.3) is **not** applied, so XP stays the original's.

## Not done / not decoded
- Absorbed damage, healing and crowd control are not part of the contribution (02 §3.2 weights).
  There is no line-of-sight check at the death.
- Parties are not saved and do not survive a server restart.

## How to verify
- `pnpm test:unit kill_share` (shares, parties, a two-player kill in the zone).
- Live: two guests on spells-server, `session.party('invite', 'Guest001')` then
  `party('accept')`. The frame shows the other member with health, and the classic message line
  says "Guest001 joins the party." (checked).
