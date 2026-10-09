# Development Workflow: Local Run, Debug & Hot Reload

## 1. Daily Development Workflow

### 1.1 Start Database (PostgreSQL)
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
# If using Docker:
docker start crusaders-postgres
# Or if native Windows service, verify it is running:
Get-Service postgresql*
```

### 1.2 Start Authoritative Game Server
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
pnpm --filter server dev
```
*Expected Output:*
```
[INFO] Server listening on ws://localhost:8080
[INFO] PostgreSQL connected successfully
[INFO] World simulation ticking at 20 Hz
```

### 1.3 Start Browser Client (Vite Dev Server)
In a second terminal window:
```powershell
# Shell: PowerShell
# Working Directory: CrusadersOnline/
pnpm --filter client dev
```
*Expected Output:*
```
  VITE vX.Y.Z  ready in 240 ms
  ➜  Local:   http://localhost:3000/
```

### 1.4 Open Browser & Play
Navigate to `http://localhost:3000/`. The browser loads the 3D canvas, spawns the local avatar in the synthetic test arena, and begins synchronizing inputs with the server.
