# Side Quests: the complete reference (cut from the original; planned as a feature)

The original's quest manager carries 26 side quests that no shipped act ever offers. Their
records, journal pages, items, reward lists and almost all their voice lines are still on the
disc. This document is the full reference for checking them by hand and for implementing them
later as a **non-original feature** (off by default, `GAME_FEATURES=sideQuests`).

Everything here was read from crusaders.exe's code (headless Ghidra, 2026-10-19 and 2026-10-20)
and the converted data. Lines are summarised, never transcribed: to hear or read a line, look up
its Sound.ctx id in `rules/sounds.json` (field `description`) or play its file (`<file>.MP3`). The
journal pages are `rules/strings.json` ids 3201–3252.

**Sources (crusaders.exe):**

| Routine | What it does |
|---|---|
| `0x4966E0`-area constructor (`0x496770`) | Builds the quest manager: 10 main records at +0 (0x3C bytes each), 26 side records at +0x258 (0x44 bytes), item list A at +0x940 (10 items), item list B at +0xBE8 (8 items). Then calls the two below. |
| `0x497670` | Fills the main and side records (all constants). |
| `0x498AE0` | Names the items of list A (handed over) and list B (rewards). |
| `0x464200` | A quest trigger fires: dispatches its action bits (table below). |
| `0x497170` | Side quest **talk** to the giver (action 0x04). |
| `0x4974A0` | Side quest **item check** at the second NPC or spot (action 0x02). |
| `0x496C60` | Side quest **assign** (action 0x08). |
| `0x496F50` | Side quest **objective done by an event** (action 0x10). |
| `0x496CE0` | Marks a side quest's objective met (checks and takes the item). |
| `0x496DB0` | Completes a side quest: XP and gold, completed list. |
| `0x496FD0` | Adds a side quest's opening or closing journal page (actions 0x01 / 0x20). |
| `0x498C40` | The two special objectives: a healing potion in hand, 5 gold. |
| `0x497600` | Picking up an item tagged with a quest: tag ≥ 100 meets side quest (tag − 100). |

## 1. Why they count as cut

- No shipped placement is a giver. None of the 26 givers or receivers (Nai, Sir Marik, Raven…)
  is placed in any act, no creature's talk line is a side-quest line, and no quest trigger names a
  side quest.
- The records' voice ids are the shipped Sound.ctx id **− 6**. The table was written before six
  sounds were inserted ahead of id 961, and nobody updated it.
- The Duskwood quests' text names and voice names disagree. Text: Brrr'Taaka, Akk'Norr, Q'Kk,
  Rem'Lkk, Nnn'Kiii, Kssk'Lrrr'Vnn, Rrk'Akk'Nn. Recordings: Taki Taki, Nori Doh, Go Banda,
  Nat Ta Ra, Ru Bot's sibling, Had Ra, Dar Ka.
