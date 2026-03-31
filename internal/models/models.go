package models

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID        uuid.UUID `json:"id"`
	Email     string    `json:"email"`
	IsAdmin   bool      `json:"is_admin"`
	Timezone  string    `json:"timezone"`
	ICSToken  string    `json:"-"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Session struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	TokenHash []byte
	ExpiresAt time.Time
	CreatedAt time.Time
}

type UserDEK struct {
	UserID       uuid.UUID
	EncryptedDEK []byte
	DEKNonce     []byte
	CreatedAt    time.Time
}

type StarbucksCredentials struct {
	UserID                    uuid.UUID
	EncryptedUsername         []byte
	UsernameNonce             []byte
	EncryptedPassword         []byte
	PasswordNonce             []byte
	EncryptedSecurityQuestions []byte
	SecurityQuestionsNonce    []byte
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
}

// stored as JSON in the encrypted blob
type SecurityQuestion struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

// input received from the user
type CredentialsInput struct {
	Username          string             `json:"username" binding:"required"`
	Password          string             `json:"password" binding:"required"`
	SecurityQuestions []SecurityQuestion `json:"security_questions" binding:"required,min=1"`
}

// credentials used internally by the scraper
type DecryptedCredentials struct {
	Username          string             `json:"username"`
	Password          string             `json:"password"`
	SecurityQuestions []SecurityQuestion `json:"security_questions"`
}

type Shift struct {
	ID          uuid.UUID `json:"id"`
	UserID      uuid.UUID `json:"user_id"`
	ShiftIDExt  string    `json:"shift_id_ext"`
	JobName     string    `json:"job_name"`
	Location    string    `json:"location"`
	StartTime   time.Time `json:"start_time"`
	EndTime     time.Time `json:"end_time"`
	NetHours    float64   `json:"net_hours"`
	CreatedAt   time.Time `json:"created_at"`
}

type ScrapeLog struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"user_id"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at"`
	Status       string     `json:"status"`
	ShiftsFound  *int       `json:"shifts_found"`
	ShiftsNew    *int       `json:"shifts_new"`
	ErrorMessage *string    `json:"error_message"`
	ContainerID  *string    `json:"container_id"`
}

type ScrapeSchedule struct {
	UserID        uuid.UUID
	NextScrapeAt  time.Time
	LastScrapedAt *time.Time
}
