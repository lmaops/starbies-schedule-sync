package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/liz/sbuxsync/internal/models"
)

func (s *Server) scrapeStatus(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	ctx := c.Request.Context()

	var status sql.NullString
	var startedAt sql.NullInt64
	var finishedAt sql.NullInt64
	var errorMessage sql.NullString
	var shiftsFound sql.NullInt64
	var logOutput sql.NullString
	var failureScreenshots sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT status, started_at, finished_at, error_message, shifts_found, log_output, failure_screenshots
		FROM scrape_logs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1
	`, user.ID.String()).Scan(&status, &startedAt, &finishedAt, &errorMessage, &shiftsFound, &logOutput, &failureScreenshots)

	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, gin.H{})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not fetch scrape status"})
		return
	}

	resp := gin.H{
		"status":              nilStr(status),
		"started_at":          nilTime(startedAt),
		"finished_at":         nilTime(finishedAt),
		"error_message":       nilStr(errorMessage),
		"shifts_found":        nilInt(shiftsFound),
		"failure_screenshots": parseJSONArray(failureScreenshots),
		"log_output":          parseJSONArray(logOutput),
	}

	c.JSON(http.StatusOK, resp)
}

func (s *Server) onboardingStatus(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	ctx := c.Request.Context()

	var hasCreds int
	s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM starbucks_credentials WHERE user_id = ?`, user.ID.String(),
	).Scan(&hasCreds)

	var hasSuccess int
	s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM scrape_logs WHERE user_id = ? AND status = 'success' LIMIT 1`, user.ID.String(),
	).Scan(&hasSuccess)

	c.JSON(http.StatusOK, gin.H{
		"has_credentials":      hasCreds > 0,
		"has_successful_scrape": hasSuccess > 0,
	})
}

func (s *Server) userScrapeLogs(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	ctx := c.Request.Context()

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, started_at, finished_at, status,
		       shifts_found, shifts_new, error_message, log_output, failure_screenshots
		FROM scrape_logs
		WHERE user_id = ?
		ORDER BY started_at DESC
		LIMIT 5
	`, user.ID.String())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not fetch scrape logs"})
		return
	}
	defer rows.Close()

	type LogRow struct {
		ID                 string  `json:"id"`
		UserID             string  `json:"user_id"`
		StartedAt          string  `json:"started_at"`
		FinishedAt         *string `json:"finished_at"`
		Status             string  `json:"status"`
		ShiftsFound        *int    `json:"shifts_found"`
		ShiftsNew          *int    `json:"shifts_new"`
		ErrorMessage       *string `json:"error_message"`
		LogOutput          *string `json:"log_output"`
		FailureScreenshots *string `json:"failure_screenshots"`
	}

	var logs []LogRow
	for rows.Next() {
		var row LogRow
		var startedAt int64
		var finishedAt sql.NullInt64
		if err := rows.Scan(&row.ID, &row.UserID, &startedAt, &finishedAt,
			&row.Status, &row.ShiftsFound, &row.ShiftsNew, &row.ErrorMessage,
			&row.LogOutput, &row.FailureScreenshots); err != nil {
			continue
		}
		row.StartedAt = timeFromUnix(startedAt).Format(time.RFC3339)
		if finishedAt.Valid {
			v := timeFromUnix(finishedAt.Int64).Format(time.RFC3339)
			row.FinishedAt = &v
		}
		logs = append(logs, row)
	}
	if logs == nil {
		logs = []LogRow{}
	}
	c.JSON(http.StatusOK, gin.H{"logs": logs})
}

// helpers

func nilStr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

func nilInt(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	return &v.Int64
}

func nilTime(v sql.NullInt64) *string {
	if !v.Valid {
		return nil
	}
	t := timeFromUnix(v.Int64).Format(time.RFC3339)
	return &t
}

func parseJSONArray(v sql.NullString) []string {
	if !v.Valid || v.String == "" {
		return nil
	}
	var arr []string
	if err := json.Unmarshal([]byte(v.String), &arr); err != nil {
		return nil
	}
	return arr
}
