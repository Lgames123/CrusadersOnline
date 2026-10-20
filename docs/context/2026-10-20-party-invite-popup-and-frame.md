# Party invitation popup and an MMO-style party frame

Date: 2026-10-20 · Agent: Claude Code · Commit: Party invitation popup; party frame with level, health and mana from any zone

## Why
The user asked for an Accept/Decline popup on party invitations and a standard MMO party
window with health bars.

## Decisions and evidence
- **Popup** (`PartyInvite`, party_frame.ts): opens on SC_PARTY_UPDATE with `invite`. It shows a
  countdown bar from the new `inviteSeconds` (the server's INVITE_MS, 60 s) and closes when it
  lapses. It frees the mouse like the dungeon ready check. It also closes when /accept or
  /decline is typed, or when a non-empty party update arrives.
- **Vitals**: each zone worker posts `{t:'vitals'}` every 10 ticks (0.5 s), but only for players
  with a party (`WorldZone.partyVitals`). The main thread (`SessionManager.onVitals`) keeps the
  last value per connection and resends PARTY_UPDATE to a party only when a member's numbers
  change. That resend is frame-only: it skips the zone `setParty` post.
- **PartyMemberView** gains optional `level / hp / maxHp / mana / maxMana / dead`. The frame
  shows server numbers in any zone. While the member is seen in this zone, the health fraction
  comes from the 20 Hz snapshots instead (smoother).
- Frame: a header (Party n/5, Leave), and per member a level badge, the leader's crown, an HP bar
  with "hp / max", a mana bar, and greyed states for dead, away (area name) and offline. HP below
  30 % turns bright red. Left click whispers. Right click opens a menu: Whisper, Make leader and
  Remove (leader only), Leave party.

## Deviations from the original
- All MMO (the original has no parties).

## Gotchas
- PartyFrame.set rebuilds rows only when the names or the leader change, so the vitals resend
  doesn't churn the DOM or close an open menu.
- In the update loop, `seen` (the snapshot fraction) wins over the server's numbers. A member
  out of interest range in the same zone falls back to the server's numbers.

## Not done
- At 800×600 the frame (top under the HUD's mana coin) overlaps the chat box once there are
  3 or more other members. At 1080p it fits.
- No buffs/debuffs on the frame, and no click-to-target (the game has no target frame).

## How to verify
- spells-server + spells-client, two guests: `__co.session.party('invite','Guest002')` in one tab
  shows the popup in the other. Accept → frame shows "18 ♛ Guest001 320 / 320", and mana drops
  after a cast (checked live, as was Decline and Leave from the right-click menu).
