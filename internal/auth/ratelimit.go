package auth

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// per-key sliding window rate limiter
type RateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	window   time.Duration
	limit    int
	stop     chan struct{}
}

// creates a limiter allowing limit requests per window per key
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		requests: make(map[string][]time.Time),
		window:   window,
		limit:    limit,
		stop:     make(chan struct{}),
	}
	go rl.sweep()
	return rl
}

// stops the background sweep goroutine
func (rl *RateLimiter) Close() {
	close(rl.stop)
}

// reports whether the key is within its rate limit; records the request if allowed
func (rl *RateLimiter) Allow(key string) bool {
	now := time.Now()
	cutoff := now.Add(-rl.window)

	rl.mu.Lock()
	defer rl.mu.Unlock()

	// prune timestamps outside the window
	timestamps := rl.requests[key]
	start := 0
	for start < len(timestamps) && timestamps[start].Before(cutoff) {
		start++
	}
	timestamps = timestamps[start:]

	if len(timestamps) >= rl.limit {
		rl.requests[key] = timestamps
		return false
	}

	rl.requests[key] = append(timestamps, now)
	return true
}

// gin middleware that returns 429 when the per-IP limit is exceeded
func (rl *RateLimiter) Middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !rl.Allow(c.ClientIP()) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "too many requests, try again later",
			})
			return
		}
		c.Next()
	}
}

func (rl *RateLimiter) sweep() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-rl.stop:
			return
		case <-ticker.C:
			cutoff := time.Now().Add(-rl.window)
			rl.mu.Lock()
			for key, ts := range rl.requests {
				// remove key if all timestamps are stale
				if len(ts) == 0 || ts[len(ts)-1].Before(cutoff) {
					delete(rl.requests, key)
				}
			}
			rl.mu.Unlock()
		}
	}
}
