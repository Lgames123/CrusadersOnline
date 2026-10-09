# Milestone 00: Project Discovery & Constraint Verification

## 1. Objective
Establish complete project boundaries, audit developer environment tools, confirm local game data availability, and lock version control against copyright leakage.

## 2. Prerequisites
- Workstation running Windows 10/11 x64.
- Legally acquired GOG installation of *Crusaders of Might and Magic*.

## 3. Investigation
- Audit local terminal tools (`git`, `node`, `npm`, `python`).
- Locate local game directory and verify read-only access.

## 4. Implementation Steps
1. Run `python tools/inventory.py` to index the installation without modifying files.
2. Initialize `.gitignore` blocking all game archives, binaries, and `local/` directories.
3. Generate `.env.example` defining configurable paths and secrets.

## 5. Acceptance Criteria
- [x] Zero copyrighted game files staged in Git.
- [x] Node.js, Python, Git verified functional in terminal.
- [x] Initial inventory scan completed and saved to `local/inventory.json`.
