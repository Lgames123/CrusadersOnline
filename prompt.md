# Master Prompt: Crusaders of Might and Magic — Browser-Based Persistent MMORPG Reconstruction

## 1. Role and Mission

Act as a senior reverse-engineering engineer, game-engine architect, systems programmer, multiplayer networking engineer, browser graphics developer, DevOps engineer, QA engineer, and technical documentation author.

Your mission is to investigate the original **Crusaders of Might and Magic PC game distributed through GOG**, reconstruct its gameplay and engine behavior through a lawful, evidence-driven reverse-engineering process, and design and implement an independent browser-based persistent MMORPG inspired by the original game.

The project is inspired by browser-based game preservation and multiplayer projects such as Daggerfall Online. The objective is not merely to run the original executable in a browser. The goal is to create a maintainable reimplementation of the game's relevant functionality, with a new browser client and a persistent multiplayer server architecture.

The user owns a legitimate copy of the game. The original GOG installer and installed game files are available locally, but their exact paths and contents must be discovered or confirmed by the user.

**Your immediate deliverable is a complete set of detailed Markdown planning and implementation documents.** These documents must be sufficiently precise that a coding LLM or human developer can follow them sequentially to inspect the game, install dependencies, implement the engine, build the browser client and server, and validate the result.

Do not assume that the original game source code is available. Do not assume that the game uses a particular engine, executable format, asset format, scripting language, renderer, or network protocol until evidence supports that conclusion.

Do not fabricate findings from files you have not inspected.

---

## 2. Fundamental Project Requirements

### 2.1 Original game and asset ownership

The user provides their own game files.

Maintain strict separation between:

1. Original game files supplied by the user.
2. Tools used to inspect or convert those files.
3. Generated, non-distributable intermediate files.
4. Newly written engine and game code.
5. Newly created server infrastructure.
6. Publicly distributable project documentation and build scripts.

Never copy original game assets into the source repository by default.

Never commit the original installer, game executables, extracted textures, models, music, dialogue, maps, proprietary libraries, or other copyrighted game content.

The public project must not require the original game files to be present in Git. Instead, it must support a locally configured asset directory and a user-operated asset-import process.

Use a configurable layout such as:

    project/
    ├── docs/
    ├── tools/
    ├── client/
    ├── server/
    ├── shared/
    ├── tests/
    ├── deployment/
    ├── scripts/
    ├── .gitignore
    ├── .env.example
    └── README.md

    local/
    ├── original/
    │   ├── installer/
    │   └── installed/
    ├── extracted/
    └── generated/

Treat `local/` as private, machine-specific data. Ensure it is excluded from version control.

Do not assume the example paths match the user's actual installation. Provide configuration variables, a setup wizard or script, and instructions for the user to supply the paths.

Do not redistribute proprietary game content. Do not bypass DRM, licensing checks, or technical access controls. If a format or protection cannot be accessed through authorized means, document the limitation and request an appropriate user-provided, legally accessible input.

The project should distinguish reverse engineering of observable behavior and file formats from copying original source code or redistributing proprietary content. Flag legal questions that require jurisdiction-specific review rather than assuming ownership resolves every issue.

### 2.2 Intended end product

The final application should support:

- A browser-based 3D game client.
- Reconstructed movement and camera behavior.
- Original gameplay mechanics to the extent they can be verified and implemented.
- Player characters and persistent character progression.
- A shared multiplayer world.
- Server-authoritative combat and world simulation.
- Other players visible in the world.
- Multiplayer interaction and synchronization.
- Persistent player inventory and equipment.
- NPCs, enemies, and combat encounters.
- Item drops, pickups, and loot.
- Character statistics and progression.
- Save/load functionality.
- Authentication and account management.
- Server-side persistence.
- World state and entity persistence.
- Multiple simultaneous players.
- Administrative and operational tooling.
- Automated tests and documented manual testing procedures.

These are target capabilities, not claims that the original game supports each feature in a multiplayer environment. Identify which features exist in the original game, which require adaptation, and which must be designed from scratch.

### 2.3 Preserve the original game's identity

Reconstruct original gameplay behavior wherever evidence supports it.

Document and investigate:

- Player movement and collision.
- Camera behavior.
- Combat mechanics.
- Weapons and attack timing.
- Magic and abilities.
- Character attributes.
- Enemies and AI.
- Damage calculation.
- Health and other resource systems.
- Items and equipment.
- Inventory rules.
- Interactions and pickups.
- NPC behavior.
- Level geometry.
- World navigation.
- Quests and progression, if present.
- Animation state transitions.
- Audio triggers and spatial behavior.
- Menus and HUD behavior.
- Save-game structure and persistence.
- Other mechanics discovered during investigation.

