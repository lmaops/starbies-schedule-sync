package scraper

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	appCrypto "github.com/liz/sbuxsync/internal/crypto"
	"github.com/liz/sbuxsync/internal/models"
	mobyContainer "github.com/moby/moby/api/types/container"
	mobyClient "github.com/moby/moby/client"
)

const (
	maxConcurrentScrapes = 3
	pollInterval         = 60 * time.Second
	retentionInterval    = 1 * time.Hour
	minScrapeInterval    = 16 * time.Hour
	maxScrapeInterval    = 24 * time.Hour
	scrapeTimeout        = 2 * time.Minute
	maxRetries           = 3
	pullInterval         = 5 * time.Minute
)

type ScraperService struct {
	db           *sql.DB
	crypto       *appCrypto.EnvelopeCrypto
	scraperImage string
	callbackURL  string
	sem          chan struct{}
	docker       *mobyClient.Client
	lastPull     time.Time
	pullMu       sync.Mutex
}

func NewScraperService(db *sql.DB, mekHex, scraperImage, callbackURL string) *ScraperService {
	ec, err := appCrypto.New(mekHex)
	if err != nil {
		log.Fatalf("invalid MEK: %v", err)
	}
	docker, err := mobyClient.NewClientWithOpts(mobyClient.FromEnv, mobyClient.WithAPIVersionNegotiation())
	if err != nil {
		log.Fatalf("docker client: %v", err)
	}
	return &ScraperService{
		db:           db,
		crypto:       ec,
		scraperImage: scraperImage,
		callbackURL:  callbackURL,
		sem:          make(chan struct{}, maxConcurrentScrapes),
		docker:       docker,
	}
}

func (s *ScraperService) RunScheduler(ctx context.Context) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	retentionTicker := time.NewTicker(retentionInterval)
	defer retentionTicker.Stop()

	// run retention once at startup
	s.runRetention(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.processDueScrapes(ctx)
			s.reapTimedOutContainers(ctx)
		case <-retentionTicker.C:
			s.runRetention(ctx)
		}
	}
}

func (s *ScraperService) TriggerScrape(userID uuid.UUID) {
	go func() {
		s.sem <- struct{}{}
		defer func() { <-s.sem }()
		s.scrapeForUser(context.Background(), userID, 0, false)
	}()
}

