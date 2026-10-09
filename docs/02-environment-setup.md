# 02 - Environment Setup: Developer Workstation Guide

## 1. Objective

Provide exhaustive, copy-paste-ready setup instructions for configuring a Windows 10/11 development workstation to develop, build, run, and test the CrusadersOnline client, authoritative server, database layer, and reverse-engineering asset pipeline.

---

## 2. Prerequisites

- OS: Windows 10 or 11 (64-bit).
- Administrator privileges on the local workstation (for optional package installations).
- Hardware recommendation: Minimum 8 GB RAM (16 GB recommended), quad-core CPU, DirectX 11+ capable GPU, 5 GB free disk space.
- Terminal: Windows PowerShell 5.1 or PowerShell 7 (pwsh).

---

## 3. Investigation & Environment Verification

Before installing new software, audit what is already installed in your local terminal:

```powershell
# Shell: PowerShell
# Working Directory: Workspace root (CrusadersOnline)
Write-Host "=== SYSTEM TOOL AUDIT ==="
$tools = @("git", "node", "pnpm", "python", "docker")
foreach ($t in $tools) {
    try {
        $ver = & $t --version 2>&1
        Write-Host "[OK] $t : $ver"
    } catch {
        Write-Host "[MISSING] $t is not in PATH"
    }
}
```

*Empirical Discovery on Current Machine:*
- `node`: v24.14.0 (Installed)
- `npm`: 11.9.0 (Installed; pnpm is enabled via `corepack enable`)
- `python`: 3.14.6 (Installed; optional, research scripts only)
- `git`: 2.52.0.windows.1 (Installed)
- `cargo`: Missing (Optional, Node.js chosen for server simulation eliminates Rust dependency requirement)
- `docker`: Optional for local PostgreSQL, or native PostgreSQL can be used.

---

## 4. Design & Workspace Layout

The workspace enforces total physical separation between source code and private game assets:

```
c:/Users/Lencina/Desktop/CrusadersOnline/
├── .env.example              # Environment variables template
├── .gitignore                # IP leak prevention rules
├── prompt.md                 # Project master prompt
├── docs/                     # Technical documentation & ADRs
│   ├── milestones/           # Phase milestone tracking
│   └── reverse-engineering/  # Reversing notes & file specs
├── tools/                    # Local research scripts (Python, read-only)
│   └── inventory.py          # Read-only game file scanner
├── converter/                # TypeScript asset converter (CLI + browser worker)
├── shared/                   # Shared TypeScript protocol, movement & math
├── server/                   # Authoritative Node.js/TS game server
├── client/                   # WebGL2/Three.js browser application
├── tests/                    # Integration and end-to-end test suites
└── local/                    # [GIT-IGNORED] Machine-private data
    ├── inventory.json        # Output of read-only inventory scan
    ├── original/             # User-copied original game files
    ├── extracted/            # Intermediate raw chunks
    └── generated/            # Local glTF, WebP, Ogg user assets
```

---

## 5. Implementation Steps

### 5.1 Step 1: Initialize Git Repository with Protection
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline
git init
git status
```
*Verification:* Confirm that `Crusaders of Might and Magic/` and `local/` are NOT staged and show as ignored.

### 5.2 Step 2: Configure Environment File
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline
Copy-Item .env.example .env
Get-Content .env
```
Ensure that `GAME_INSTALL_DIR` points to `.\Crusaders of Might and Magic`.

### 5.3 Step 3: Setup Private Local Directory Structure
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline
New-Item -ItemType Directory -Force -Path "local/original", "local/extracted", "local/generated"
```

### 5.4 Step 4: Run Initial Game File Inventory
Execute the read-only forensic scanner:
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline
python tools/inventory.py ".\Crusaders of Might and Magic" --out "local/inventory.json"
```
*Expected Output:*
```
[*] Scanning read-only inventory for: Crusaders of Might and Magic
[+] Inventory saved to local/inventory.json (1867 files cataloged)
```

### 5.5 Step 5: Enable pnpm and Install Dependencies
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline
corepack enable
pnpm install
```

### 5.6 Step 6: Database

No setup is required for development: the server defaults to `DATABASE_URL=pglite:local/pgdata`, an embedded PostgreSQL 18 (PGlite) stored in the git-ignored `local/pgdata/` and migrated automatically at startup. Do not run `pnpm db:migrate` while the server is running against the same PGlite directory (PGlite is single-process).

A real PostgreSQL server is only needed to test production behaviour. Options:

#### Option A: Docker Compose (Recommended if Docker Desktop installed)
```powershell
# Shell: PowerShell
docker run --name crusaders-postgres -e POSTGRES_PASSWORD=postgres_password_here -e POSTGRES_DB=crusaders_online -p 5432:5432 -d postgres:18-alpine
```

#### Option B: Native Windows PostgreSQL
If Docker is not installed, install PostgreSQL 18 via winget:
```powershell
winget install PostgreSQL.PostgreSQL.18
```
Create database:
```powershell
createdb -U postgres crusaders_online
```

---

## 6. Testing & Validation

Run the end-to-end validation script:
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline
python -c "import json, os; assert os.path.exists('local/inventory.json'); d=json.load(open('local/inventory.json')); assert d['total_files'] > 1000; print('SUCCESS: Inventory verified with %d files' % d['total_files'])"
```
*Expected Output:*
`SUCCESS: Inventory verified with 1867 files`

---

## 7. Acceptance Criteria

- [x] Node.js, npm, Python, and Git verified operational in terminal.
- [ ] pnpm enabled via Corepack.
- [ ] `.env` created from `.env.example`.
- [ ] `local/` subdirectories created and confirmed excluded by Git (Git repository not yet initialized).
- [x] Read-only inventory executed without modifying any game binaries.
- [x] Database configuration documented for both Docker and native Windows service.

---

## 8. Troubleshooting

| Error | Root Cause | Solution |
|---|---|---|
| `python : The term 'python' is not recognized` | Python not in Windows PATH | Add `C:\Users\<user>\AppData\Local\Programs\Python\Python314` to User PATH. |
| `git : fatal: not a git repository` | Git not yet initialized | Run `git init` in the workspace root. |
| File locked error during inventory scan | Background process holds handle | Close any running instances of `crusaders.exe` or config tools. |

---

## 9. Dependencies & Next Steps

Proceed to:
- [03-dependencies.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/03-dependencies.md) — Detailed runtime package dependencies.
- [04-repository-structure.md](file:///c:/Users/Lencina/Desktop/CrusadersOnline/docs/04-repository-structure.md) — Architectural boundary specification.
