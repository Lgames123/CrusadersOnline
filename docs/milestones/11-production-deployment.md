# Milestone 11: Production Deployment & Operations

## 1. Objective
Package the production application using Docker Compose, configure automated TLS termination via Caddy reverse proxy, and establish backup/monitoring runbooks.

## 2. Prerequisites
- Milestone 10 complete.
- Target Linux host (Ubuntu 22.04 LTS or local Docker desktop).

## 3. Implementation Steps
1. Build production containers for server and client.
2. Launch stack using `docker compose -f deployment/docker-compose.yml up -d`.
3. Configure automated PostgreSQL database dump cron job (`scripts/backup_db.sh`).
4. Validate HTTPS handshake, WSS WebSocket connections, and healthcheck endpoints.

## 4. Acceptance Criteria
- [ ] Application spins up cleanly from a cold single-command start.
- [ ] Reverse proxy terminates TLS cleanly and forwards WebSocket upgrades.
- [ ] Automated database backup script completes without error.