Do not invent original mechanics to fill gaps silently. Label each conclusion as confirmed, strongly inferred, tentative, or unknown.

For every reconstructed mechanic, preserve evidence and document discrepancies.

---

## 3. Technology Selection and Architecture

Do not blindly commit to a programming language before examining the game and evaluating implementation constraints.

Begin by preparing a technology comparison with a recommendation and explicit trade-offs.

Evaluate at least the following:

### 3.1 Backend and simulation

Consider:

- Rust for the authoritative world simulation and network server.
- C++ if compatibility with discovered native libraries, file formats, or existing reverse-engineering tools makes it advantageous.
- TypeScript/Node.js if a unified JavaScript ecosystem materially reduces project complexity.
- Other languages only where there is a concrete engineering justification.

Prefer Rust for the authoritative server if it proves practical for the chosen architecture, but do not treat Rust as mandatory when another option has a demonstrated advantage.

Evaluate:

- Runtime performance.
- Memory safety.
- Concurrency.
- Development speed.
- Ecosystem maturity.
- Networking support.
- Database drivers.
- Serialization.
- Debugging and profiling.
- Build complexity.
- Windows development compatibility.
- Linux server deployment.
- Long-term maintenance.

### 3.2 Browser client

Evaluate:

- TypeScript.
- WebGL2.
- WebGPU where appropriate, including fallback requirements.
- Three.js, Babylon.js, or a suitable lower-level rendering framework.
- Asset-loading and resource-management libraries.
- Animation and skeletal-mesh support.
- Physics and collision libraries.
- WebSocket networking.
- Client-side prediction and interpolation.

Select the smallest reliable technology stack that can support the game's actual graphics and gameplay requirements.

Do not select a rendering framework solely because it is popular. Verify its support for the formats, shaders, lighting, animation, terrain, and rendering features discovered during game analysis.

### 3.3 Database and infrastructure

Evaluate:

- PostgreSQL for accounts and durable character data.
- Redis or an equivalent only when justified by caching, presence, ephemeral state, or distributed coordination needs.
- Docker or Podman for reproducible development and deployment.
- A reverse proxy with TLS termination.
- Structured logging and metrics.
- Automated backups and restoration.
- Database migrations.
- Configuration management and secrets handling.

Begin with a modular monolith or a small number of clearly separated services. Do not introduce microservices, Kubernetes, distributed databases, or complex orchestration without a measured need.

### 3.4 Architecture decision records

Create an architecture decision record for every major technology choice.

Each record must contain:

- Decision.
- Context.
- Alternatives.
- Evaluation criteria.
- Chosen option.
- Reasons for the choice.
- Risks and limitations.
- Migration path if the decision changes.
- Verification method.

---

## 4. Phase One: Repository and Environment Discovery

Before writing game-specific implementation code, inspect the available project environment.

### Required activities

1. Determine the current operating system and development environment.
2. Check installed compilers, runtimes, package managers, graphics tools, and debugging utilities.
3. Identify the user's available CPU, RAM, GPU, and storage constraints where relevant.
4. Determine whether development occurs directly on Windows, inside WSL2, or across both.
5. Identify available disk space for extraction, generated assets, and build outputs.
6. Confirm whether Git is installed and whether the current directory is a Git repository.
7. Locate or request the original GOG installer and installed game directory.
8. Record all environmental assumptions.

The initial setup must work on Windows. If Linux or WSL2 is used for backend development, document the division of responsibilities between environments.

### Deliverables

Create:

- `docs/01-project-overview.md`
- `docs/02-environment-setup.md`
- `docs/03-dependencies.md`
- `docs/04-repository-structure.md`

The dependency guide must list actual required tools, recommended versions or supported version ranges, official download pages, installation commands, verification commands, and troubleshooting steps.

Prefer official sources and package-manager installation instructions. Verify current versions when research tools are available. Never invent package names, command-line flags, or download URLs.

Include separate instructions for PowerShell and Linux shells wherever commands differ.

---

## 5. Phase Two: Game Archaeology and Executable Analysis

Treat the original game as a black-box system whose internal structure must be discovered.

### 5.1 Installation inventory

Build a read-only inventory tool that examines the user-selected installation directory.

It should record:

- Relative file paths.
- File sizes.
- File extensions.
- Cryptographic hashes where useful.
- Candidate executables.
- Dynamic libraries.
- Configuration files.
- Archives and container formats.
- Potential scripts.
- Data files.
- Models and textures.
- Audio files.
- Maps and level data.
- Save files, if supplied by the user.
- Other potentially relevant resources.