func (s *ScraperService) processDueScrapes(ctx context.Context) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT user_id FROM scrape_schedule
		WHERE next_scrape_at <= ?
	`, time.Now().UTC().Unix())
	if err != nil {
		log.Printf("scheduler query error: %v", err)
		return
	}
	defer rows.Close()

	var userIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err == nil {
			userIDs = append(userIDs, id)
		}
	}

	var wg sync.WaitGroup
	for _, userID := range userIDs {
		wg.Add(1)
		go func(uid uuid.UUID) {
			defer wg.Done()
			s.sem <- struct{}{}
			defer func() { <-s.sem }()
			s.scrapeForUser(ctx, uid, 0, true)
		}(userID)
	}
	wg.Wait()
}

func (s *ScraperService) scrapeForUser(ctx context.Context, userID uuid.UUID, retryCount int, isAuto bool) {
	if retryCount > 0 {
		log.Printf("starting scrape for user %s (retry %d/%d)", userID, retryCount, maxRetries)
	} else {
		log.Printf("starting scrape for user %s", userID)
	}

	logID := uuid.New()
	scrapeKey := uuid.NewString()
	startedAt := time.Now().UTC()
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO scrape_logs (id, user_id, started_at, status, scrape_key, retry_count, is_auto) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		logID.String(), userID.String(), startedAt.Unix(), "running", scrapeKey, retryCount, boolToInt(isAuto),
	)
	if err != nil {
		log.Printf("create scrape log: %v", err)
		return
	}

	if err := s.runScrapeContainer(ctx, userID, logID, scrapeKey); err != nil {
		now := time.Now().UTC()
		_, _ = s.db.ExecContext(ctx, `
			UPDATE scrape_logs SET status = ?, finished_at = ?, error_message = ? WHERE id = ?
		`, "failure", now.Unix(), err.Error(), logID.String())
		log.Printf("scrape failed to start for user %s: %v", userID, err)
		if isAuto && retryCount < maxRetries {
			s.scrapeForUser(ctx, userID, retryCount+1, true)
		} else {
			s.ScheduleNext(ctx, userID.String())
		}
	}
	// container started; completion handled by callbacks and the reaper
}

func (s *ScraperService) runScrapeContainer(ctx context.Context, userID, logID uuid.UUID, scrapeKey string) error {
	var tzName string
	if err := s.db.QueryRowContext(ctx, `SELECT timezone FROM users WHERE id = ?`, userID.String()).Scan(&tzName); err != nil {
		tzName = "UTC"
	}
	if _, err := time.LoadLocation(tzName); err != nil {
		tzName = "UTC"
	}

	if err := s.pullImage(ctx); err != nil {
		return err
	}

	createResp, err := s.docker.ContainerCreate(ctx, mobyClient.ContainerCreateOptions{
		Config: &mobyContainer.Config{
			Image: s.scraperImage,
			Env: []string{
				"TZ=" + tzName,
				"SCRAPE_KEY=" + scrapeKey,
				"SCRAPE_API_URL=" + s.callbackURL,
			},
		},
		HostConfig: &mobyContainer.HostConfig{
			NetworkMode: "sbuxsync_scraper-exec",
			AutoRemove:  true,
			Binds:       []string{"/usr/share/zoneinfo/" + tzName + ":/etc/localtime:ro"},
		},
	})
	if err != nil {
		return fmt.Errorf("create container: %w", err)
	}
	containerID := createResp.ID

	_, _ = s.db.ExecContext(ctx, `UPDATE scrape_logs SET container_id = ? WHERE id = ?`, containerID, logID.String())

	if _, err := s.docker.ContainerStart(ctx, containerID, mobyClient.ContainerStartOptions{}); err != nil {
		return fmt.Errorf("start container: %w", err)
	}

	return nil
}

// checks whether a failed scrape should be retried; auto scrapes retry up to maxRetries times
func (s *ScraperService) HandleScrapeFailure(ctx context.Context, logID, userID string) {
	var retryCount int
	var isAuto int
	err := s.db.QueryRowContext(ctx,
		`SELECT retry_count, is_auto FROM scrape_logs WHERE id = ?`, logID,
	).Scan(&retryCount, &isAuto)
	if err != nil {
		log.Printf("retry check: could not read scrape log %s: %v", logID, err)
		s.ScheduleNext(ctx, userID)
		return
	}

	if isAuto == 1 && retryCount < maxRetries {
		uid, err := uuid.Parse(userID)
		if err != nil {
			s.ScheduleNext(ctx, userID)
			return
		}
		go func() {
			s.sem <- struct{}{}
			defer func() { <-s.sem }()
			s.scrapeForUser(context.Background(), uid, retryCount+1, true)
		}()
		return
	}

	s.ScheduleNext(ctx, userID)
}

// schedules the next scrape for a user with random jitter
func (s *ScraperService) ScheduleNext(ctx context.Context, userID string) {
	jitter := time.Duration(rand.Int63n(int64(maxScrapeInterval-minScrapeInterval))) + minScrapeInterval
	now := time.Now().UTC()
	_, _ = s.db.ExecContext(ctx, `
		UPDATE scrape_schedule SET next_scrape_at = ?, last_scraped_at = ? WHERE user_id = ?
	`, now.Add(jitter).Unix(), now.Unix(), userID)
}

// kills containers running longer than scrapeTimeout and marks their logs failed
func (s *ScraperService) reapTimedOutContainers(ctx context.Context) {
	cutoff := time.Now().UTC().Add(-scrapeTimeout).Unix()
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, container_id FROM scrape_logs
		WHERE status = 'running' AND started_at < ?
	`, cutoff)
	if err != nil {
		return
	}

	type staleEntry struct{ logID, userID, containerID string }
	var stale []staleEntry
	for rows.Next() {
		var e staleEntry
		var containerID sql.NullString
		if err := rows.Scan(&e.logID, &e.userID, &containerID); err == nil {
			e.containerID = containerID.String
			stale = append(stale, e)
		}
	}
	rows.Close()

	for _, e := range stale {
		if e.containerID != "" {
			_, _ = s.docker.ContainerKill(ctx, e.containerID, mobyClient.ContainerKillOptions{Signal: "SIGKILL"})
		}
		_, _ = s.db.ExecContext(ctx, `
			UPDATE scrape_logs SET status = 'failure', finished_at = ?, error_message = ? WHERE id = ?
		`, time.Now().UTC().Unix(), fmt.Sprintf("timed out after %s", scrapeTimeout), e.logID)
		s.HandleScrapeFailure(ctx, e.logID, e.userID)
		log.Printf("reaped timed-out scrape %s for user %s", e.logID, e.userID)
	}
}

