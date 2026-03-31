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

## Developer setup

**Prerequisites:** Go 1.22+, Node.js 20+, Docker

### 1. Configure environment

```sh
cp .env.example .env
```

Generate a master encryption key and add it to `.env`:

```sh
openssl rand -hex 32
```

Leave `SMTP_HOST` blank to enable insecure single-user mode. This should not be used on a public port.

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

## Self-hosting

**Prerequisites:** Docker + Docker Compose, a domain name, SMTP credentials (optional - without them only a single dev-mode user can log in)

### 1. Clone and configure

```sh
git clone <repo-url>
cp .env.example .env
```

Edit `.env` - see [environment variables](#environment-variables) below.

### 2. Create the scraper network

Scraper containers run on a dedicated network isolated from the main app:

```sh
docker network create sbuxsync_scraper-exec
```

### 3. Build the scraper image

```sh
docker build -t sbuxsync-scraper-module:latest scraper/
```

### 4. Start the app

```sh
mkdir -p data
docker compose up -d --build
```

The app listens on `127.0.0.1:8080`. Put a reverse proxy (Nginx, Caddy) in front for TLS.

**Nginx example:**

```nginx
server {
    listen 443 ssl;
    server_name schedules.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Updating

```sh
git pull
docker build -t sbuxsync-scraper-module:latest scraper/
docker compose up -d --build
```

### Data

The SQLite database is stored in `./data/` (mounted as a volume). Back this directory up regularly.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DOMAIN` | - | Your domain name (e.g. `schedules.example.com`) |
| `DB_PATH` | `sbuxsync.db` | Path to SQLite database file |
| `MEK` | **required** | 64-char hex master encryption key (`openssl rand -hex 32`) |
| `SCRAPER_IMAGE` | `sbuxsync-scraper-module:latest` | Scraper Docker image name |
| `SCRAPER_CALLBACK_URL` | `http://app:8080` | URL the scraper uses to call back to the app |
| `BASE_URL` | `http://localhost:8080` | Public base URL (used to generate ICS feed URLs) |
| `SMTP_HOST` | - | SMTP hostname - leave blank for dev mode |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | - | SMTP username |
| `SMTP_PASS` | - | SMTP password |
| `SMTP_FROM` | `SMTP_USER` | From address for PIN emails |

## Makefile targets

| Target | Description |
|---|---|
| `make build` | Full production build (web + Go binary) |
| `make build-web` | Build frontend and copy into embed directory |
| `make build-app` | Compile Go binary (requires `build-web` first) |
| `make build-scraper` | Build scraper Docker image |
| `make test` | Run Go tests |
| `make clean` | Remove build artifacts |
