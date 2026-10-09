# Asset Licensing, Intellectual Property & Distribution Policy

## 1. Non-Negotiable Core Principle: Zero-IP Distribution

This project adheres to a strict clean-room policy modeled after landmark game preservation projects (such as OpenMW, Daggerfall Unity, and ScummVM):

1. **The Codebase is 100% Free & Open Source:** All TypeScript code, shader programs, math libraries, database schemas, and documentation are original works created without copying decompiled proprietary machine code.
2. **Zero Proprietary Data in the Repository:** Under no circumstances will 3DO or Ubisoft copyrighted game assets (including but not limited to 3D meshes, textures, sound effects, musical scores, video cutscenes, or level geometry) be hosted on GitHub, committed to Git, or bundled into public Docker containers.
3. **User-Fed Asset Model:** The game engine is an independent executable player. Players must furnish their own legally obtained copy of *Crusaders of Might and Magic* (e.g. from GOG.com) to experience the original audio and visual presentation.

---

## 2. Technical Safeguards Enforcing Compliance

### 2.1 Git Repository Protection
- `.gitignore` explicitly filters out all game binaries, `.zip`, `.mdl`, `.msh`, `.ctx`, `.ani`, `.mp3`, `.wav`, and the `local/` tree.
- Automated CI scripts fail the build if any staged file exceeds 1 MB or matches binary game signatures.

### 2.2 Client-Side Synthetic Default Mode
- When launched without user-fed assets, the browser client runs in **Synthetic Mode**.
- Synthetic Mode renders procedural greybox arenas, geometric avatars (capsules, mannequins), and procedural Web Audio synthesized sounds.
- This ensures full playability, testing, and continuous integration without requiring any copyrighted data.

### 2.3 Local-Only Converter & File System Access API
- When a user imports their GOG game directory, the assets are either:
  1. Converted locally on their machine using `pnpm convert` (the TypeScript converter CLI) into their private `local/generated/` folder.
  2. Selected via the browser's native File System Access API (`showDirectoryPicker()`), converted in a Web Worker by the same converter code, and cached locally in the browser's **IndexedDB / Origin Private File System (OPFS)**.
- **Assets are NEVER uploaded to the game server or shared with other connected players.**

---

## 3. Multiplayer Content Boundary

In multiplayer sessions:
- The authoritative game server synchronizes **purely numerical state vectors**: Entity ID, X/Y/Z position, yaw, pitch, animation state integer, health integer, equipment slot IDs.
- Each client visualizes this numerical state using whatever local asset pack they possess (either synthetic placeholders or their locally imported original assets).
- Player A can never transmit copyrighted textures or audio to Player B over the network.