- items.ctx names one quest item `Carved Metal <CUT>`.
- Two journal pairs were never written (`Blah`): quests 14 and 20.
- The records disagree with themselves in places (quest 23 hands over Fain's **Key**; see §6).
- Leftovers in shipped levels:
  - a Cursed Axe lies in Cs1a (not quest-tagged);
  - Durin's Hammer and Fain's Key lie in the training level;
  - citizens' hint lines for the quests (`*_QM_01` / `*_QF_01`) are recorded, but no placement
    uses them.

## 2. How the original runs a side quest (decompiled)

### 2.1 The record (0x44 bytes at manager +0x258 + i × 0x44)

| Offset | Meaning |
|---|---|
| +0x04 | giver's **offer** line (Sound.ctx id − 6) |
| +0x06 / +0x08 | title / giver (string ids) |
| +0x0A / +0x0C | **XP** (25 for all) / **gold**, given on completion |
| +0x0E (16 bits) | **flags**, §2.2 |
| +0x10 | **reward**: slot in list B (0xFF none), given by the giver at completion |
| +0x11 | **handed item**: slot in list A (0xFF none) |
| +0x12 | **required item** name (items.ctx), 32 bytes |
| +0x32 | **state**: low nibble 0 not offered, 1 assigned, 2 objective met, 3 done; 0x10 opening page added, 0x20 closing page added, 0x40 objective met, 0x80 reward given |
| +0x34 / +0x36 / +0x38 | giver's **reminder** / **completion** / **later** lines |
| +0x3A / +0x3C | second NPC's **later** line / line on **delivery** |
| +0x40 | second NPC (receiver or target; string id) |
| +0x42 / +0x43 | **journal pages**: opening / closing, as string 3200 + n. Quest 18 closes on page 12, quest 5's (both destroy a weapon in the Lava Pit). |

### 2.2 Flags (+0x0E), as the code reads them

| Flag | Read by | Effect |
|---|---|---|
| 0x01 | talk | At the offer, the giver **hands over** item A[+0x11] instead of assigning the quest (the quest is then assigned by a trigger's ASSIGN). |
| 0x02 | item check | The second NPC first checks the bag for the required item. If it is missing, he hands over A[+0x11] himself (Nat Ta Ra's cane). |
| 0x04 | objective | Meeting the objective needs the required item in the bag. |
| 0x08 | completion | Completing at the giver needs the required item in the bag. |
| 0x10 | objective / completion | The required item is **taken** when checked. |
| 0x20 | talk while assigned | Objective = a healing potion **in hand**: Lesser Healing (exe name "Invisibility Potion"), Healing or Greater Healing. One is used up. |
| 0x40 | talk while assigned | Objective = **more than 5 gold**. 5 gold are taken. |
| 0x100 | objective | The objective cannot be met before the quest is offered. No record sets it. |

### 2.3 Trigger actions (quest trigger, cap type 0x1D: `0x464200`)

A quest trigger carries an action mask and a quest index; the main bit 0x80 selects a main
quest, otherwise a side one. For a side quest, in this order:

| Bit | Action |
|---|---|
| 0x01 | opening journal page (once) |
| 0x20 | closing journal page (once) |
| 0x02 | **item check** (`0x4974A0`) |
| 0x04 | **talk** to the giver (`0x497170`) |
| 0x08 | **assign** (`0x496C60`): state 0 → 1, into the active list; if the objective was already met, straight to 2 |
| 0x10 | **objective done by an event** (`0x496F50`): if assigned → objective met and completed at once (XP + gold, no item). If never offered → marked done silently. |
| 0x40 | sets a player bit (+0x1C1, bit = trigger +0x36) |

Triggers are walked into, used (Tab), or fired by a creature's death (death triggers). Kill
quests were meant to complete through a death trigger with action 0x10.

### 2.4 Talking to the giver (`0x497170`)

1. **Not offered (state 0):**
   - The offer line plays.
   - Without flag 0x01, the quest is assigned (state 1). If the objective was already met, it
     goes straight to state 2.
   - With flag 0x01, item A[+0x11] is put in the bag and the state does not change.
2. **Assigned (state 1):**
   - The two special objectives are checked first (flags 0x20 / 0x40, §2.2).
   - Objective not met: the reminder plays.
   - Objective met: the state becomes 2, then the giver completes the quest (step 3).
3. **Objective met (state 2):**
   - Completion (`0x496DB0`), which needs the quest in the active list.
   - With flag 0x08, the required item must be in the bag (taken with 0x10).
   - The state becomes 3 and the quest moves to the completed list.
   - XP (+0x0A) and gold (+0x0C) are given.
   - The completion line plays, and reward B[+0x10] goes into the bag.
4. **Done (state 3):** the later line plays. If the 0x80 bit is clear, the reward is given
   again. No routine read sets 0x80, so in the original the reward would come with every later
   talk. Implement it as once.

### 2.5 The item check at the second NPC or spot (`0x4974A0`)

- **Objective not met:**
  - With flag 0x02 and the required item missing, item A[+0x11] is handed over and nothing
    else happens.
  - Otherwise the objective is marked met (`0x496CE0`). Flag 0x04 needs the item and 0x10 takes
    it. If the quest was assigned, it moves to state 2.
  - The delivery line (+0x3C) plays.
- **Objective already met:** the second NPC's later line (+0x3A) plays.

### 2.6 Picking up a quest item (`0x497600`)

A world item whose quest tag (item +0x2C) is 100 or more marks side quest (tag − 100)'s
objective met when picked up. This is how "find X" quests work. No shipped item carries such a
tag.

## 3. The two item lists (`0x498AE0`)

**List A — handed over by a giver or second NPC (+0x11):**

| Slot | Item | items.ctx |
|---|---|---|
| A0 | Ceremonial Sword | weapon, slash 10, permanent |
| A1 | Scout's Message | trinket, permanent |
| A2 | War Plans | trinket, permanent |
| A3 | Cursed Sword | weapon, slash 10, permanent |
| A4 | Birthday Gift | trinket 2×1, permanent |
| A5 | Ancestral Cane | trinket 1×2, permanent |
| A6 | Cursed Axe | weapon, no damage, permanent |
| A7 | Stone Key | usable, permanent |
| A8 | **Fain's Key** | usable (an Ice Key), permanent. Opens the training level's final door. |
| A9 | Durin's Hammer | weapon (slam decal), slash 10, permanent |

**List B — rewards from the giver (+0x10):**

| Slot | Item | items.ctx |
|---|---|---|
| B0 | Healing Potion | heals 10, 100 gold |
| B1 | Brennock's Sword | a plain Long Sword (slash 10), 120 gold |
| B2 | Saurana's Sword | a plain Long Sword (slash 10), 120 gold |
| B3 | Asok's Ring | a Magic Ring with **no** boost, 100 gold |
| B4 | Greater Healing Potion | heals 50, 300 gold |
| B5 | Mana Potion | restores 1000 mana, 200 gold |
| B6 | Speed Potion | +25 speed for 30 s, 200 gold |
| B7 | Reflective Shield | shield that reflects lightning, 800 gold |

The two named swords and the ring have no stats of their own. The lines promise magic ("I sense
the sword has magical properties"), but none was ever set.

## 4. The 26 quests

Regions come from the givers' names and the lines:
- **A** — Citadel knights;
- **B** — Cador Sul villagers;
- **C** — Duskwood Dashers;
- **D** — Corantha dwarves.

Every quest gives **25 XP** on completion. Voice files are named
`<speaker>_M<n><A–D>_01..04`: 01 offer, 02 reminder, 03 completion, 04 later. Ids below are the
shipped Sound.ctx ids (the record's + 6).

Kinds:
- **Deliver**: a handed item goes to a second NPC.
- **Fetch**: a required item is found and brought back.
- **Kill**: completed by an event, a death trigger.
- **Talk**: the second NPC's item check, no item.
- **Special**: §2.2, flags 0x20 / 0x40.

---

### 0 — Ceremonial Sword (A/B, deliver)
- **Giver:** Nai of Cador Sul. **Receiver:** Sir Marik at the Citadel. **Flags** 0x15 (hand
  over, objective needs the item, item taken).
- **Flow:**
  1. Nai hands over the **Ceremonial Sword** (A0).
  2. A trigger assigns the quest.
  3. Talking to Sir Marik with the sword takes it and meets the objective.
  4. Back to Nai: completion.
- **Reward:** 25 XP, **Healing Potion** (B0).
- **Lines:**
  - Nai offers 995 `NA_M1B_01`: her husband gets a medal and forgot his sword.
  - Reminder 996 (she is fighting off beasts at home).
  - Thanks and reward 997.
  - Later 998.
  - Sir Marik on delivery 961 `SM_M1A_01`: he forgot it, and his wife is the fiercer warrior.
- **Journal:** 3201 (offered: a delivery-boy job, he will do it anyway), 3202 (delivered in
  time for the ceremony).

### 1 — Slay Ogre (A, kill)
- **Giver:** Sir Nicholas at the Citadel. **Flags** 0.
- **Flow:**
  1. Offer assigns.
  2. Killing the ogre near his father's farm (by the Stronghold, around Cador Sul) fires the
     objective event.
  3. Back to Nicholas: completion.
- **Reward:** 25 XP, **200 gold**.
- **Lines:** offer 962 `SN_M1A_01` (a bounty on an ogre), reminder 963 (the farms are near the
  Stronghold), completion 964, later 965.
- **Journal:** 3203 / 3204 (the ogre turned to fertiliser).

### 2 — Deliver Raven's Orders (A → C, deliver)
- **Giver:** Sir Jerrod at the Citadel. **Receiver:** Raven the Scout, hidden in Duskwood.
  **Flags** 0x15.
- **Flow:** Jerrod hands over the **Scout's Message** (A1). Raven takes it. Back to Jerrod.
- **Reward:** 25 XP, **150 gold**.
- **Lines:**
  - Offer 966 `SJ_M3A_01`, reminder 967 (lives at stake), completion 968, later 969.
  - Raven on delivery 993 `RA_M10A_03` (he will not let Jerrod down), later 994.
- **Journal:** 3205 / 3206 (found Raven's very tree; report back to Jerrod).

### 3 — Destroy Undead (A, kill)
- **Giver:** Sir Brennock. **Flags** 0.
- **Flow:** Offer assigns. The undead harassing Cador Sul from the Stronghold must be cleared,
  through a death or area trigger with action 0x10. Then back to Brennock.
- **Reward:** 25 XP, **Brennock's Sword** (B1).
- **Lines:** offer 970 `SB_M4A_01`, reminder 971 (the Legion may come out en masse),
  completion 972, later 973.
- **Journal:** 3207 / 3208 (Cador Sul cleansed of the undead).
- **Gap:** the data has no count of undead. Pick a group (for example Ws*a's skeletons outside
  the gates) and fire the event when the last one dies.

### 4 — Deliver Warplans (A, deliver and answer)
- **Giver:** Sir Douglas. **Receiver:** Sir Gaylan, both at the Citadel. **Flags** 0x15.
- **Flow:** Douglas hands over the **War Plans** (A2). Gaylan takes them and answers "hold".
  Back to Douglas.
- **Reward:** 25 XP, **50 gold**.
- **Lines:**
  - Offer 974 `SD_M5A_01` (an attack on bandits), reminder 975, completion 976 (he will rework
    the plans), later 977.
  - Gaylan on delivery 978 `SG_M6A_01` (good plan, bad timing).
- **Journal:** 3209 / 3210.

### 5 — Destroy Cursed Sword (A, destroy at a spot)
- **Giver:** Sir Riechter at the Citadel (journal: Reichter). **Flags** 0x15.
- **Flow:**
  1. Riechter hands over the **Cursed Sword** (A3).
  2. At the **Lava Pit in the Catacombs**, a spot trigger's item check takes the sword and
     meets the objective.
  3. Back to Riechter.
- **Reward:** 25 XP, nothing else.
- **Lines:** offer 979 `SR_M7A_01`, reminder 980, completion 981 (it devours its wielder's
  soul; he hopes you did not use it), later 982.
- **Journal:** 3211 (accepted), 3212 (the pit to the bowels of Ardon; nothing could survive it).
- **Gap:** there is no Lava Pit volume in the data. One must be placed in a Ca*c / Ca*d act.

### 6 — Map Catacombs (A, explore)
- **Giver:** Sir Tallus. **Flags** 0.
- **Flow:** Offer assigns. Mapping the Catacombs = an event trigger (0x10) somewhere deep in
  them. Back to Tallus.
- **Reward:** 25 XP, nothing else.
- **Lines:** offer 983 `ST_M8A_01`, reminder 984, completion 985 (siege tunnels), later 986.
- **Journal:** 3213 / 3214 (more convoluted than the Mad King's labyrinth).
- **Gap:** no item or target. Choose the far end of Ca*d (the way out to the Glaciers).

### 7 — Heal Sick Daughter (B, special)
- **Giver:** Saurana of Cador Sul. **Flags** 0x20.
- **Flow:** Offer assigns. Talking to her again **with a healing potion in hand** (Lesser,
  normal or Greater) uses it up and completes the quest.
- **Reward:** 25 XP, **Saurana's Sword** (B2), her late husband's sword, used for gardening.
- **Lines:** offer 999 `SA_M2B_01`, reminder 1000, completion 1001, later 1002.
- **Journal:** 3215 / 3216.
- **Note:** "in hand" means the selected quick item (`0x46B8E0`). Online, check the bag
  instead, or the hotbar's selected potion.

### 8 — News of Valasek (B → D, talk)
- **Giver:** Mercedes of Cador Sul. **Second NPC:** Valasek, a trader, in Corantha's
  mines / Catacombs (journal: Catacombs). **Flags** 0.
- **Flow:** Offer assigns. Talking to Valasek (item check, no item) meets the objective. Back to
  Mercedes.
- **Reward:** 25 XP, nothing else.
- **Lines:**
  - Offer 1003 `ME_M3B_01`, reminder 1004, completion 1005 (he is alive), later 1006.
  - Valasek 1034 `VA_M11B_01` (he fights for Dain in the civil war), later 1035.
- **Journal:** 3217 / 3218.

### 9 — Avenge Asok (B, kill)
- **Giver:** Asok of Cador Sul. **Flags** 0.
- **Flow:** Offer assigns. Killing **the band of ogres** that took his livestock fires the
  event. Back to Asok.
- **Reward:** 25 XP, **Asok's Ring** (B3), which has no effect in items.ctx.
- **Lines:** offer 1007 `AS_M4B_01` (a cow, two pigs and six chickens), reminder 1008,
  completion 1009, later 1010.
- **Journal:** 3219 / 3220 (the cow bell found in the ogre scat).

### 10 — Help Beggar (B, special)
- **Giver:** Kevin of Cador Sul. **Flags** 0x40.
- **Flow:** Offer assigns. Talking to him again with **more than 5 gold** takes 5 and completes
  the quest.
- **Reward:** 25 XP.
- **Lines:** offer and completion 1011 `KE_M5B_01` (the same line), reminder 1012, later 1013.
- **Journal:** 3221 / 3222.

### 11 — Find Jasmine (B, talk)
- **Giver:** Falkor of Cador Sul. **Second NPC:** Jasmine, near the Stronghold's western gate.
  **Flags** 0.
- **Flow:** Offer assigns. Talking to Jasmine meets the objective; she does not come home. Back
  to Falkor.
- **Reward:** 25 XP.
- **Lines:**
  - Offer 1014 `FA_M6B_01`, reminder 1015, completion 1016 (she must cook his dinner),
    later 1017.
  - Jasmine's line `JA_M6B_01` has no slot in the record.
- **Journal:** 3223 / 3224 (a callous woman).
- **Note:** Jasmine's item-check trigger should play `JA_M6B_01` itself (the record's delivery
  line is empty).

### 12 — Birthday Gift (B → A, deliver)
- **Giver:** Katherine of Cador Sul. **Receiver:** her brother Rayden, training at the Citadel.
  **Flags** 0x15.
- **Flow:** Katherine hands over the **Birthday Gift** (A4, a jerkin). Rayden takes it. Back to
  Katherine.
- **Reward:** 25 XP.
- **Lines:**
  - Offer 1018 `KA_M7B_01`, reminder 1019, completion 1020, later 1021.
  - Rayden on delivery 1036 `RA_M12B_01`, later 1037.
- **Journal:** 3225 / 3226.

### 13 — Find Carved Metal (B, fetch)
- **Giver:** Callub of Cador Sul, a metallurgist. **Flags** 0x18 (completion needs the item,
  taken).
- **Flow:**
  1. Offer assigns.
  2. Picking up the **Carved Metal** in the Glaciers (an item tagged 113) meets the objective.
  3. Back to Callub with it.
- **Reward:** 25 XP, **1000 gold**.
- **Lines:** offer 1022 `CA_M8B_01`, reminder 1023, completion 1024, later 1025.
- **Journal:** 3227 (accepted), 3228 (a strange structure in the ice; its carved metal door
  taken).
- **Gap:** the item (`Carved Metal <CUT>`) is placed nowhere. Place it in a Gl*c ice tunnel.

### 14 — Family Sword (B, fetch)
- **Giver:** Sable of Cador Sul. **Flags** 0x18.
- **Flow:** Offer assigns. Pick up the **Family Tree Sword** (tag 114), lost with her father in
  the Stronghold. Bring it back.
- **Reward:** 25 XP, **20 gold**.
- **Lines:** offer 1026 `SA_M9B_01`, reminder 1027, completion 1028, later 1029.
- **Journal:** pages 29 / 30 were never written (`Blah`).
- **Gap:** the sword (slash 5 + bash 5) is placed nowhere. Place it in a Ws*a.

### 15 — Hammer of Bolga (B, fetch for information)
- **Giver:** Scott of Cador Sul. In the journal he is Gregerron, a spell dealer; the voice files
  are `GA_M10B`. **Flags** 0x18.
- **Flow:** Offer assigns. Pick up the **Hammer of Bolga** (tag 115) in Duskwood. Bring it
  back; he keeps it.
- **Reward:** 25 XP and **information**: a lightning spell is hidden in Corantha's mines.
- **Lines:** offer 1030 `GA_M10B_01`, reminder 1031, completion 1032 (the lightning spell),
  later 1033.
- **Journal:** 3231 / 3232.
- **Gap:** the hammer (bash 20) is placed nowhere. The "information" could be a map marker on
  the lightning spellbook.

### 16 — Slay Akk'Norr (C, kill)
- **Giver:** Brrr'Taaka of Duskwood (voice: Taki Taki). **Target:** Akk'Norr at the Catacombs
  (voice: Nori Doh). **Flags** 0.
- **Flow:**
  1. Offer assigns.
  2. Meeting Akk'Norr (item check) plays his line, and he attacks.
  3. His death fires the event.
  4. Back to the giver.
- **Reward:** 25 XP.
- **Lines:**
  - Offer 1038 `TT_M01C_01`, reminder 1039, completion 1040, later 1041.
  - Akk'Norr 1042 `ND_M02C_01` (another of Taki Taki's assassins).
- **Journal:** 3233 / 3234.
- **Note:** before the Necklace (Dasher speech) these Dashers should not talk. That is a design
  choice; the original has no such check.

### 17 — Ancestral Cane (C, fetch from an NPC)
- **Giver:** Q'Kk of Duskwood (voice: Go Banda). **Holder:** Rem'Lkk of Duskwood (voice:
  Nat Ta Ra). **Flags** 0x1A (bag check at the holder, completion needs the item, taken).
- **Flow:**
  1. Offer assigns.
  2. At Rem'Lkk the bag check finds no cane, so he **hands over the Ancestral Cane** (A5).
  3. Talking to him again meets the objective and plays his line.
  4. Back to Q'Kk with the cane.
- **Reward:** 25 XP.
- **Lines:**
  - Offer 1043 `GB_M03C_01`, reminder 1044, completion 1045, later 1046.
  - Nat Ta Ra 1048 `NTR_M04C_02`. 1047 `NTR_M04C_01` exists but has no slot.
- **Journal:** 3235 / 3236 (the easiest task ever).

### 18 — Destroy Cursed Dwarven Weapon (C, destroy at a spot)
- **Giver:** Nnn'Kiii of Duskwood (Ru Bot's sibling). **Flags** 0x15.
- **Flow:** Nnn'Kiii hands over the **Cursed Axe** (A6). Throw it in the Catacombs' **Lava
  Pit** (spot item check, as quest 5). Back to the giver.
- **Reward:** 25 XP.
- **Lines:** offer 1049 `RT_M05C_01`, reminder 1050, completion 1051, later 1052.
- **Journal:** opening page 37 (3237), closing page **12** (3212: the pit, shared with quest 5).
  Page 38 is empty.
- **Note:** a Cursed Axe already lies in Cs1a (untagged), a leftover.

### 19 — Vr'Tak Totem (C, fetch)
- **Giver:** Xuk'Norr of Duskwood. **Flags** 0x18.
- **Flow:** Offer assigns. Pick up the **Dasher Totem** (tag 119) "near the human
  settlements", around Cador Sul. Bring it back.
- **Reward:** 25 XP, **Greater Healing Potion** (B4).
- **Lines:** offer 1053 `ST_M06C_01`, reminder 1054, completion 1055, later 1056.
- **Journal:** 3239 / 3240 (found while sweeping Cador Sul's outskirts).
- **Gap:** the totem is placed nowhere. Place it in a Cs*a or Ws*a.

### 20 — Magic Spell (C, talk for information)
- **Giver:** Kssk'Lrrr'Vnn of Duskwood (voice: Had Ra). **Second NPC:** Rrk'Akk'Nn of
  Duskwood (voice: Dar Ka). **Flags** 0.
- **Flow:** Offer assigns. Dar Ka tells where the spell is. Back to Had Ra.
- **Reward:** 25 XP and **information**: the Spellbook of Lightning is in the Eastern
  Stronghold.
- **Lines:**
  - Offer 1057 `HR_M07C_01`, reminder 1058, completion 1059, later 1060.
  - Dar Ka 1062 `DK_M08C_02`. 1061 `DK_M08C_01` has no slot.
- **Journal:** pages 41 / 42 never written (`Blah`).

### 21 — Dwarven Tome (D, key and fetch)
- **Giver:** Norin of Corantha. **Flags** 0x19 (hand over, completion needs the item, taken).
- **Flow:**
  1. Norin hands over the **Stone Key** (A7).
  2. Using it at a **stone altar deep in the mines** opens a secret room holding the **Dwarven
     Tome** (tag 121; picking it up meets the objective).
  3. Back to Norin with the tome.
- **Reward:** 25 XP, **Mana Potion** (B5).
- **Lines:** offer 1063 `NO_M1D_01`, reminder 1064, completion 1065, later 1066.
- **Journal:** 3243 / 3244.
- **Gap:** no altar or secret room exists in the mines' data. Both must be built (a use trigger
  with the Stone Key opening a brush).

### 22 — Family Shield (D, kill and fetch)
- **Giver:** Belwin of Corantha. **Flags** 0x18.
- **Flow:** Offer assigns. The IronPick **Aginore**, hiding in a glacier cave, drops the
  **Family Shield** (tag 122). Bring it back.
- **Reward:** 25 XP, **1000 gold**.
- **Lines:** offer 1067 `BE_M2D_01`, reminder 1068, completion 1069, later 1070.
- **Journal:** 3245 / 3246 (a hostile dwarf deep in a glacial cave).
- **Gap:** neither Aginore nor the shield is placed. Use an Ironpick Zealot with the shield as
  loot.

### 23 — Fain's Axe (D, deliver)
- **Giver:** Moria of Corantha. **Receiver:** her husband Fain, fighting in the mines.
  **Flags** 0x15.
- **Flow as recorded:**
  1. Moria hands over **A8**, which is **Fain's Key**, not the axe.
  2. Fain's check needs **Fain's Axe** (+0x12), which nothing gives.
  3. As recorded, the quest cannot be finished.
- **Intended:** Moria hands over **Fain's Axe** (slash 15). Fain takes it. Back to Moria.
- **Reward:** 25 XP, **Speed Potion** (B6).
- **Lines:**
  - Offer 1071 `MO_M3D_01`, reminder 1072, completion 1073, later 1074.
  - Fain on delivery 1075 `FA_M4D_01` (his old axe was dull), later 1076.
- **Journal:** 3247 / 3248.

### 24 — Slay Stone Elemental (D, kill)
- **Giver:** Zagan of Corantha. **Flags** 0.
- **Flow:** Offer assigns. Killing the **rampaging stone elemental** in the mines fires the
  event. Back to Zagan.
- **Reward:** 25 XP, **Reflective Shield** (B7). That is the best reward of all 26: it reflects
  lightning.
- **Lines:** offer 1077 `ZA_M5D_01`, reminder 1078, completion 1079, later 1080.
- **Journal:** 3249 / 3250 (worse than the fire elemental of the Caldera of Gatch).
- **Mismatch:** the offer line says he gives a **potion** to help. The record hands nothing over
  (flag 0x01 clear, A slot 0xFF). Give a Speed or Healing potion at the offer if wanted.

### 25 — Durin's Hammer (D → A, deliver)
- **Giver:** Nadia of Corantha, Durin's widow. **Receiver:** Sir Robert at the Citadel.
  **Flags** 0x15.
- **Flow:** Nadia hands over **Durin's Hammer** (A9). Sir Robert takes it. Back to Nadia.
- **Reward:** 25 XP.
- **Lines:**
  - Offer 1081 `NA_M6D_01`, reminder 1082, completion 1083, later 1084.
  - Sir Robert on delivery 1085 `SR_M7D_01` (he will fight in Durin's name), later 1086.
- **Journal:** 3251 / 3252.
- **Note:** Durin's Hammer lies in the training level (a leftover).

### A 27th, without a record
**SR_M9A_01–04**: a Citadel knight asks for a **potion shipment lost in a Duskwood ambush**.
There is no record, item or journal page for it.

## 5. Summary table

| # | Title | Kind | Giver → second | Items | Reward |
|---|---|---|---|---|---|
| 0 | Ceremonial Sword | deliver | Nai → Sir Marik | A0 Ceremonial Sword | Healing Potion |
| 1 | Slay Ogre | kill | Sir Nicholas | — | 200 gold |
| 2 | Deliver Raven's Orders | deliver | Sir Jerrod → Raven | A1 Scout's Message | 150 gold |
| 3 | Destroy Undead | kill | Sir Brennock | — | Brennock's Sword |
| 4 | Deliver Warplans | deliver | Sir Douglas → Sir Gaylan | A2 War Plans | 50 gold |
| 5 | Destroy Cursed Sword | spot | Sir Riechter → Lava Pit | A3 Cursed Sword | — |
| 6 | Map Catacombs | event | Sir Tallus | — | — |
| 7 | Heal Sick Daughter | special | Saurana | a healing potion in hand | Saurana's Sword |
| 8 | News of Valasek | talk | Mercedes → Valasek | — | — |
| 9 | Avenge Asok | kill | Asok | — | Asok's Ring |
| 10 | Help Beggar | special | Kevin | 5 gold | — |
| 11 | Find Jasmine | talk | Falkor → Jasmine | — | — |
| 12 | Birthday Gift | deliver | Katherine → Rayden | A4 Birthday Gift | — |
| 13 | Find Carved Metal | fetch | Callub | Carved Metal (Glaciers) | 1000 gold |
| 14 | Family Sword | fetch | Sable | Family Tree Sword (Stronghold) | 20 gold |
| 15 | Hammer of Bolga | fetch | Scott / Gregerron | Hammer of Bolga (Duskwood) | information |
| 16 | Slay Akk'Norr | kill | Brrr'Taaka → Akk'Norr | — | — |
| 17 | Ancestral Cane | fetch | Q'Kk → Rem'Lkk | A5 Ancestral Cane | — |
| 18 | Destroy Cursed Dwarven Weapon | spot | Nnn'Kiii → Lava Pit | A6 Cursed Axe | — |
| 19 | Vr'Tak Totem | fetch | Xuk'Norr | Dasher Totem (near Cador Sul) | Greater Healing Potion |
| 20 | Magic Spell | talk | Kssk'Lrrr'Vnn → Rrk'Akk'Nn | — | information |
| 21 | Dwarven Tome | key + fetch | Norin | A7 Stone Key → Dwarven Tome | Mana Potion |
| 22 | Family Shield | kill + fetch | Belwin | Family Shield (Aginore) | 1000 gold |
| 23 | Fain's Axe | deliver | Moria → Fain | A8 Fain's **Key** (recorded) / Fain's Axe | Speed Potion |
| 24 | Slay Stone Elemental | kill | Zagan | — | Reflective Shield |
| 25 | Durin's Hammer | deliver | Nadia → Sir Robert | A9 Durin's Hammer | — |

## 6. Inconsistencies to decide when implementing

1. **Quest 23** hands over Fain's Key instead of Fain's Axe and cannot be finished as recorded:
   hand over the axe.
2. **Repeated rewards:** nothing sets the 0x80 "reward given" bit, so each later talk would
   give the reward again: give it once.
3. **Quest 24** promises a potion at the offer that the record does not give.
4. **Quests 14 and 20** have no journal text.
5. **Quest 11** has no slot for Jasmine's line, and quests 17 / 20 each leave one recorded line
   unused.
6. **Flag 0x01 quests** (0, 2, 4, 5, 12, 18, 21, 23, 25) are not assigned by talking: the giver's
   trigger must also carry ASSIGN (0x08), or the quest never shows in the book.
7. **Names:** the text and the voices disagree for the Duskwood quests, quest 15 (Scott in the
   title, Gregerron in the journal) and quest 5 (Riechter / Reichter).
8. **Rewards without stats:** Brennock's Sword, Saurana's Sword and Asok's Ring are plain copies
   of their base items.

## 7. Implementing them (feature, not original)

Already in place:
- `QUEST_ACTION` in `shared/src/game/story.ts` (the same bits as §2.3), per-character story
  flags, the quest book and NPC talk with subtitles.
- Key and quest items.
- Every item of §3 and §4 exists in items.ctx with a model.

Needed:
1. **Records:** a data file of the 26 records, read from `0x497670` / `0x498AE0` by the converter,
   with voice ids corrected by +6.
2. **NPCs:** givers and receivers placed by region (a design choice; the original never placed
   them), using the hint lines `*_QM_01` / `*_QF_01` for citizens nearby.
3. **Triggers:**
   - a talk trigger per giver (TALK | ASSIGN, plus JOURNAL_START);
   - an item check per second NPC or spot (the Lava Pit);
   - death triggers with COMPLETE for the kill quests;
   - quest tags (100 + i) on the items to find.
4. **World additions:** the Lava Pit volume, the mines' altar and secret room, Aginore, and the
   items to place (§4 gaps).
5. **Quest book:** side quests under Assigned / Completed, with their journal pages.
6. **MMO:** state per character, like the main quests. A handed item lost or dropped is handed
   again by the second NPC's check (flag 0x02) or by the giver at state 0.
