# Starbies Schedule Sync

A lightweight and easy to configure Go application that automatically syncs your Starbucks work schedule to a subscribable ICS calendar feed.

## How it works

1. You enter your Starbucks partner credentials (username, password, security questions)
2. The app launches a headless browser container that logs in and scrapes your schedule
3. Your shifts are stored and served as a live ICS feed you can subscribe to in any calendar app
4. Scrapes run automatically every 16-24 hours.

Credentials are encrypted at rest with AES-256-GCM. Each user has a per-user data encryption key (DEK) that is itself encrypted by a master key (MEK) that the operator of the instance controls.

## Architecture

- **`cmd/app/`** - Go HTTP server: auth, scheduling, API, data storage
- **`web/`** - React + TypeScript SPA, compiled and embedded into the Go binary at build time
- **`scraper/`** - Node.js + Puppeteer container launched on-demand by the Go server via Docker
- **`internal/`** - auth, crypto, calendar, database, scraper packages
- **SQLite** - single-file database, no separate server needed

## Self-hosting (Docker)

**Prerequisites:** Docker + Docker Compose, a domain name, SMTP credentials

### 1. Clone and configure

```sh
git clone <repo-url>
cd sbuxslavehrs-web
cp .env.example .env
```

Edit `.env` and set:
- `DOMAIN` - your domain name
- `MEK` - generate with `openssl rand -hex 32`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` - your SMTP credentials for sending PIN emails

### 2. Create the scraper network

Scraper containers run on a dedicated network:

```sh
docker network create scraper-exec
```

### 3. Start the app

```sh
mkdir -p data
docker compose up -d --build
```

This builds and starts the app. The scraper uses the public image `ghcr.io/lmaops/sbuxsync-scraper:main` by default, which auto-updates to the latest version.

The app listens on `127.0.0.1:8080`. Put a reverse proxy (Caddy, Nginx) in front for TLS.

**Caddy example** (`Caddyfile`):

```
schedules.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

### Updating

```sh
git pull
docker compose up -d --build
```

The scraper image (`ghcr.io/lmaops/sbuxsync-scraper:main`) will be pulled automatically; it tracks the `main` branch and updates when you restart.

### Data

The SQLite database is stored in `./data/` (mounted as a volume). Back this directory up regularly.

---

## Developer setup (local build)

**Prerequisites:** Go 1.22+, Node.js 20+, Docker, SMTP credentials

### 1. Configure environment

```sh
cp .env.example .env
```

Generate a master encryption key and add it to `.env`:

```sh
openssl rand -hex 32
```

You must also configure SMTP credentials for sending PIN emails.

### 2. Build the scraper image

```sh
make build-scraper
```

### 3. Build the frontend

The Go binary embeds the compiled frontend at build time, so you need to build it at least once before running the server:

```sh
make build-web
```

### 4. Run the server

```sh
go run ./cmd/app
```

### Frontend development (hot reload)

Run the Vite dev server alongside the Go server. It proxies `/api` and `/cal` to `:8080`:

```sh
# terminal 1
go run ./cmd/app

# terminal 2
cd web && npm run dev
# open http://localhost:5173
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DOMAIN` | - | Your domain name (e.g. `schedules.example.com`) |
| `MEK` | **required** | 64-char hex master encryption key (`openssl rand -hex 32`) |
| `SMTP_HOST` | **required** | SMTP hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `SMTP_FROM` | `SMTP_USER` | From address for PIN emails |
| `SCRAPER_IMAGE` | `ghcr.io/lmaops/sbuxsync-scraper:main` | Scraper Docker image. Use the public image for auto-updates, or build locally with `make build-scraper` and set to `sbuxsync-scraper-module:latest` |
| `INTERNAL_CIDR_ALLOWLIST` | default private ranges | Comma-separated CIDR ranges allowed to access /internal endpoints. Defaults to: `127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1/128, fc00::/7` |

## Makefile targets

| Target | Description |
|---|---|
| `make build` | Full production build (web + Go binary) |
| `make build-web` | Build frontend and copy into embed directory |
| `make build-app` | Compile Go binary (requires `build-web` first) |
| `make build-scraper` | Build scraper Docker image |
| `make test` | Run Go tests |
| `make clean` | Remove build artifacts |