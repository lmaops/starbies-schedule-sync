package database

import (
	"database/sql"
	_ "embed"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

func Connect(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite database: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(`PRAGMA journal_mode=WAL;`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable wal mode: %w", err)
	}
	if _, err := db.Exec(`PRAGMA foreign_keys=ON;`); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("enable foreign keys: %w", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite database: %w", err)
	}

	return db, nil
}

func Migrate(db *sql.DB) error {
	if _, err := db.Exec(schemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	// incremental migrations for existing installs; duplicate column errors are silently ignored
	additions := []string{
		`ALTER TABLE scrape_logs ADD COLUMN scrape_key TEXT`,
		`ALTER TABLE scrape_logs ADD COLUMN log_output TEXT`,
		`ALTER TABLE scrape_logs ADD COLUMN failure_screenshots TEXT`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_logs_scrape_key ON scrape_logs(scrape_key) WHERE scrape_key IS NOT NULL`,
		`DROP TABLE IF EXISTS schedules`,
		`ALTER TABLE scrape_logs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE scrape_logs ADD COLUMN is_auto INTEGER NOT NULL DEFAULT 0`,
	}
	for _, stmt := range additions {
		if _, err := db.Exec(stmt); err != nil {
			if !strings.Contains(err.Error(), "duplicate column name") &&
				!strings.Contains(err.Error(), "already exists") {
				return fmt.Errorf("migrate: %w", err)
			}
		}
	}
	return nil
}
