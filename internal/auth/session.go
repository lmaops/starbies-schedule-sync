package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"
	"github.com/liz/sbuxsync/internal/models"
)

const (
	sessionDuration = 90 * 24 * time.Hour
	CookieName      = "sbux_session"
)

func CreateSession(ctx context.Context, db *sql.DB, userID uuid.UUID) (string, error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	token := hex.EncodeToString(raw)
	hash := hashToken(token)
	now := time.Now().UTC()

	_, err := db.ExecContext(ctx,
		`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		uuid.NewString(), userID.String(), hash, now.Add(sessionDuration).Unix(), now.Unix(),
	)
	if err != nil {
		return "", fmt.Errorf("store session: %w", err)
	}
	return token, nil
}

func GetSessionUser(ctx context.Context, db *sql.DB, token string) (*models.User, error) {
	hash := hashToken(token)

	var u models.User
	var isAdmin int64
	var createdAt int64
	var updatedAt int64
	err := db.QueryRowContext(ctx, `
		SELECT u.id, u.email, u.is_admin, u.timezone, u.ics_token, u.created_at, u.updated_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?
	`, hash, time.Now().UTC().Unix()).Scan(&u.ID, &u.Email, &isAdmin, &u.Timezone, &u.ICSToken, &createdAt, &updatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("query session user: %w", err)
	}
	u.IsAdmin = isAdmin != 0
	u.CreatedAt = time.Unix(createdAt, 0).UTC()
	u.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return &u, nil
}

func DeleteSession(ctx context.Context, db *sql.DB, token string) error {
	_, err := db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = ?`, hashToken(token))
	return err
}

func FindOrCreateUser(ctx context.Context, db *sql.DB, email string) (*models.User, error) {
	user, err := getUserByEmail(ctx, db, email)
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	now := time.Now().UTC()
	icsToken, err := randomHex(32)
	if err != nil {
		return nil, fmt.Errorf("generate ics token: %w", err)
	}

	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id, email, is_admin, timezone, ics_token, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, uuid.NewString(), email, 0, "America/Chicago", icsToken, now.Unix(), now.Unix())
	if err != nil {
		user, lookupErr := getUserByEmail(ctx, db, email)
		if lookupErr == nil {
			return user, nil
		}
		return nil, fmt.Errorf("create user: %w", err)
	}

	return getUserByEmail(ctx, db, email)
}

func getUserByEmail(ctx context.Context, db *sql.DB, email string) (*models.User, error) {
	var u models.User
	var isAdmin int64
	var createdAt int64
	var updatedAt int64
	err := db.QueryRowContext(ctx, `
		SELECT id, email, is_admin, timezone, ics_token, created_at, updated_at
		FROM users WHERE email = ?
	`, email).Scan(&u.ID, &u.Email, &isAdmin, &u.Timezone, &u.ICSToken, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	u.IsAdmin = isAdmin != 0
	u.CreatedAt = time.Unix(createdAt, 0).UTC()
	u.UpdatedAt = time.Unix(updatedAt, 0).UTC()
	return &u, nil
}

func randomHex(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}