// enforces retention: deletes old scrape logs (7d success, 30d failure), old shifts (30d), expired sessions
func (s *ScraperService) runRetention(ctx context.Context) {
	now := time.Now().UTC().Unix()

	// delete successful scrape logs older than 7 days
	scrapeLogCutoff := now - int64((7 * 24 * time.Hour).Seconds())
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM scrape_logs WHERE status = 'success' AND finished_at < ?`, scrapeLogCutoff)
	if err != nil {
		log.Printf("retention: scrape logs cleanup error: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("retention: deleted %d successful scrape logs older than 7 days", n)
	}

	// delete failed scrape logs older than 30 days
	failedLogCutoff := now - int64((30 * 24 * time.Hour).Seconds())
	res, err = s.db.ExecContext(ctx,
		`DELETE FROM scrape_logs WHERE status = 'failure' AND finished_at < ?`, failedLogCutoff)
	if err != nil {
		log.Printf("retention: failed scrape logs cleanup error: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("retention: deleted %d failed scrape logs older than 30 days", n)
	}

	// clear failure screenshots from failed logs older than 7 days to free space
	// while keeping the log record itself for diagnostics
	screenshotCutoff := now - int64((7 * 24 * time.Hour).Seconds())
	res, err = s.db.ExecContext(ctx,
		`UPDATE scrape_logs SET failure_screenshots = NULL
		 WHERE status = 'failure' AND failure_screenshots IS NOT NULL AND finished_at < ?`, screenshotCutoff)
	if err != nil {
		log.Printf("retention: failure screenshots cleanup error: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("retention: cleared failure screenshots from %d scrape logs older than 7 days", n)
	}

	// delete shifts older than 30 days
	shiftCutoff := now - int64((30 * 24 * time.Hour).Seconds())
	res, err = s.db.ExecContext(ctx,
		`DELETE FROM shifts WHERE end_time < ?`, shiftCutoff)
	if err != nil {
		log.Printf("retention: shifts cleanup error: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("retention: deleted %d shifts older than 30 days", n)
	}

	// delete expired sessions
	res, err = s.db.ExecContext(ctx,
		`DELETE FROM sessions WHERE expires_at < ?`, now)
	if err != nil {
		log.Printf("retention: sessions cleanup error: %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("retention: deleted %d expired sessions", n)
	}
}

// decrypts and returns the Starbucks credentials for a user
func (s *ScraperService) LoadCredentials(ctx context.Context, userID uuid.UUID) (*models.DecryptedCredentials, error) {
	var dek models.UserDEK
	err := s.db.QueryRowContext(ctx,
		`SELECT encrypted_dek, dek_nonce FROM user_deks WHERE user_id = ?`, userID.String(),
	).Scan(&dek.EncryptedDEK, &dek.DEKNonce)
	if err != nil {
		return nil, fmt.Errorf("load DEK: %w", err)
	}

	plainDEK, err := s.crypto.DecryptDEK(dek.EncryptedDEK, dek.DEKNonce)
	if err != nil {
		return nil, fmt.Errorf("decrypt DEK: %w", err)
	}

	var cred models.StarbucksCredentials
	err = s.db.QueryRowContext(ctx, `
		SELECT encrypted_username, username_nonce, encrypted_password, password_nonce,
		       encrypted_security_questions, security_questions_nonce
		FROM starbucks_credentials WHERE user_id = ?
	`, userID.String()).Scan(
		&cred.EncryptedUsername, &cred.UsernameNonce,
		&cred.EncryptedPassword, &cred.PasswordNonce,
		&cred.EncryptedSecurityQuestions, &cred.SecurityQuestionsNonce,
	)
	if err != nil {
		return nil, fmt.Errorf("load credentials: %w", err)
	}

	username, err := s.crypto.Decrypt(plainDEK, cred.EncryptedUsername, cred.UsernameNonce)
	if err != nil {
		return nil, fmt.Errorf("decrypt username: %w", err)
	}
	password, err := s.crypto.Decrypt(plainDEK, cred.EncryptedPassword, cred.PasswordNonce)
	if err != nil {
		return nil, fmt.Errorf("decrypt password: %w", err)
	}
	sqRaw, err := s.crypto.Decrypt(plainDEK, cred.EncryptedSecurityQuestions, cred.SecurityQuestionsNonce)
	if err != nil {
		return nil, fmt.Errorf("decrypt security questions: %w", err)
	}

	var sqs []models.SecurityQuestion
	if err := json.Unmarshal(sqRaw, &sqs); err != nil {
		return nil, fmt.Errorf("parse security questions: %w", err)
	}

	return &models.DecryptedCredentials{
		Username:          string(username),
		Password:          string(password),
		SecurityQuestions: sqs,
	}, nil
}

func (s *ScraperService) pullImage(ctx context.Context) error {
	// Skip pull for local images (no registry prefix)
	if !strings.Contains(s.scraperImage, "/") {
		return nil
	}
	s.pullMu.Lock()
	defer s.pullMu.Unlock()
	if time.Since(s.lastPull) < pullInterval {
		return nil
	}
	resp, err := s.docker.ImagePull(ctx, s.scraperImage, mobyClient.ImagePullOptions{})
	if err != nil {
		return fmt.Errorf("pull image: %w", err)
	}
	if err := resp.Wait(ctx); err != nil {
		return fmt.Errorf("pull image: %w", err)
	}
	s.lastPull = time.Now()
	log.Printf("pulled scraper image %s", s.scraperImage)
	return nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
