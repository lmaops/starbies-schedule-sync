package main

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/liz/sbuxsync/internal/models"
)

func (s *Server) updateTimezone(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	var body struct {
		Timezone string `json:"timezone" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := time.LoadLocation(body.Timezone); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid timezone"})
		return
	}
	now := time.Now().UTC()
	if _, err := s.db.ExecContext(c.Request.Context(),
		`UPDATE users SET timezone = ?, updated_at = ? WHERE id = ?`,
		body.Timezone, now.Unix(), user.ID.String(),
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not update timezone"})
		return
	}
	user.Timezone = body.Timezone
	c.JSON(http.StatusOK, user)
}
