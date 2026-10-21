# Cloudflare Tunnel hosting and per-IP limits behind a proxy

Date: 2026-10-20 · Agent: Claude Code · Commit: Cloudflare Tunnel compose profiles; rate limits read the client IP from the proxy

## Why
The planned cloud VM had no free capacity; hosting temporarily from a home machine through a Cloudflare Tunnel.

## Decisions and evidence
- Compose profiles `quicktunnel` (trycloudflare.com, no account) and `tunnel` (named, created with `cloudflared tunnel login/create/route dns`: no Zero Trust onboarding, which asks for a card; credentials in git-ignored `deployment/cloudflared/`), `cloudflare/cloudflared:2026.9.3`, pointing at `http://web:80`. Cloudflare does TLS; Caddy stays on `:80`.
- Found while doing it: every per-IP limiter in `http/api.ts` keyed on `req.socket.remoteAddress`, which behind Caddy is Caddy's address, so all players shared one bucket (1/s, burst 10) for login, register, tickets and characters. New `CLIENT_IP_HEADER` (`clientIp()`); compose defaults it to `x-forwarded-for` (Caddy rewrites XFF from untrusted peers), tunnel uses `cf-connecting-ip`.
- Under a tunnel `WEB_PORT`/`WEB_TLS_PORT` are bound to `127.0.0.1` so Caddy cannot be reached around Cloudflare (the header would otherwise be forgeable).

## Gotchas
- Compose interpolates every service, profiles or not: never make a tunnel-only variable required (`:?`), it breaks plain `up`.
- One named tunnel can serve several hostnames (ingress list in the git-ignored `deployment/cloudflared/config.yml`; the real hostnames, tunnel id and credentials live only there). `tunnel login`'s `cert.pem` is bound to the one zone picked at login: `route dns` for another zone needs a new login (else it creates `<host>.<old zone>`); keep one cert per zone as `cert-<zone>.pem`. Moving a zone's DNS to Cloudflare: re-create the existing records (e.g. a website's CNAMEs to its host) before switching nameservers, not the A records Cloudflare's scan guesses.
- Never commit hostnames, tunnel ids, account tags or registrar/DNS details of the live deployment: docs use `play.<domain>` and `<tunnel-id>`.
- The quick tunnel's address changes on every restart of the `quicktunnel` container.
- The WebSocket goes through Cloudflare (100 s idle timeout); the server's 15 s ping heartbeat keeps it open.

## How to verify
- `tests/unit/client_ip.test.ts`; `docker compose ... --profile quicktunnel up -d --build`, then the URL from `logs quicktunnel`, `/healthz` over it, register and enter the world.

## Follow-ups
- Move to the cloud VM once capacity frees.
