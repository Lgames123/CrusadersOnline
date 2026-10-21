# Open-source readiness: security pass and a short README

Date: 2026-10-21 · Agent: Claude Code · Commit: GPL-3.0 license, root README with screenshots, security pass

## Why
The repository is about to go public on GitHub: check it for secrets and leaks, and give it a
short root README with screenshots.

## Decisions and evidence
- Whole history (all branches, `git log --all -p`) scanned for keys, tokens, private keys,
  emails, IPs and local paths: only test passwords (`password123`), dev DB defaults
  (`crusaders_dev`, `crusaders_ci`) and `${{ secrets.GITHUB_TOKEN }}`. No `.env`, `local/`,
  `GeminiREA/`, `GeminiDecomp/`, game files or decompiler dumps in any commit; largest blob is
  `world_zone.ts`. RE docs describe routines in prose with addresses, no verbatim pseudo-code.
- `pnpm audit --prod`: no known vulnerabilities.
- Server surface checked: `/control/*` needs loopback + timing-safe token; `/metrics` and
  `/control` are not proxied by Caddy; dev-guest settings are forced off in production; argon2id,
  hashed session ids, SameSite=Strict cookies.
- `file:///c:/Users/Lencina/...` links in docs rewritten to repo-root links (`/docs/...`), which
  GitHub resolves; they were broken there.
- Screenshots in `docs/screenshots/` (1280×720 JPG, Playwright + msedge headed, dev guest on the
  `monsters-*` and `dungeon-*` launch configs).

- License: GPL-3.0 (user's choice), `LICENSE` is the verbatim text from GitHub's licenses API
  so GitHub detects it. `package.json` files stay `private: true`: nothing is published to npm.

## Not done / not decoded
- Screenshots show original art (textures, models, the waypoint world map). Common for fan
  projects, but it bends the Zero-IP rule in `asset-licensing-and-distribution.md`; the user chose
  to include them.
- Commit author email (`lencinagames@gmail.com`) is public in history once pushed.

## Gotchas
- `ADMIN_USERS` grants admin on sign-in by username: list only accounts that already exist,
  or anyone registering that name first becomes admin (now said in `deployment/.env.example`).
- `local/server-control.json` holds only the last server started; with several dev servers up,
  `pnpm stop:server` reaches only that one.

## How to verify
- Open the repository page on GitHub: README renders with the four screenshots.
