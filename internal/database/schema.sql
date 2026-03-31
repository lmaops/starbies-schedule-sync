CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL,
    ics_token TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_deks (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_dek BLOB NOT NULL,
    dek_nonce BLOB NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS starbucks_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_username BLOB NOT NULL,
    username_nonce BLOB NOT NULL,
    encrypted_password BLOB NOT NULL,
    password_nonce BLOB NOT NULL,
    encrypted_security_questions BLOB NOT NULL,
    security_questions_nonce BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shift_id_ext TEXT,
    job_name TEXT NOT NULL,
    location TEXT,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    net_hours REAL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, shift_id_ext)
);
CREATE INDEX IF NOT EXISTS idx_shifts_user_start ON shifts(user_id, start_time);

CREATE TABLE IF NOT EXISTS scrape_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    status TEXT NOT NULL,
    shifts_found INTEGER,
    shifts_new INTEGER,
    error_message TEXT,
    container_id TEXT,
    scrape_key TEXT,
    log_output TEXT,
    failure_screenshots TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    is_auto INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_user_id ON scrape_logs(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_logs_scrape_key ON scrape_logs(scrape_key) WHERE scrape_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS scrape_schedule (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    next_scrape_at INTEGER NOT NULL,
    last_scraped_at INTEGER
);
