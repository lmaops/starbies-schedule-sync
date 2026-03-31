package main

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (s *Server) adminScrapeLogs(c *gin.Context) {
	ctx := c.Request.Context()

	rows, err := s.db.QueryContext(ctx, `
		SELECT l.id, l.user_id, u.email, l.started_at, l.finished_at, l.status,
		       l.shifts_found, l.shifts_new, l.error_message, l.container_id,
		       l.scrape_key, l.log_output, l.failure_screenshots
		FROM scrape_logs l
		JOIN users u ON u.id = l.user_id
		ORDER BY l.started_at DESC
		LIMIT 200
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not fetch logs"})
		return
	}
	defer rows.Close()

	type LogRow struct {
		ID                 string  `json:"id"`
		UserID             string  `json:"user_id"`
		Email              string  `json:"email"`
		StartedAt          string  `json:"started_at"`
		FinishedAt         *string `json:"finished_at"`
		Status             string  `json:"status"`
		ShiftsFound        *int    `json:"shifts_found"`
		ShiftsNew          *int    `json:"shifts_new"`
		ErrorMessage       *string `json:"error_message"`
		ContainerID        *string `json:"container_id"`
		ScrapeKey          *string `json:"scrape_key"`
		LogOutput          *string `json:"log_output"`
		FailureScreenshots *string `json:"failure_screenshots"`
	}

	var logs []LogRow
	for rows.Next() {
		var row LogRow
		var startedAt int64
		var finishedAt sql.NullInt64
		if err := rows.Scan(&row.ID, &row.UserID, &row.Email, &startedAt, &finishedAt,
			&row.Status, &row.ShiftsFound, &row.ShiftsNew, &row.ErrorMessage, &row.ContainerID,
			&row.ScrapeKey, &row.LogOutput, &row.FailureScreenshots); err != nil {
			continue
		}
		started := timeFromUnix(startedAt).Format(time.RFC3339)
		row.StartedAt = started
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

func (s *Server) adminUsers(c *gin.Context) {
	ctx := c.Request.Context()

	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.email, u.is_admin, u.created_at,
		       ss.last_scraped_at, ss.next_scrape_at,
		       (SELECT COUNT(*) FROM shifts WHERE user_id = u.id) AS shift_count,
		       (SELECT status FROM scrape_logs WHERE user_id = u.id ORDER BY started_at DESC LIMIT 1) AS last_status
		FROM users u
		LEFT JOIN scrape_schedule ss ON ss.user_id = u.id
		ORDER BY u.created_at DESC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not fetch users"})
		return
	}
	defer rows.Close()

	type UserRow struct {
		ID            string  `json:"id"`
		Email         string  `json:"email"`
		IsAdmin       bool    `json:"is_admin"`
		CreatedAt     string  `json:"created_at"`
		LastScrapedAt *string `json:"last_scraped_at"`
		NextScrapeAt  *string `json:"next_scrape_at"`
		ShiftCount    int     `json:"shift_count"`
		LastStatus    *string `json:"last_status"`
	}

	var users []UserRow
	for rows.Next() {
		var row UserRow
		var isAdmin int64
		var createdAt int64
		var lastScrapedAt sql.NullInt64
		var nextScrapeAt sql.NullInt64
		if err := rows.Scan(&row.ID, &row.Email, &isAdmin, &createdAt,
			&lastScrapedAt, &nextScrapeAt, &row.ShiftCount, &row.LastStatus); err != nil {
			continue
		}
		row.IsAdmin = isAdmin != 0
		row.CreatedAt = timeFromUnix(createdAt).Format(time.RFC3339)
		if lastScrapedAt.Valid {
			v := timeFromUnix(lastScrapedAt.Int64).Format(time.RFC3339)
			row.LastScrapedAt = &v
		}
		if nextScrapeAt.Valid {
			v := timeFromUnix(nextScrapeAt.Int64).Format(time.RFC3339)
			row.NextScrapeAt = &v
		}
		users = append(users, row)
	}
	if users == nil {
		users = []UserRow{}
	}
	c.JSON(http.StatusOK, gin.H{"users": users})
}

func (s *Server) adminTriggerScrape(c *gin.Context) {
	userID, err := uuid.Parse(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
		return
	}
	go s.scraper.TriggerScrape(userID)
	c.JSON(http.StatusOK, gin.H{"message": "scrape triggered"})
}
