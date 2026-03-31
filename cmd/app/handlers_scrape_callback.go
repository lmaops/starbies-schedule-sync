package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// tries multiple timestamp formats the JDA API may return
func parseShiftTime(s string, loc *time.Location) (time.Time, error) {
	formats := []string{
		"2006-01-02T15:04:05",     // ISO 8601 (no timezone)
		"2006-01-02 15:04:05",     // space-separated (time.DateTime)
		time.RFC3339,              // full RFC3339 with timezone
		"2006-01-02T15:04:05.000", // with milliseconds
	}
	for _, f := range formats {
		if t, err := time.ParseInLocation(f, s, loc); err == nil {
			return t, nil
		}
	}
	return time.Time{}, &time.ParseError{Value: s, Message: "no matching format"}
}

type callbackShift struct {
	Start      string  `json:"start"`
	End        string  `json:"end"`
	JobName    string  `json:"job_name"`
	NetHours   float64 `json:"net_hours"`
	ShiftIDExt string  `json:"shift_id_ext"`
	Location   string  `json:"location"`
}

// fetches credentials for the scraper container by scrape key (single-use, from header)
func (s *Server) scrapeGetCredentials(c *gin.Context) {
	key := c.GetHeader("X-Scrape-Key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing X-Scrape-Key header"})
		return
	}
	ctx := c.Request.Context()

	var userID string
	var credentialsFetchedAt *int64
	err := s.db.QueryRowContext(ctx,
		`SELECT user_id, credentials_fetched_at FROM scrape_logs WHERE scrape_key = ? AND status = 'running'`, key,
	).Scan(&userID, &credentialsFetchedAt)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invalid or expired scrape key"})
		return
	}

	if credentialsFetchedAt != nil {
		c.JSON(http.StatusGone, gin.H{"error": "credentials already fetched for this scrape"})
		return
	}

	uid, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid user id"})
		return
	}

	creds, err := s.scraper.LoadCredentials(ctx, uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load credentials"})
		return
	}

	// Mark credentials as fetched (single-use)
	s.db.ExecContext(ctx, `UPDATE scrape_logs SET credentials_fetched_at = ? WHERE scrape_key = ?`, time.Now().UTC().Unix(), key)

	c.JSON(http.StatusOK, creds)
}

// receives found shifts from the scraper container on success
func (s *Server) scrapeSubmitShifts(c *gin.Context) {
	key := c.GetHeader("X-Scrape-Key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing X-Scrape-Key header"})
		return
	}
	ctx := c.Request.Context()

	var logID, userID string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, user_id FROM scrape_logs WHERE scrape_key = ? AND status = 'running'`, key,
	).Scan(&logID, &userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invalid or expired scrape key"})
		return
	}

	var body struct {
		Shifts   []callbackShift `json:"shifts"`
		HomeSite string          `json:"home_site"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var tzName string
	if err := s.db.QueryRowContext(ctx, `SELECT timezone FROM users WHERE id = ?`, userID).Scan(&tzName); err != nil {
		tzName = "UTC"
	}
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		loc = time.UTC
	}

	newCount := 0
	parseErrors := 0
	for _, sh := range body.Shifts {
		start, err := parseShiftTime(sh.Start, loc)
		if err != nil {
			log.Printf("[scrape-callback] failed to parse start time %q: %v", sh.Start, err)
			parseErrors++
			continue
		}
		end, err := parseShiftTime(sh.End, loc)
		if err != nil {
			log.Printf("[scrape-callback] failed to parse end time %q: %v", sh.End, err)
			parseErrors++
			continue
		}

		var already int
		s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM shifts WHERE user_id = ? AND shift_id_ext = ?`,
			userID, sh.ShiftIDExt,
		).Scan(&already)

		_, err = s.db.ExecContext(ctx, `
			INSERT INTO shifts (id, user_id, shift_id_ext, job_name, location, start_time, end_time, net_hours, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (user_id, shift_id_ext) DO NOTHING
		`, uuid.NewString(), userID, sh.ShiftIDExt, sh.JobName, sh.Location,
			start.UTC().Unix(), end.UTC().Unix(), sh.NetHours, time.Now().UTC().Unix())
		if err == nil && already == 0 {
			newCount++
		}
	}

	if parseErrors > 0 {
		log.Printf("[scrape-callback] %d/%d shifts had unparseable timestamps", parseErrors, len(body.Shifts))
	}
	log.Printf("[scrape-callback] scrape %s: %d found, %d new, %d parse errors", key, len(body.Shifts), newCount, parseErrors)

	_, _ = s.db.ExecContext(ctx, `
		UPDATE scrape_logs SET status = 'success', finished_at = ?, shifts_found = ?, shifts_new = ? WHERE id = ?
	`, time.Now().UTC().Unix(), len(body.Shifts), newCount, logID)
	s.scraper.ScheduleNext(ctx, userID)

	c.JSON(http.StatusOK, gin.H{"accepted": len(body.Shifts), "new": newCount})
}

// receives failure logs and screenshots from the scraper container
func (s *Server) scrapeSubmitFailure(c *gin.Context) {
	key := c.GetHeader("X-Scrape-Key")
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing X-Scrape-Key header"})
		return
	}
	ctx := c.Request.Context()

	var logID, userID string
	err := s.db.QueryRowContext(ctx,
		`SELECT id, user_id FROM scrape_logs WHERE scrape_key = ? AND status = 'running'`, key,
	).Scan(&logID, &userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invalid or expired scrape key"})
		return
	}

	var body struct {
		Logs        []string `json:"logs"`
		Screenshots []string `json:"screenshots"` // base64-encoded PNG
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	logsJSON, _ := json.Marshal(body.Logs)
	screenshotsJSON, _ := json.Marshal(body.Screenshots)

	_, _ = s.db.ExecContext(ctx, `
		UPDATE scrape_logs SET status = 'failure', finished_at = ?, error_message = 'scraper reported failure',
		log_output = ?, failure_screenshots = ? WHERE id = ?
	`, time.Now().UTC().Unix(), string(logsJSON), string(screenshotsJSON), logID)
	s.scraper.HandleScrapeFailure(ctx, logID, userID)

	c.JSON(http.StatusOK, gin.H{"ok": true})
}
