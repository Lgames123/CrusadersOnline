# Troubleshooting Guide: Common Faults & Remediations

## 1. Network & WebSocket Faults

| Symptom | Probable Cause | Diagnostic Command / Fix |
|---|---|---|
| Client reports `WebSocket connection to 'ws://...' failed` | Server process not running or port blocked | Run `netstat -ano \| findstr 8080` to verify port is open. Ensure `SERVER_PORT=8080` matches in `.env`. |
| Player movement rubbers-bands backwards continuously | Kinematic clamp violation or high network latency | Check server logs for `Speed clamp violation`. Increase `latencyBuffer` in `movement.ts` if testing on unstable Wi-Fi. |
| Socket disconnected with code `1008` | Rate limiter triggered | Inspect client input emit rate. Ensure client sends at fixed 20Hz interval, not every render frame. |

---

## 2. Rendering & Client Canvas Faults

| Symptom | Probable Cause | Diagnostic Command / Fix |
|---|---|---|
| Black screen with console error `WebGL: CONTEXT_LOST` | Out of VRAM or invalid shader syntax | Open Chrome DevTools (`F12`), check Console tab. Disable experimental post-processing passes. |
| Textures appear purple or untextured white | Missing asset in path or CORS issue | Ensure `Vite` dev server has access to `public/assets/`. Use synthetic fallback texture. |

---

## 3. Database Faults

| Symptom | Probable Cause | Diagnostic Command / Fix |
|---|---|---|
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL service down | Check Docker container with `docker ps` or Windows service with `Get-Service postgresql*`. |
| `relation "characters" does not exist` | Pending migrations not applied | Run `pnpm db:migrate` to apply pending SQL migrations. |