Do not modify original files.

Support an exportable JSON or CSV inventory that does not contain file contents.

The tool should detect accidental selection of the wrong directory and explain how the user can correct it.

### 5.2 Executable identification

Determine the executable format and inspect available metadata.

Investigate, as appropriate:

- PE headers and architecture.
- Compiler and linker information.
- Imported and exported symbols.
- Debug symbols.
- Strings and embedded metadata.
- Dependency information.
- Native library dependencies.
- Available debug logs.
- Crash information.
- Relevant binary sections.
- Existing documentation and public technical references.

Identify whether the executable is native, interpreted, virtual-machine-based, or a combination of these.

Use established tools such as Ghidra, x64dbg, Detect It Easy, PE analysis utilities, or equivalent tools only where applicable.

Explain installation and use for the selected tools.

Do not assume that any particular tool will be useful until the executable format and environment have been identified.

### 5.3 Reverse-engineering methodology

Establish a repeatable methodology for understanding game behavior.

Use:

- Static analysis.
- Debugging and dynamic observation.
- Controlled experiments.
- File-format analysis.
- Save-state comparisons.
- Memory inspection where legally and technically appropriate.
- Input/output behavior comparisons.
- Frame-by-frame gameplay observation.
- Public documentation and existing technical research.
- Minimal test cases.

Document how each experiment is performed, what it measures, what results to record, and how those results inform the implementation.

Do not attempt to decompile the entire game indiscriminately. Prioritize the systems necessary to reproduce its behavior.

Create a subsystem dependency graph and identify the minimum playable vertical slice.

### 5.4 Research notebook

Create:

- `docs/reverse-engineering/README.md`
- `docs/reverse-engineering/file-inventory.md`
- `docs/reverse-engineering/executable-analysis.md`
- `docs/reverse-engineering/asset-format-discovery.md`
- `docs/reverse-engineering/runtime-observations.md`
- `docs/reverse-engineering/save-format-analysis.md`
- `docs/reverse-engineering/gameplay-mechanics.md`
- `docs/reverse-engineering/unknowns.md`

Some files may initially contain research procedures and empty evidence tables. Clearly identify them as incomplete instead of presenting unverified conclusions.

For each finding, record the source file or observation, experiment performed, result, confidence level, and next verification step.

---

## 6. Phase Three: Asset Pipeline

Create a user-operated asset pipeline that converts supported original game assets into formats usable by the new engine.

### 6.1 Discovery

Identify the actual asset formats before implementing parsers.

Investigate:

- Texture containers.
- Image formats.
- Mesh and model formats.
- Skeletons and animation data.
- Material definitions.
- Level geometry.
- Collision geometry.
- Terrain data.
- Audio formats.
- Fonts.
- Interface assets.
- Localization and dialogue data.
- Other resources discovered in the installation.

Do not assume that all these categories exist or use a standard format.

### 6.2 Import pipeline

Design a deterministic pipeline:

    User-owned game files
            |
            v
    Read-only inventory
            |
            v
    Format identification
            |
            v
    Supported asset decoders
            |
            v
    Validation and conversion
            |
            v
    Local generated assets
            |
            v
    Browser-compatible resource manifest
            |
            v
    Client asset loader

Implement only the parsers and converters justified by the discovered formats.

For each supported format, document:

- How the format was identified.
- Its known structure.
- Header fields and offsets, where established.
- Endianness and data types.
- Compression.
- Record layout.
- Validation rules.
- Error handling.
- Conversion output.
- Tests and sample fixtures that do not contain proprietary content.

The importer must:

- Never overwrite original files.
- Reject malformed inputs safely.
- Log unsupported formats.
- Report missing dependencies.
- Support repeatable runs.
- Avoid duplicate generated assets.
- Produce a machine-readable manifest.
- Record source hashes and converter versions.
- Support incremental conversion.
- Validate output files.
- Keep proprietary outputs out of Git by default.

Where a format cannot be understood, document the investigation plan and create a placeholder interface rather than inventing a decoder.

### 6.3 Asset privacy and distribution

Provide an explicit separation between public code and private assets.

The public application must not download proprietary assets from a developer-controlled server by default.

Design asset deployment so that users can import their own legally obtained files locally.

Before enabling multiplayer, determine whether each deployment model would expose copyrighted assets to other users. Document the distribution and licensing implications and obtain appropriate legal review where needed.

Create:

- `docs/asset-pipeline.md`
- `docs/asset-formats.md`
- `docs/asset-licensing-and-distribution.md`

---

## 7. Phase Four: Gameplay Reconstruction and Specifications

Before implementing the complete game, produce a structured functional specification.

For every gameplay subsystem, include:

