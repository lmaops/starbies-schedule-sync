package main

import (
	"database/sql"
	"io/fs"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/liz/sbuxsync/internal/auth"
	appCrypto "github.com/liz/sbuxsync/internal/crypto"
	"github.com/liz/sbuxsync/internal/models"
	"github.com/liz/sbuxsync/internal/scraper"
)

type Server struct {
	db            *sql.DB
	crypto        *appCrypto.EnvelopeCrypto
	scraper       *scraper.ScraperService
	router        *gin.Engine
	pinStore      *auth.PinStore
	pinRequestRL  *auth.RateLimiter
	pinVerifyRL   *auth.RateLimiter
	credentialRL  *auth.RateLimiter // per-user: 1 request per 30s
	scrapeRL      *auth.RateLimiter // per-user: 10 scrapes per 48h
	icsRL         *auth.RateLimiter // per-IP: brute-force protection on ICS tokens
	internalCIDRs []*net.IPNet
}

func NewServer(db *sql.DB, mekHex string, scraperSvc *scraper.ScraperService, pinStore *auth.PinStore, pinRequestRL, pinVerifyRL, credentialRL, scrapeRL, icsRL *auth.RateLimiter, internalCIDRs []*net.IPNet) *Server {
	ec, err := appCrypto.New(mekHex)
	if err != nil {
		panic("invalid MEK: " + err.Error())
	}

	s := &Server{
		db:            db,
		crypto:        ec,
		scraper:       scraperSvc,
		pinStore:      pinStore,
		pinRequestRL:  pinRequestRL,
		pinVerifyRL:   pinVerifyRL,
		credentialRL:  credentialRL,
		scrapeRL:      scrapeRL,
		icsRL:         icsRL,
		internalCIDRs: internalCIDRs,
	}
	s.router = s.setupRoutes()
	return s
}

func (s *Server) Run(addr string) error {
	return s.router.Run(addr)
}

func (s *Server) setupRoutes() *gin.Engine {
	r := gin.Default()
	r.SetTrustedProxies([]string{"127.0.0.1", "::1"})

	staticContent, err := fs.Sub(staticFS, "static")
	if err != nil {
		panic("static FS: " + err.Error())
	}

	// Config (public)
	r.GET("/api/config", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"commit_sha": CommitSHA,
			"commit_url": CommitURL,
		})
	})

	// Auth routes
	a := r.Group("/api/auth")
	{
		a.POST("/request-pin", s.pinRequestRL.Middleware(), s.requestPin)
		a.POST("/verify-pin", s.pinVerifyRL.Middleware(), s.verifyPin)
		a.POST("/logout", s.logout)
		a.GET("/me", s.authMiddleware(), s.me)
	}

	// Authenticated app routes
	api := r.Group("/api", s.authMiddleware())
	{
		api.POST("/credentials", s.writeCredentials)
		api.PUT("/credentials", s.writeCredentials)
		api.DELETE("/account", s.deleteAccount)
		api.GET("/schedule", s.getSchedule)
		api.PATCH("/settings/timezone", s.updateTimezone)
		api.GET("/calendar/ics-url", s.getICSURL)
		api.GET("/scrape-status", s.scrapeStatus)
		api.GET("/scrape-logs", s.userScrapeLogs)
		api.GET("/onboarding-status", s.onboardingStatus)
	}

	// scrape callback routes — auth via X-Scrape-Key header, body limited to 5MB, internal IPs only
	internal := r.Group("/internal", maxBodySize(5<<20), s.internalOnly())
	{
		internal.GET("/scrape/credentials", s.scrapeGetCredentials)
		internal.POST("/scrape/shifts", s.scrapeSubmitShifts)
		internal.POST("/scrape/failure", s.scrapeSubmitFailure)
	}

	// .ics feed — auth via url token, rate limited per IP against brute-forcing
	r.GET("/cal/:icsfile", s.icsRL.Middleware(), s.serveICS)

	// Admin routes
	admin := r.Group("/api/admin", s.authMiddleware(), s.adminMiddleware())
	{
		admin.GET("/scrape-logs", s.adminScrapeLogs)
		admin.GET("/users", s.adminUsers)
		admin.POST("/trigger-scrape/:userId", s.adminTriggerScrape)
	}

	// serve static files
	assetsSubFS, err := fs.Sub(staticContent, "assets")
	if err != nil {
		panic("assets sub FS: " + err.Error())
	}
	r.StaticFS("/assets", http.FS(assetsSubFS))

	serveStatic := func(name, contentType string) gin.HandlerFunc {
		return func(c *gin.Context) {
			data, _ := fs.ReadFile(staticContent, name)
			c.Data(http.StatusOK, contentType, data)
		}
	}
	r.GET("/icons.svg", serveStatic("icons.svg", "image/svg+xml"))
	r.GET("/favicon.ico", serveStatic("favicon.ico", "image/x-icon"))
	r.GET("/favicon-16x16.png", serveStatic("favicon-16x16.png", "image/png"))
	r.GET("/favicon-32x32.png", serveStatic("favicon-32x32.png", "image/png"))
	r.GET("/apple-touch-icon.png", serveStatic("apple-touch-icon.png", "image/png"))
	r.GET("/android-chrome-192x192.png", serveStatic("android-chrome-192x192.png", "image/png"))
	r.GET("/android-chrome-512x512.png", serveStatic("android-chrome-512x512.png", "image/png"))
	r.GET("/site.webmanifest", serveStatic("site.webmanifest", "application/manifest+json"))

	// spa fallback — serve index.html for non-api routes
	indexPath, _ := fs.ReadFile(staticContent, "index.html")
	r.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") || strings.HasPrefix(c.Request.URL.Path, "/cal/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexPath)
	})

	return r
}

