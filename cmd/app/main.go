package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/liz/sbuxsync/internal/auth"
	"github.com/liz/sbuxsync/internal/database"
	"github.com/liz/sbuxsync/internal/scraper"
)

func main() {
	ctx := context.Background()

	dbPath := getEnv("DB_PATH", "sbuxsync.db")
	mekHex := requireEnv("MEK")
	scraperImage := getEnv("SCRAPER_IMAGE", "sbuxsync-scraper-module:latest")
	scraperCallbackURL := getEnv("SCRAPER_CALLBACK_URL", "http://app:8080")

	db, err := database.Connect(dbPath)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer db.Close()

	if err := database.Migrate(db); err != nil {
		log.Fatalf("migrations failed: %v", err)
	}

	pinStore := auth.NewPinStore()
	defer pinStore.Close()

	pinRequestRL := auth.NewRateLimiter(5, time.Minute)
	defer pinRequestRL.Close()

	pinVerifyRL := auth.NewRateLimiter(10, time.Minute)
	defer pinVerifyRL.Close()

	credentialRL := auth.NewRateLimiter(1, 30*time.Second) // per-user: 1 credential update per 30s
	defer credentialRL.Close()

	scrapeRL := auth.NewRateLimiter(10, 48*time.Hour) // per-user: 10 scrapes per 48h
	defer scrapeRL.Close()

	icsRL := auth.NewRateLimiter(30, time.Minute) // per-IP: prevent ICS token brute-force
	defer icsRL.Close()

	scraperSvc := scraper.NewScraperService(db, mekHex, scraperImage, scraperCallbackURL)
	go scraperSvc.RunScheduler(ctx)

	server := NewServer(db, mekHex, scraperSvc, pinStore, pinRequestRL, pinVerifyRL, credentialRL, scrapeRL, icsRL)
	addr := ":8080"
	log.Printf("app service listening on %s", addr)
	if err := server.Run(addr); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("required environment variable %s is not set", key)
	}
	return v
}