- Original behavior.
- Available evidence.
- Relevant assets and data.
- Dependencies on other subsystems.
- Required engine interfaces.
- Server/client ownership.
- Implementation strategy.
- Test scenarios.
- Unresolved questions.

### 7.1 Core engine systems

Investigate and specify:

1. Main game loop.
2. Time-step and update scheduling.
3. Entity representation.
4. Scene and world loading.
5. Transform hierarchy.
6. Collision detection.
7. Physics and movement.
8. Camera control.
9. Animation state machines.
10. Rendering.
11. Audio.
12. Input handling.
13. Interaction systems.
14. Resource loading and caching.
15. UI and HUD.
16. Configuration and settings.
17. Save-state compatibility requirements.

### 7.2 Gameplay systems

Investigate and specify the original game's relevant systems, including:

- Player movement.
- Attacks and attack timing.
- Weapons and combat.
- Damage calculation.
- Health and resource management.
- Enemies and AI.
- Equipment and inventory.
- Items and pickups.
- Spells and special abilities, if present.
- NPCs and dialogue, if present.
- Quests and progression, if present.
- Level transitions.
- Checkpoints and save/load.
- Death, respawning, and recovery.
- Other discovered mechanics.

Distinguish original features from newly designed MMORPG features.

### 7.3 Data-driven implementation

Prefer data-driven representations where appropriate.

For example, represent supported weapon statistics, enemy parameters, item properties, and combat configuration as structured data instead of scattering hardcoded values throughout the code.

Do not invent numerical values for original mechanics. Mark unknown values explicitly and provide experiments for determining them.

Create:

- `docs/gameplay-specification.md`
- `docs/engine-design.md`
- `docs/gameplay-systems.md`
- `docs/entity-and-data-model.md`
- `docs/implementation-parity-matrix.md`

The parity matrix must track each mechanic as:

- Not investigated.
- Investigating.
- Specified.
- Implemented.
- Tested.
- Verified against original.
- Known discrepancy.
- Intentionally changed for multiplayer.

---

## 8. Phase Five: Browser Rendering and Client

Implement a browser client capable of rendering the reconstructed game.

### 8.1 Initial rendering prototype

Start with the smallest possible scene.

It should demonstrate:

- Application initialization.
- Canvas creation.
- Camera setup.
- Input handling.
- A controllable player representation.
- Basic movement.
- Collision with test geometry.
- A test level.
- Resource loading.
- Browser resizing.
- Error reporting.

Initially use synthetic geometry and generated placeholder assets. Do not make the project depend on successful asset decoding before the rendering framework can be tested.

### 8.2 Rendering implementation

Implement the features justified by the original game:

- Geometry and materials.
- Texture loading.
- Lighting.
- Shadows where feasible.
- Camera movement.
- Animation.
- Scene transitions.
- Level loading.
- UI and HUD.
- Audio.
- Performance profiling.

Establish rendering benchmarks and memory budgets.

Use WebGL2 as a compatibility baseline unless investigation supports another approach. Evaluate WebGPU as an optional enhancement when it materially improves the project.

Do not promise perfect visual fidelity before measuring the original game's rendering requirements.

### 8.3 Client structure

Separate the browser application into clearly defined modules, such as:

- Application bootstrap.
- Renderer.
- Scene manager.
- Input manager.
- Asset manager.
- Entity presentation.
- Animation system.
- Camera controller.
- UI.
- Network client.
- Audio manager.
- Diagnostics.

The browser client must not be the ultimate authority for health, damage, inventory, progression, currency, or other security-sensitive gameplay state.

Create:

- `docs/browser-client.md`
- `docs/rendering-pipeline.md`
- `docs/performance-budget.md`

---

## 9. Phase Six: Persistent MMORPG Architecture

Design the multiplayer system as a separate authoritative simulation connected to the browser client.

### 9.1 Architecture

Use the following conceptual structure, modifying it when research justifies a better approach:

    Browser Client
         |
         | HTTPS / WebSocket
         v
    Gateway / Session Layer
         |
         v
    Authoritative Game Server
         |
         +---- World Simulation
         |
         +---- Combat and AI
         |
         +---- Entity and Inventory Systems
         |
         +---- Persistence Layer
         |
         v
    PostgreSQL

    Optional Redis
    Only if justified by measured requirements

The server owns the authoritative gameplay state.

The client sends player inputs and interaction requests. The server validates those requests, updates the simulation, and sends the resulting state to connected clients.

Never trust client-supplied damage, item rewards, character statistics, positions, currency, or inventory modifications without server-side validation.

### 9.2 Multiplayer networking

Specify and implement:

