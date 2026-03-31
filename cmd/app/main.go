package main

import (
	"context"
	"log"
	"net"
	"os"
	"strings"
	"time"

	"github.com/liz/sbuxsync/internal/auth"
	"github.com/liz/sbuxsync/internal/database"
	"github.com/liz/sbuxsync/internal/scraper"
)

// defaultInternalCIDRs covers loopback and standard private/Docker ranges.
var defaultInternalCIDRs = []string{
	"127.0.0.0/8",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"::1/128",
	"fc00::/7",
}

func main() {
	ctx := context.Background()

	dbPath := getEnv("DB_PATH", "sbuxsync.db")
	mekHex := requireEnv("MEK")
	requireEnv("SMTP_HOST")
	scraperImage := getEnv("SCRAPER_IMAGE", "sbuxsync-scraper-module:latest")
	scraperCallbackURL := getEnv("SCRAPER_CALLBACK_URL", "http://app:8080")
	internalCIDRs := parseInternalCIDRs(os.Getenv("INTERNAL_CIDR_ALLOWLIST"))

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

	icsRL := auth.NewRateLimiter(5, time.Minute) // per-IP: prevent ICS token brute-force
	defer icsRL.Close()

	scraperSvc := scraper.NewScraperService(db, mekHex, scraperImage, scraperCallbackURL)
	go scraperSvc.RunScheduler(ctx)

	server := NewServer(db, mekHex, scraperSvc, pinStore, pinRequestRL, pinVerifyRL, credentialRL, scrapeRL, icsRL, internalCIDRs)
	addr := ":8080"
	log.Printf("app service listening on %s", addr)
	if err := server.Run(addr); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func parseInternalCIDRs(env string) []*net.IPNet {
	var strs []string
	if env != "" {
		for _, s := range strings.Split(env, ",") {
			s = strings.TrimSpace(s)
			if s != "" {
				strs = append(strs, s)
			}
		}
	}
	if len(strs) == 0 {
		strs = defaultInternalCIDRs
	}
	nets := make([]*net.IPNet, 0, len(strs))
	for _, s := range strs {
		_, cidr, err := net.ParseCIDR(s)
		if err != nil {
			log.Fatalf("invalid CIDR in INTERNAL_CIDR_ALLOWLIST: %q: %v", s, err)
		}
		nets = append(nets, cidr)
	}
	return nets
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
