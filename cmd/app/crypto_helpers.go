package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/liz/sbuxsync/internal/models"
)

// retrieves the plaintext DEK, creating and storing one if missing
func (s *Server) getOrCreateDEK(ctx context.Context, userID uuid.UUID) ([]byte, error) {
	var dek models.UserDEK
	err := s.db.QueryRowContext(ctx,
		`SELECT encrypted_dek, dek_nonce FROM user_deks WHERE user_id = ?`, userID.String(),
	).Scan(&dek.EncryptedDEK, &dek.DEKNonce)

	if err == nil {
		return s.crypto.DecryptDEK(dek.EncryptedDEK, dek.DEKNonce)
	}
	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("load DEK: %w", err)
	}

	plainDEK, encDEK, nonce, err := s.crypto.GenerateDEK()
	if err != nil {
		return nil, fmt.Errorf("generate DEK: %w", err)
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO user_deks (user_id, encrypted_dek, dek_nonce, created_at) VALUES (?, ?, ?, ?)`,
		userID.String(), encDEK, nonce, time.Now().UTC().Unix(),
	)
	if err != nil {
		return nil, fmt.Errorf("store DEK: %w", err)
	}

	return plainDEK, nil
}

// returns shifts for a user from 7 days ago onward
func (s *Server) queryUserShifts(ctx context.Context, userID uuid.UUID) ([]models.Shift, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, shift_id_ext, job_name, location, start_time, end_time, net_hours, created_at
		FROM shifts
		WHERE user_id = ? AND end_time > unixepoch('now', '-7 days')
		ORDER BY start_time ASC
	`, userID.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var shifts []models.Shift
	for rows.Next() {
		sh, err := scanShift(rows)
		if err != nil {
			continue
		}
		sh.UserID = userID
		shifts = append(shifts, sh)
	}
	return shifts, nil
}

func scanShift(scanner interface{ Scan(dest ...any) error }) (models.Shift, error) {
	var sh models.Shift
	var startTS int64
	var endTS int64
	var createdTS int64
	err := scanner.Scan(&sh.ID, &sh.ShiftIDExt, &sh.JobName, &sh.Location, &startTS, &endTS, &sh.NetHours, &createdTS)
	if err != nil {
		return models.Shift{}, err
	}
	sh.StartTime = timeFromUnix(startTS)
	sh.EndTime = timeFromUnix(endTS)
	sh.CreatedAt = timeFromUnix(createdTS)
	return sh, nil
}

func timeFromUnix(ts int64) time.Time {
	return time.Unix(ts, 0).UTC()
}

func nullUnixToPtr(v sql.NullInt64) *time.Time {
	if !v.Valid {
		return nil
	}
	t := timeFromUnix(v.Int64)
	return &t
}
