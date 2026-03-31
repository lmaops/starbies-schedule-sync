package main

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/liz/sbuxsync/internal/calendar"
	"github.com/liz/sbuxsync/internal/models"
)

func (s *Server) serveICS(c *gin.Context) {
	token := strings.TrimSuffix(c.Param("icsfile"), ".ics")
	if token == "" {
		c.Status(http.StatusNotFound)
		return
	}

	ctx := c.Request.Context()

	var user models.User
	err := s.db.QueryRowContext(ctx,
		`SELECT id, email, timezone FROM users WHERE ics_token = ?`, token,
	).Scan(&user.ID, &user.Email, &user.Timezone)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}

	shifts, err := s.queryUserShifts(ctx, user.ID)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}

	icsContent := calendar.GenerateICS(shifts)

	c.Header("Content-Type", "text/calendar; charset=utf-8")
	c.Header("Content-Disposition", "attachment; filename=\"schedule.ics\"")
	c.Header("Cache-Control", "no-cache, no-store")
	c.String(http.StatusOK, icsContent)
}