- WebSocket connection management.
- Protocol versioning.
- Authentication.
- Session lifecycle.
- Player spawn and despawn.
- Movement updates.
- State snapshots.
- Interpolation.
- Optional client prediction and reconciliation.
- Interest management.
- Region or zone membership.
- Entity identifiers.
- Disconnect handling.
- Reconnection.
- Server tick scheduling.
- Message validation.
- Rate limiting.
- Malformed-message handling.
- Backpressure and slow-client behavior.
- Protocol compatibility.

Choose message formats based on measurable needs. JSON is acceptable for initial development; binary serialization may be introduced when justified.

Define message schemas, versioning rules, and validation tests.

### 9.3 World simulation

Implement an authoritative world simulation that can eventually support:

- Player movement and collision.
- NPCs and enemies.
- Combat.
- Item interactions.
- Respawn rules.
- World transitions.
- Persistent character progression.
- Multiplayer visibility.
- World entity lifecycle.
- Appropriate synchronization of shared objects.

Define which world entities are persistent and which are transient.

Determine how enemy health, item drops, respawns, and other shared state behave when multiple players interact with the same entity.

Do not assume the original single-player game has networking concepts. Design those semantics explicitly.

### 9.4 Persistence

Design database schemas and migrations for the features actually implemented.

Likely entities include:

- Accounts.
- Authentication sessions.
- Characters.
- Character attributes.
- Inventory.
- Equipment.
- Character progression.
- World instances or zones.
- Persistent world entities, where necessary.
- Audit events for security-sensitive changes.

Document primary keys, foreign keys, indexes, constraints, transactions, and data ownership.

Use transactional operations for inventory changes, item rewards, currency, and other state where duplication or loss would be harmful.

Implement:

- Database migrations.
- Save and load.
- Reconnection recovery.
- Backup and restore.
- Data integrity checks.
- Schema migration testing.
- Graceful shutdown and persistence flushing.

Do not store passwords in plaintext. Use a suitable password-hashing algorithm or a properly integrated authentication provider.

Create:

- `docs/mmorpg-architecture.md`
- `docs/network-protocol.md`
- `docs/world-simulation.md`
- `docs/database-schema.md`
- `docs/persistence.md`
- `docs/security.md`

---

## 10. Phase Seven: Build a Minimum Playable Vertical Slice

Do not attempt to reconstruct the entire game before testing the architecture.

Define and implement an end-to-end vertical slice containing:

1. Browser application startup.
2. A generated test level.
3. A controllable player.
4. Basic movement and collision.
5. One representative enemy.
6. A minimal combat interaction.
7. Two clients connected to the same server.
8. Server-authoritative movement.
9. Visibility of both players.
10. A basic interaction or combat event.
11. A persistent character record.
12. Disconnect and reconnect.
13. Successful save/load.
14. Automated tests for the implemented behavior.

The initial slice must work without proprietary assets.

Once the complete slice works, begin integrating verified original-game formats and reconstructed mechanics incrementally.

### Acceptance criteria

The vertical slice is not complete until:

- The project builds from a clean checkout.
- Dependencies can be installed from documentation.
- The database initializes from documented migrations.
- The server starts successfully.
- The browser client loads successfully.
- Two independent browser sessions can connect.
- Both clients observe synchronized player movement.
- The server rejects invalid state-changing requests.
- Character data survives a server restart.
- Reconnection restores the expected character state.
- Automated tests pass.
- Errors can be diagnosed using logs.

Provide explicit test commands and expected results for each criterion.

Create `docs/milestones/vertical-slice.md`.

---

## 11. Phase Eight: Complete the Reconstructed Game

After the vertical slice passes, expand the implementation in dependency order.

For every subsystem:

1. Collect original-game evidence.
2. Write or update its specification.
3. Define interfaces and data structures.
4. Implement a small, testable unit.
5. Add unit tests.
6. Add integration tests.
7. Compare behavior against the original where possible.
8. Integrate the feature into the game.
9. Test it in multiplayer.
10. Update documentation and the parity matrix.

Suggested implementation sequence:

1. Engine foundation.
2. File and asset pipeline.
3. World geometry and level loading.
4. Camera, movement, and collision.
5. Animation and player representation.
6. Combat and damage.
7. Enemy AI.
8. Items, equipment, and inventory.
9. Character progression.
10. NPCs, interactions, and dialogue where applicable.
11. Additional original gameplay systems.
12. Persistent world state.
13. Multiplayer edge cases.
14. Performance and operational improvements.

Reorder the sequence if the dependency graph shows that a different order reduces risk.

Maintain a working build after every milestone.

Create a milestone document for each major phase.

---

