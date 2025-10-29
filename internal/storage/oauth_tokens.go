package storage

import (
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

type OAuthToken struct {
	ID             uuid.UUID  `db:"id"`
	ProfileID      string     `db:"profile_id"`
	Provider       string     `db:"provider"`
	AccountEmail   string     `db:"account_email"`
	ExternalUserID string     `db:"external_user_id"`
	Scopes         []string   `db:"scopes"`
	TokenEncrypted []byte     `db:"token_encrypted"`
	CreatedAt      time.Time  `db:"created_at"`
	UpdatedAt      time.Time  `db:"updated_at"`
	Version        int        `db:"version"`
	DeletedAt      *time.Time `db:"deleted_at"`
}

func (s *Storage) SaveOAuthToken(token *OAuthToken) error {
	// In a real application, you would encrypt the token before storing it.
	// For now, we will store it as is.
	return s.DB.QueryRow(`
		INSERT INTO oauth_tokens (id, profile_id, provider, account_email, external_user_id, scopes, token_encrypted)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
		`,
		uuid.New(),
		token.ProfileID,
		token.Provider,
		token.AccountEmail,
		token.ExternalUserID,
		pq.StringArray(token.Scopes),
		token.TokenEncrypted,
	).Scan(&token.ID)
}
