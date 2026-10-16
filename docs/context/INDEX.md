# Context notes

- 2026-10-16 [Inventory item looks and future slots](2026-10-16-inventory-item-looks-and-slots.md) — potion colours from models.ctx Texture lists, models for keys/crystals/quest items, shields posed front, empty-alpha textures opaque, 8×6 paper doll with placeholders (Claude Code)
- 2026-10-16 [MU-style inventory window and inventory authority](2026-10-16-inventory-mu-window-and-authority.md) — one bottom-right window (equipment over bag), Ctrl+G ground window, drag from worn slots, stale-slot/cutscene/full-chest guards with resync (Claude Code)
- 2026-10-16 [Exit crossings and arrivals as the original](2026-10-16-exit-arrival-as-original.md) — decoded entry point + crossing offset with heading kept, body-vs-volume test, original Citadel stair volumes, script-only act changes (Claude Code)
- 2026-10-15 [Zone transfer continuity and collision mesh connectivity](2026-10-15-zone-transfer-continuity-and-connectivity.md) — starts-by-exit removed, shared-frame yaw preservation, and BFS connectivity interior arrival (Antigravity)
- 2026-10-15 [Zone transfer arrival positioning and facing synchronization](2026-10-15-zone-transfer-arrival-and-facing.md) — Cap start dispatch, geometric interior derivation, and yaw sync preventing portal bounce loops (Antigravity)
- 2026-10-14 [Citadel portal network transition fixes](2026-10-14-citadel-portal-network-fixes.md) — restored gate volumes, staircase ascending trigger bounds, closest-floor arrival selection without bounces (Antigravity)
- 2026-10-14 [Inventory grid modernization](2026-10-14-inventory-grid-modernization.md) — resolved item shapes, 8×6 grid, migration 005, authoritative moves/drops, dynamic world loot and three panels (Codex & Antigravity)

One line per note, newest first: `- YYYY-MM-DD [title](file.md) — one-line hook (agent)`. Each commit adds its note here (rule in `AGENTS.md`). Notes are shared by every agent: read them whoever wrote them.

- 2026-10-14 [Starter loadout and cutscene equipment synchronization](2026-10-14-starter-loadout-and-cutscene-sync.md) — default to long sword and wooden shield, defer cutscene outfit changes (Antigravity)
- 2026-10-14 [Default to login screen on page refresh](2026-10-14-default-login-screen.md) — always default to fe-login-screen on page reload and allow entering with active session (Antigravity)
- 2026-10-14 [Project skills for Antigravity (and every agent)](2026-10-14-agent-skills.md) — .agent/skills procedures, Ghidra headless scripts in tools/re/ghidra (Claude Code)
- 2026-10-14 [Enhanced lighting, level textures, brush movers, Ursan's scene; agent rules](2026-10-14-lighting-textures-movers-cutscenes.md) — 15-unit texture scale, v from bottom, decompiled movers and relays, staged cutscenes, what is still undecoded (Claude Code)
