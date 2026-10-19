# Side Quests (cut from the original; planned as a feature)

The original's quest manager carries 26 side quests that no shipped act ever offers. Their
records, journal strings, items and most of their voice lines are still on the disc. This
document lists them as the data has them, how the original's code would have run them, and what
implementing them as a **non-original feature** (off by default, `GAME_FEATURES=sideQuests`)
would take.

Sources: the quest manager's constructor `0x497670` (records), the talk handler `0x497170`, the
item check `0x4974A0` (decompiled headless, 2026-10-19), `rules/strings.json` (crusaders.exe string
table, ids 3000–3077), `rules/sounds.json` (Sound.ctx), `rules/items.json` (items.ctx) and the
converted placements of all 84 acts.

## 1. Why they count as cut

- No shipped placement is a giver: none of the 26 givers or receivers (Nai, Sir Marik, Raven, …)
  is placed in any act, no creature has a talk line pointing at a side-quest voice line, and no
  quest trigger (cap type 0x1D) names a side quest (executable-analysis §18).
- The record's voice-line ids lag the shipped Sound.ctx by exactly 6 (the table was written before
  six sounds were inserted ahead of id 961). Nobody fixed them, so the records were no longer in
  use when the game shipped.
- The Duskwood quests' text names and voice names disagree: the text has Brrr'Taaka, Akk'Norr,
  Q'Kk, Rem'Lkk, Nnn'Kiii, Xuk'Norr, Kssk'Lrrr'Vnn, Rrk'Akk'Nn; the recordings say Taki Taki,
  Nori Doh, Go Banda, Nat Ta Ra, Ru Bot's sibling, Had Ra, Dar Ka.