## 12. Phase Nine: Automated Testing and Validation

Build testing into the project from the beginning.

### 12.1 Unit tests

Test:

- Binary parsers.
- Asset validation.
- Serialization.
- Configuration parsing.
- Movement calculations.
- Collision rules.
- Damage calculations.
- Inventory rules.
- Character progression.
- Protocol validation.
- Database operations.
- Authentication and authorization.

### 12.2 Integration tests

Test:

- Asset import and manifest generation.
- Client-server connection.
- Login and session lifecycle.
- Character creation and loading.
- Movement synchronization.
- Combat resolution.
- Item pickup.
- Inventory persistence.
- Reconnection.
- World transitions.
- Database migrations.
- Server restart recovery.

### 12.3 End-to-end tests

Automate browser tests using a suitable framework such as Playwright.

Cover:

- Initial loading.
- Application errors.
- Login.
- Character selection.
- World entry.
- Movement.
- Interaction.
- Combat.
- Multiplayer visibility.
- Disconnect and reconnect.
- Persistence across reloads.

Use synthetic assets and deterministic test fixtures when testing engine behavior independently of the proprietary game data.

### 12.4 Multiplayer stress tests

Build load-testing tools that can simulate multiple clients.

Measure:

- Concurrent connections.
- Server tick duration.
- Message throughput.
- Latency.
- CPU and memory usage.
- Database load.
- Reconnection storms.
- Entity synchronization costs.
- Behavior under slow or disconnected clients.

Establish targets only after defining the intended initial deployment scale.

### 12.5 Regression testing

Create a regression suite for every bug found.

Where original behavior can be measured, record reproducible test cases and expected outcomes.

Do not label behavior as equivalent to the original unless the comparison has actually been performed.

Create:

- `docs/testing-strategy.md`
- `docs/test-matrix.md`
- `docs/performance-testing.md`
- `docs/known-discrepancies.md`

---

## 13. Phase Ten: Development Environment and Deployment

Document the complete workflow from a clean machine to a running application.

### Development setup

Include:

- Required software.
- Installation steps.
- Environment configuration.
- Asset directory configuration.
- Dependency installation.
- Code generation, if applicable.
- Database initialization.
- Database migrations.
- Development server startup.
- Browser client startup.
- Automated test execution.
- Production build.
- Troubleshooting.

### Windows-specific requirements

Provide copy-paste-ready PowerShell commands wherever practical.

Document any Windows-specific build dependencies.

If WSL2 is recommended for Linux-oriented tooling, explain filesystem placement, path translation, networking, and which commands must run inside Windows versus Linux.

Avoid assuming that commands written for Bash will work in PowerShell.

### Local development

Provide commands to:

- Install dependencies.
- Validate configuration.
- Import assets.
- Run tests.
- Start the database.
- Start the game server.
- Start the browser client.
- Build production artifacts.
- Stop services cleanly.

Provide scripts for repetitive tasks where this improves reliability.

### Production deployment

Document:

- Linux server requirements.
- Reverse proxy configuration.
- TLS.
- Firewall rules.
- Environment variables.
- Secret management.
- Database provisioning.
- Database backups.
- Database restoration.
- Logging.
- Metrics.
- Health checks.
- Graceful shutdown.
- Deployment and rollback.
- Security updates.

Start with a single-host deployment and document a future scaling path.

Do not require public hosting during initial development.

Create:

- `docs/development-workflow.md`
- `docs/deployment.md`
- `docs/operations.md`
- `docs/backup-and-recovery.md`
- `docs/troubleshooting.md`

---

## 14. Phase Eleven: Security and Abuse Prevention

Treat the browser as an untrusted client.

Explicitly address:

- Authentication.
- Authorization.
- Session expiration.
- Password security.
- Input validation.
- Message size limits.
- Rate limiting.
- Replay and duplicate requests.
- Inventory duplication.
- Currency manipulation.
- Combat cheating.
- Movement speed manipulation.
- Teleportation.
- Entity spoofing.
- Unauthorized administrative operations.
- SQL injection.
- Cross-site scripting.
- Cross-site request forgery where applicable.
- Secret leakage.
- Denial-of-service risks.
- Database backup protection.
- Logging of sensitive information.

Define an authoritative server-side validation rule for each security-sensitive mechanic.

Use property-based or fuzz testing for parsers, protocol messages, and other complex input surfaces when appropriate.

Never include credentials or secrets in source control.

Document a threat model and a prioritized security checklist.

Create `docs/threat-model.md` and `docs/security-checklist.md`.

---

## 15. Required Documentation Deliverables

Produce a coherent documentation repository under `docs/`.

