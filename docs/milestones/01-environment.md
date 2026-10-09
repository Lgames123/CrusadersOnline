# Milestone 01: Workstation Setup & Core Directory Structure

## 1. Objective
Scaffold the complete repository structure (`shared/`, `server/`, `client/`, `tools/`, `docs/`) and install base development dependencies.

## 2. Prerequisites
- Milestone 00 complete.
- Node.js v24.x and Python 3.14.x active in PATH.

## 3. Implementation Steps
1. Create directories: `shared/src`, `server/src`, `client/src`, `tools/parsers`, `tests/unit`.
2. Configure root `package.json` with npm workspaces: `"workspaces": ["shared", "server", "client"]`.
3. Set up root `tsconfig.json` with strict type checking.

## 4. Acceptance Criteria
- [ ] Directory structure matches [04-repository-structure.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/04-repository-structure.md).
- [x] TypeScript compiles without errors (`pnpm typecheck`).