- items.ctx names one of the items `Carved Metal <CUT>`.
- Leftovers in shipped levels: a **Cursed Axe** lies in Cs1a and **Durin's Hammer** in the
  training level (`train`). Citizen hint lines for the quests (`*_QM_01`, `*_QF_01`, e.g. "I have
  seen Sir Marik in the Western area of the Citadel.") are recorded, but no placement uses them.

## 2. How the original runs a side quest

Each record is 0x44 bytes at manager `+0x258 + i × 0x44`:

| Offset | Meaning |
|---|---|
| +0x04 | giver's offer line (Sound.ctx id − 6) |
| +0x06 / +0x08 | title / giver (string ids) |
| +0x0A / +0x0C | XP (25 for all 26) / gold |
| +0x0E | flags (pattern below) |
| +0x10 | reward slot in the list at `[0x608758] + 0xBE8` (0xFF none) |
| +0x11 | slot of the item handed to Drake, list at `[0x608758] + 0x940` (0xFF none) |
| +0x12 | required item name (items.ctx) |
| +0x32 | state: low nibble 0 not offered, 1 assigned, 2 objective met, 3 done; 0x40 objective met, 0x80 reward already given |
| +0x34 / +0x36 / +0x38 | giver's reminder / completion / later-thanks lines |
| +0x3A / +0x3C | second NPC's later line / line on delivery |
| +0x40 | second NPC (receiver or target; string id) |
| +0x42 / +0x43 | two condition ids, numbered 1–52 two per quest. Quest 18 reuses 12, quest 5's id, and both quests destroy an item in the Lava Pit, so these are probably world-event bits. Not traced. |

**Talk to the giver (`0x497170`, quest action 0x04):**

1. **Not offered:** the giver plays the offer line. The quest becomes assigned, or, with flag bit
   0x01, the giver hands the item in slot +0x11 to Drake.
2. **Assigned:** the reminder plays, unless the objective is met (0x40). If it is met, the quest is
   completed (`0x496DB0`), the completion line plays and the reward slot is given.
3. **Done:** the later-thanks line plays. The reward is given only if it wasn't already (0x80).

**Item check (`0x4974A0`, quest action 0x02),** fired at the second NPC or at the target spot:

- If the objective is not met yet: with flag 0x02, the required item is looked for in the bag (by
  name, `0x46C2F0`). If it is missing, slot +0x11 is handed over instead; this is how Nat Ta Ra
  hands over the cane. When the check passes, the objective is marked met (`0x496CE0`) and line
  +0x3C plays.
- If the objective is already met: line +0x3A plays.

**Flags (+0x0E), read from the pattern, not traced:**

| Flag | Seen on |
|---|---|
| 0x01 | an item handed over at the offer |
| 0x02 | a bag check by item name |
| 0x04 | delivery to a second NPC |
| 0x08 | an item to be found in the world |
| 0x10 | an item involved |
| 0x20 | Heal Sick Daughter only (a Healing Potion) |
| 0x40 | Help Beggar only (gold) |

**Not decoded:** who fills the two item lists at `[0x608758] + 0x940 / + 0xBE8`. Only their
readers are in the exe (`0x497215`, `0x497564`, `0x4973AC`, `0x49745B`). The concrete reward items
are therefore unknown. The voice lines say what some of them were (see the table).

## 3. The 26 quests

Regions come from the givers' names and the lines: **A** = Citadel knights (Ci), **B** = Cador
Sul villagers (Cs), **C** = Duskwood Dashers (Du), **D** = Corantha dwarves (Co / mines). All give
25 XP. Gold is from the record. The reward slot is shown as `R#`, and an item handed over is
shown as `H#`.

| # | Title | Giver → receiver / target | What to do (from the lines) | Items | Reward |
|---|---|---|---|---|---|
| 0 | Ceremonial Sword | Nai of Cador Sul → Sir Marik at Citadel | Take her husband's ceremonial sword to him (he's in the Citadel's western area) | H0 Ceremonial Sword | R0 |
| 1 | Slay Ogre | Sir Nicholas at Citadel | Kill the ogre terrorizing his father's farm near the Stronghold | — | 200 gold |
| 2 | Deliver Raven's Orders | Sir Jerrod at Citadel → Raven the Scout | Deliver the orders to Raven, hidden in Duskwood's brush | H1 Scout's Message | 150 gold |
| 3 | Destroy Undead | Sir Brennock | Clear Legion activity outside the Stronghold | — | R1 |
| 4 | Deliver Warplans | Sir Douglas → Sir Gaylan (both at Citadel) | Take the plans to Gaylan (near Celestia's chamber) and bring back his answer | H2 War Plans | 50 gold |
| 5 | Destroy Cursed Sword | Sir Riechter at Citadel | Throw the cursed sword into the Catacombs' Lava Pit | H3 Cursed Sword | — |
| 6 | Map Catacombs | Sir Tallus | Map the Catacombs and report | — | — |
| 7 | Heal Sick Daughter | Saurana of Cador Sul | Bring a Healing Potion | (needs Healing Potion) | R2 ("my husband's sword") |
| 8 | News of Valasek | Mercedes of Cador Sul → Valasek | Find her husband (a trader, in Corantha's mines) and bring news | — | — |
| 9 | Avenge Asok | Asok of Cador Sul | Kill the ogres that took his livestock | — | R3 |
| 10 | Help Beggar | Kevin of Cador Sul | Give him money | (needs gold) | — |
| 11 | Find Jasmine | Falkor of Cador Sul | Find his wife near the Citadel walls / Stronghold (her line: JA_M6B_01) | — | — |
| 12 | Birthday Gift | Katherine of Cador Sul → Rayden at Citadel | Bring her brother the gift (a jerkin; he trains in the training area) | H4 Birthday Gift | — |
| 13 | Find Carved Metal | Callub of Cador Sul | Find a carved metal shard in the Glacier | needs Carved Metal | 1000 gold |
| 14 | Family Sword | Sable of Cador Sul | Recover her father's engraved sword, lost in the Stronghold | needs Family Tree Sword | 20 gold |
| 15 | Hammer of Bolga | Scott of Cador Sul (voice: GA_M10B) | Find the Hammer of Bolga in Duskwood | needs Hammer of Bolga | information: a lightning spell is hidden in Corantha's mines |
| 16 | Slay Akk'Norr | Brrr'Taaka (voice: Taki Taki) → Akk'Norr at Catacombs (Nori Doh) | Kill the one who dishonoured his family | — | — |
| 17 | Ancestral Cane | Q'Kk (Go Banda) → Rem'Lkk (Nat Ta Ra) | Get the cane back from Nat Ta Ra, who hands it over | H5 Ancestral Cane | — |
| 18 | Destroy Cursed Dwarven Weapon | Nnn'Kiii (Ru Bot's sibling) | Throw the cursed axe into the Catacombs' Lava Pit | H6 Cursed Axe | — |
| 19 | Vr'Tak Totem | Xuk'Norr of Duskwood | Find the Vertok totem, lost near the human settlements | needs Dasher Totem | R4 |
| 20 | Magic Spell | Kssk'Lrrr'Vnn (Had Ra) → Rrk'Akk'Nn (Dar Ka) | Ask Dar Ka where the spell is: the Spellbook of Lightning, in the Eastern Stronghold | — | information |
| 21 | Dwarven Tome | Norin of Corantha | Use the stone key at an altar deep in the mines; bring back the tome from the secret room | H7 Stone Key, needs Dwarven Tome | R5 |
| 22 | Family Shield | Belwin of Corantha | Take back the shield the IronPick Aginore stole (he hides in the Glacier) | needs Family Shield | 1000 gold |
| 23 | Fain's Axe | Moria of Corantha → Fain of Corantha | Deliver the new axe to her husband in the mines | H8 Fain's Axe | R6 |
| 24 | Slay Stone Elemental | Zagan of Corantha | Kill the rampaging stone elemental in the mines (he gives a potion at the offer) | — | R7 |
| 25 | Durin's Hammer | Nadia of Corantha → Sir Robert at Citadel | Give Durin's hammer to his friend (near the Citadel entrance) | H9 Durin's Hammer | — |

Voice files: `<speaker>_M<n><A–D>_01..04`, with 01 offer, 02 reminder, 03 completion and
04 later thanks. A receiver has two lines: delivery, then later. Example: `NA_M1B_*` for Nai,
`SM_M1A_01` for Sir Marik's thanks.

Recorded but without a record: **SR_M9A_01–04**, a Citadel knight's "recover the potion shipment
lost in a Duskwood ambush". This would be a 27th quest. Its item and placement are unknown.

## 4. Implementing them (feature, not original)

Already in place:

- `QUEST_ACTION.TALK` (0x04) and `ITEM_CHECK` (0x02) in `shared/src/game/story.ts`, unused.
- Key and quest items: trinkets become `keyItem` once given.
- Per-character story flags.
- NPC talk on Tab, with subtitles.
- All items listed in §3 exist in items.ctx with models.

Needed:

1. **Records.** Convert the 26 records into a data file (converter, from the exe as for
   `strings.json`). Correct the voice ids by +6.
2. **NPCs.** Place the givers and receivers. Their positions are a design choice, since the original
   never placed them; use the regions above. Use the hint lines (`*_QM_01` / `*_QF_01`) as talk
   lines for citizens nearby.
3. **Objectives.** Kill targets (ogre, Akk'Norr / Nori Doh, stone elemental, undead count); a
   Lava Pit volume in the Catacombs that destroys the cursed items; a "mapped" trigger for the
   Catacombs; Jasmine and Valasek as NPCs to find; the world items that are not placed yet
   (Carved Metal, Family Tree Sword, Hammer of Bolga, Dasher Totem, Family Shield, Dwarven Tome
   behind the stone-key altar).
4. **Rewards.** The R0–R7 items are unknown, so pick them (some lines name them, e.g. Saurana's
   "husband's sword"). The two "information" rewards could unlock a map marker for the Spellbook
   of Lightning.
5. **Quest book.** Side quests appear under Assigned and Completed like the main ones. Strings
   are already in `rules/strings.json`.
6. **MMO.** Per-character state, as main quests. Decide whether a giver's item is handed out
   again if it is lost or dropped (the item check already re-hands slot +0x11).

Open questions:

- What fills the two item lists.
- What the condition ids at +0x42 / +0x43 drive.
- Whether bit 0x01 also assigns the quest. The decompiled branch only hands the item over.
- Quest 6's mapping objective has no item or target in the data.