At minimum, include:

    docs/
    ├── README.md
    ├── 01-project-overview.md
    ├── 02-environment-setup.md
    ├── 03-dependencies.md
    ├── 04-repository-structure.md
    ├── technology-decisions.md
    ├── project-roadmap.md
    ├── implementation-backlog.md
    ├── risk-register.md
    ├── gameplay-specification.md
    ├── engine-design.md
    ├── gameplay-systems.md
    ├── entity-and-data-model.md
    ├── implementation-parity-matrix.md
    ├── asset-pipeline.md
    ├── asset-formats.md
    ├── asset-licensing-and-distribution.md
    ├── browser-client.md
    ├── rendering-pipeline.md
    ├── performance-budget.md
    ├── mmorpg-architecture.md
    ├── network-protocol.md
    ├── world-simulation.md
    ├── database-schema.md
    ├── persistence.md
    ├── security.md
    ├── threat-model.md
    ├── security-checklist.md
    ├── testing-strategy.md
    ├── test-matrix.md
    ├── performance-testing.md
    ├── known-discrepancies.md
    ├── development-workflow.md
    ├── deployment.md
    ├── operations.md
    ├── backup-and-recovery.md
    ├── troubleshooting.md
    ├── reverse-engineering/
    │   ├── README.md
    │   ├── file-inventory.md
    │   ├── executable-analysis.md
    │   ├── asset-format-discovery.md
    │   ├── runtime-observations.md
    │   ├── save-format-analysis.md
    │   ├── gameplay-mechanics.md
    │   └── unknowns.md
    └── milestones/
        ├── 00-discovery.md
        ├── 01-environment.md
        ├── 02-game-archaeology.md
        ├── 03-asset-pipeline.md
        ├── 04-engine-foundation.md
        ├── 05-browser-prototype.md
        ├── 06-multiplayer-server.md
        ├── 07-persistent-characters.md
        ├── 08-vertical-slice.md
        ├── 09-gameplay-reconstruction.md
        ├── 10-testing-and-performance.md
        └── 11-production-deployment.md

You may add, merge, or rename files when necessary, but retain the same coverage and ensure all links between documents are correct.

Do not generate dozens of shallow documents simply to satisfy the list. Each document must have a clear purpose, substantial useful content, and references to related documents.

---

## 16. Mandatory Format for Implementation Instructions

Every implementation-oriented Markdown document must follow a consistent structure.

### Objective

Explain what will be achieved and why it matters.

### Prerequisites

List the exact software, previous milestones, input files, and environment requirements.

### Investigation

Describe what must be inspected or measured before implementation.

### Design

Specify architecture, interfaces, data structures, dependencies, and important trade-offs.

### Implementation steps

Give a numbered sequence of concrete tasks.

For commands:

- State the shell in which the command runs.
- State the expected working directory.
- Explain required environment variables.
- Explain what the command does.
- Provide expected output or verification criteria.
- Explain common failure modes.

For code:

- Identify the target file path.
- Explain its responsibility.
- Define interfaces and error-handling expectations.
- Include complete code for small foundational files when sufficient information exists.
- For larger features, provide detailed implementation requirements and acceptance criteria.

Never claim that a file has been created or a command has been executed unless that action actually occurred.

### Testing

List unit, integration, manual, and regression tests as appropriate.

Include commands and expected results.

### Acceptance criteria

Provide objective pass/fail conditions.

### Troubleshooting

Document likely failures and specific diagnostic procedures.

### Dependencies and next steps

Identify upstream and downstream tasks, and explain what must be completed before the next milestone can start.

### Evidence and confidence

For game-specific conclusions, distinguish verified observations from assumptions and hypotheses.

---

## 17. Project Management and Dependency Tracking

Maintain a single source of truth for project status.

Create `docs/implementation-backlog.md` with:

- Task ID.
- Description.
- Priority.
- Dependencies.
- Estimated complexity.
- Risks.
- Acceptance criteria.
- Test requirements.
- Status.
- Relevant documentation.
- Relevant source files.

Use statuses such as:

- BLOCKED.
- NOT STARTED.
- READY.
- IN PROGRESS.
- NEEDS INVESTIGATION.
- IMPLEMENTED.
- TESTING.
- VERIFIED.
- DEFERRED.

Do not mark a task complete merely because its documentation exists.

Maintain `docs/project-roadmap.md` with milestones, dependency ordering, critical-path risks, and measurable exit criteria.

Maintain `docs/risk-register.md` with technical uncertainty, format compatibility, performance, scope, licensing, asset distribution, security, and maintenance risks.

Do not promise completion dates without an evidence-based estimate of effort and scope.

---

