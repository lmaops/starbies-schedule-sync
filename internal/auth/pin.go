package auth

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"
)

const (
	pinExpiry   = 10 * time.Minute
	maxAttempts = 5
)

// generates a random 6-digit PIN
func GeneratePIN() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", fmt.Errorf("generate PIN: %w", err)
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

type pinEntry struct {
	pin       string
	attempts  int
	expiresAt time.Time
}

// in-memory PIN store; concurrent-safe
type PinStore struct {
	mu      sync.Mutex
	entries map[string]*pinEntry // keyed by email (lowercase)
	stop    chan struct{}
}

// creates a PinStore and starts a background cleanup goroutine
func NewPinStore() *PinStore {
	s := &PinStore{
		entries: make(map[string]*pinEntry),
		stop:    make(chan struct{}),
	}
	go s.cleanup()
	return s
}

// stops the background cleanup goroutine
func (s *PinStore) Close() {
	close(s.stop)
}

// saves a PIN for the email, replacing any existing entry
func (s *PinStore) Store(email, pin string) {
	key := strings.ToLower(email)
	s.mu.Lock()
	s.entries[key] = &pinEntry{
		pin:       pin,
		expiresAt: time.Now().Add(pinExpiry),
	}
	s.mu.Unlock()
}

// checks the PIN; deletes it on success so it can't be reused
func (s *PinStore) Verify(email, pin string) error {
	key := strings.ToLower(email)
	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.entries[key]
	if !ok {
		return fmt.Errorf("no PIN found for this email")
	}

	if time.Now().After(e.expiresAt) {
		delete(s.entries, key)
		return fmt.Errorf("PIN has expired")
	}

	if e.attempts >= maxAttempts {
		return fmt.Errorf("too many incorrect attempts")
	}

	if pin != e.pin {
		e.attempts++
		remaining := maxAttempts - e.attempts
		return fmt.Errorf("incorrect PIN (%d attempts remaining)", remaining)
	}

	delete(s.entries, key)
	return nil
}

func (s *PinStore) cleanup() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			now := time.Now()
			s.mu.Lock()
			for k, e := range s.entries {
				if now.After(e.expiresAt) {
					delete(s.entries, k)
				}
			}
			s.mu.Unlock()
		}
	}
}