// middleware

func (s *Server) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, err := c.Cookie(auth.CookieName)
		if err != nil || token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
			return
		}
		user, err := auth.GetSessionUser(c.Request.Context(), s.db, token)
		if err != nil || user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "session expired"})
			return
		}
		c.Set("user", user)
		c.Next()
	}
}

func (s *Server) adminMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := c.MustGet("user").(*models.User)
		if !user.IsAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin access required"})
			return
		}
		c.Next()
	}
}

// middleware that limits request body size
func maxBodySize(n int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, n)
		}
		c.Next()
	}
}

// middleware that restricts access to internal CIDRs only
func (s *Server) internalOnly() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := net.ParseIP(c.ClientIP())
		if ip == nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid client IP"})
			return
		}
		for _, cidr := range s.internalCIDRs {
			if cidr.Contains(ip) {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "access denied"})
	}
}

// auth handlers

func (s *Server) requestPin(c *gin.Context) {
	var body struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pin, err := auth.GeneratePIN()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not generate PIN"})
		return
	}

	s.pinStore.Store(body.Email, pin)

	// always create user to prevent email enumeration
	if _, err := auth.FindOrCreateUser(c.Request.Context(), s.db, body.Email); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not process request"})
		return
	}

	if err := sendPINEmail(body.Email, pin); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not send PIN email"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "PIN sent to " + body.Email})
}

func (s *Server) verifyPin(c *gin.Context) {
	var body struct {
		Email string `json:"email" binding:"required,email"`
		PIN   string `json:"pin" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := s.pinStore.Verify(body.Email, body.PIN); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// user already created in request-pin; this is a fallback for the edge case
	user, err := auth.FindOrCreateUser(c.Request.Context(), s.db, body.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create user"})
		return
	}

	token, err := auth.CreateSession(c.Request.Context(), s.db, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create session"})
		return
	}

	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(auth.CookieName, token, int((90 * 24 * time.Hour).Seconds()), "/", "", true, true)
	c.JSON(http.StatusOK, user)
}

func (s *Server) logout(c *gin.Context) {
	token, _ := c.Cookie(auth.CookieName)
	if token != "" {
		_ = auth.DeleteSession(c.Request.Context(), s.db, token)
	}
	c.SetCookie(auth.CookieName, "", -1, "/", "", true, true)
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

func (s *Server) me(c *gin.Context) {
	user := c.MustGet("user").(*models.User)
	c.JSON(http.StatusOK, user)
}