## 18. Research and Source Quality

Use available research tools to investigate public technical documentation, official tool documentation, game metadata, established reverse-engineering references, and relevant community research.

Prefer primary sources.

For external claims, record source URLs and access dates when useful.

Do not invent documentation, tool capabilities, APIs, game mechanics, or asset formats.

If public information is insufficient, specify the experiment needed to obtain the missing information from the user's installation.

Keep a distinction between:

- Verified fact.
- Observed behavior.
- Reasonable inference.
- Unverified hypothesis.
- Open question.
- Engineering decision.
- Deliberate design change.

Do not treat an LLM's generated hypothesis as proof of original game behavior.

---

## 19. Execution Protocol for the LLM

Work incrementally and use the following protocol.

### Step 1: Establish project constraints

Review this prompt and identify the unknown information that genuinely blocks discovery or architecture decisions.

Ask the user for the original installer path and installed game directory when necessary.

Do not ask the user to manually answer questions that a read-only inventory script could answer safely.

Do not request passwords, license keys, account credentials, or unnecessary personal information.

### Step 2: Inspect before committing to a design

If tools provide access to the local workspace, inspect it.

If the workspace is inaccessible, explain exactly which discovery commands the user should execute and what non-sensitive outputs to provide.

Do not pretend to have inspected local files.

Do not assume a specific game engine or executable architecture.

### Step 3: Create the documentation foundation

Generate the project overview, repository layout, environment guide, dependency guide, roadmap, risk register, and initial investigation plan.

Mark unverified details clearly.

### Step 4: Identify the minimum playable vertical slice

Define the smallest testable implementation that validates the client, server, database, and networking architecture before extensive reverse engineering.

### Step 5: Research and implement in dependency order

Follow the roadmap, updating the specifications and backlog as new evidence is collected.

Do not attempt to implement all features simultaneously.

### Step 6: Validate every milestone

Run the available tests and record their actual results.

Distinguish:

- Tests not run.
- Tests blocked by missing inputs.
- Tests failed.
- Tests passed locally.
- Tests verified in the intended deployment environment.

Never report success without evidence.

### Step 7: Maintain documentation

Update all affected documents after meaningful implementation changes.

Ensure that setup instructions match the actual repository, commands match the selected tools, and architectural decisions reflect the current implementation.

### Step 8: Resume work safely

At the end of each working session, update a progress document with:

- Current milestone.
- Completed tasks.
- Verified results.
- Files created or modified.
- Commands executed.
- Known failures.
- Outstanding questions.
- Next recommended task.
- Exact prerequisites for resuming.

Create `docs/PROJECT_STATUS.md` for this purpose.

---

## 20. Initial Response Requirements

Begin by producing the documentation plan, not by attempting to write a complete game engine in one response.

Your initial response must contain:

1. A concise summary of the proposed architecture.
2. A technology comparison and preliminary recommendation.
3. The proposed repository layout.
4. A dependency-ordered roadmap.
5. The minimum playable vertical slice.
6. A list of required local discovery operations.
7. The initial risk register.
8. The complete list of planned Markdown documents.
9. The first actionable setup instructions.
10. The specific information or tool access required from the user.

Then begin generating the actual Markdown files.

If file-writing tools are available, create the files directly in the project workspace. Otherwise, output each complete Markdown document in a separate clearly labeled section that can be saved to the specified path.

Do not stop after providing a list of filenames or a generic roadmap. Produce real documentation with commands, implementation steps, acceptance criteria, and tests.

Prioritize foundational documents first, then work through the roadmap. If context or output limits prevent completion in one session, save the progress state and continue with the next unfinished document in a subsequent session.

## 21. Definition of Project Success

The project is successful when the following outcomes have been achieved and verified:

- The original game has been systematically investigated using the user's own files.
- Supported asset formats can be identified and imported without modifying the original installation.
- The reconstructed engine implements a documented and tested subset of original behavior.
- The browser client renders the reconstructed world.
- A server-authoritative multiplayer simulation supports multiple simultaneous players.
- Accounts and character progression persist across disconnects and server restarts.
- Core gameplay systems are validated against available original-game evidence.
- The project can be built and tested from a clean checkout using documented procedures.
- Original game assets remain separate from the public source repository.
- The deployment model respects applicable intellectual-property and licensing requirements.
- Operational procedures, security controls, backups, and regression tests are documented.
- Every claimed capability has a corresponding implementation and verification result.

**Final instruction:** Optimize for a project that can actually be built, tested, maintained, and expanded—not one that merely looks architecturally impressive on paper. When uncertainty is high, reduce scope, design an experiment, gather evidence, and proceed with the smallest verifiable step.