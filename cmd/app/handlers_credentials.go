package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/liz/sbuxsync/internal/auth"
	"github.com/liz/sbuxsync/internal/models"
)

func (s *Server) writeCredentials(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	ctx := c.Request.Context()
	uid := user.ID.String()

	// rate limit: 1 credential update per 30s per user
	if !s.credentialRL.Allow(uid) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "please wait before updating credentials again"})
		return
	}

	// rate limit: 10 user-initiated scrapes per 48h
	if !s.scrapeRL.Allow(uid) {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "scrape limit reached (10 per 48 hours), try again later"})
		return
	}

	var input models.CredentialsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	plainDEK, err := s.getOrCreateDEK(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption error"})
		return
	}

	encUsername, unNonce, err := s.crypto.Encrypt(plainDEK, []byte(input.Username))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption error"})
		return
	}

	encPassword, pwNonce, err := s.crypto.Encrypt(plainDEK, []byte(input.Password))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption error"})
		return
	}

	sqJSON, err := json.Marshal(input.SecurityQuestions)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid security questions"})
		return
	}
	encSQ, sqNonce, err := s.crypto.Encrypt(plainDEK, sqJSON)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "encryption error"})
		return
	}

	now := time.Now().UTC().Unix()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO starbucks_credentials
			(user_id, encrypted_username, username_nonce, encrypted_password, password_nonce,
			 encrypted_security_questions, security_questions_nonce, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (user_id) DO UPDATE SET
			encrypted_username = EXCLUDED.encrypted_username,
			username_nonce = EXCLUDED.username_nonce,
			encrypted_password = EXCLUDED.encrypted_password,
			password_nonce = EXCLUDED.password_nonce,
			encrypted_security_questions = EXCLUDED.encrypted_security_questions,
			security_questions_nonce = EXCLUDED.security_questions_nonce,
			updated_at = EXCLUDED.updated_at
	`, user.ID.String(), encUsername, unNonce, encPassword, pwNonce, encSQ, sqNonce, now, now)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not store credentials"})
		return
	}

	_, _ = s.db.ExecContext(ctx, `
		INSERT INTO scrape_schedule (user_id, next_scrape_at)
		VALUES (?, ?)
		ON CONFLICT (user_id) DO UPDATE SET next_scrape_at = EXCLUDED.next_scrape_at
	`, user.ID.String(), now)

	go s.scraper.TriggerScrape(user.ID)

	c.JSON(http.StatusOK, gin.H{"message": "credentials saved"})
}

func (s *Server) deleteAccount(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	ctx := c.Request.Context()

	_, err := s.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, user.ID.String())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not delete account"})
		return
	}

	c.SetCookie(auth.CookieName, "", -1, "/", "", true, true)
	c.JSON(http.StatusOK, gin.H{"message": "account deleted"})
}

func (s *Server) getSchedule(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	ctx := c.Request.Context()

	shifts, err := s.queryUserShifts(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not fetch schedule"})
		return
	}
	if shifts == nil {
		shifts = []models.Shift{}
	}

	var lastScrape sql.NullInt64
	var nextScrape sql.NullInt64
	_ = s.db.QueryRowContext(ctx, `SELECT last_scraped_at, next_scrape_at FROM scrape_schedule WHERE user_id = ?`, user.ID.String()).
		Scan(&lastScrape, &nextScrape)

	c.JSON(http.StatusOK, gin.H{
		"shifts":          shifts,
		"last_scraped_at": nullUnixToPtr(lastScrape),
		"next_scrape_at":  nullUnixToPtr(nextScrape),
	})
}

func (s *Server) getICSURL(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	baseURL := os.Getenv("BASE_URL")
	if baseURL == "" {
		baseURL = "http://localhost:8080"
	}
	url := fmt.Sprintf("%s/cal/%s.ics", baseURL, user.ICSToken)
	c.JSON(http.StatusOK, gin.H{"url": url})
}
