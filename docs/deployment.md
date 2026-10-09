# Deployment Guide: Containerization & Production Topology

## 1. Single-Host Docker Compose Deployment

```yaml
# deployment/docker-compose.yml
version: '3.8'

services:
  db:
    image: postgres:18-alpine
    restart: always
    environment:
      POSTGRES_DB: crusaders_online
      POSTGRES_USER: crusaders_admin
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - internal_net

  server:
    build:
      context: ..
      dockerfile: deployment/Dockerfile.server
    restart: always
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://crusaders_admin:${DB_PASSWORD}@db:5432/crusaders_online
      SERVER_PORT: 8080
    depends_on:
      - db
    networks:
      - internal_net

  proxy:
    image: caddy:2-alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ../client/dist:/var/www/html
      - caddy_data:/data
    networks:
      - internal_net

networks:
  internal_net:
    driver: bridge

volumes:
  pgdata:
  caddy_data:
```

---

## 2. Production Deployment Command
```bash
# On Ubuntu 22.04 LTS production server
docker compose -f deployment/docker-compose.yml up -d --build
```
This single command spins up PostgreSQL, runs migrations, boots the authoritative 20Hz game server, serves client assets, and provisions automatic HTTPS certificates via Caddy.
