package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// User represents user information
type User struct {
	ID               uuid.UUID      `json:"id" gorm:"type:uuid;primary_key"`
	Email            string         `json:"email" gorm:"uniqueIndex;not null"`
	PasswordHash     string         `json:"-" gorm:"not null"`
	Name             string         `json:"name"`
	WebSearchEnabled bool           `json:"web_search_enabled" gorm:"default:false"`
	SingleChatMode   bool           `json:"single_chat_mode" gorm:"default:false"`
	// VoiceSource selects how the voice screen produces speech:
	// 'on_device' (expo-speech, default) or 'server_gemini' (server-side Gemini TTS).
	VoiceSource      string         `json:"voice_source" gorm:"default:'on_device'"`
	// Proactive / reactive-agent fields
	UpdatesChatID    *uuid.UUID     `json:"updates_chat_id,omitempty" gorm:"type:uuid;default:null"`
	QuietHoursStart  *string        `json:"quiet_hours_start,omitempty" gorm:"type:time;default:null"`
	QuietHoursEnd    *string        `json:"quiet_hours_end,omitempty" gorm:"type:time;default:null"`
	ProactiveEnabled bool           `json:"proactive_enabled" gorm:"default:false"`
	// Scheduled daily-brief fields (proactive agent run at a user-chosen local time).
	Timezone           *string    `json:"timezone,omitempty" gorm:"type:text;default:null"`            // IANA, e.g. "Europe/Moscow"
	DailyBriefTime     *string    `json:"daily_brief_time,omitempty" gorm:"type:text;default:null"`    // "HH:MM" local time; null = disabled
	DailyBriefLastSent *time.Time `json:"daily_brief_last_sent,omitempty" gorm:"default:null"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `json:"-" gorm:"index"`
}

func (base *User) BeforeCreate(tx *gorm.DB) (err error) {
	if base.ID == uuid.Nil {
		base.ID = uuid.New()
	}
	return
}

// CreateUser creates a new user and provisions their Updates chat in one
// transaction. The user is returned with UpdatesChatID already set.
func (s *Storage) CreateUser(ctx context.Context, email, password, name string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &User{
		Email:        email,
		PasswordHash: string(hash),
		Name:         name,
	}

	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(user).Error; err != nil {
			return err
		}

		// Provision the Updates chat inside the same transaction so a user
		// is never persisted without an Updates chat.
		chatID, err := s.ensureUpdatesChatTx(ctx, tx, user.ID)
		if err != nil {
			return fmt.Errorf("create updates chat for user %s: %w", user.ID, err)
		}
		user.UpdatesChatID = &chatID

		return tx.Model(&User{}).
			Where("id = ?", user.ID).
			Update("updates_chat_id", chatID).Error
	})
	if err != nil {
		return nil, err
	}

	return user, nil
}

// GetUserByEmail gets a user by email
func (s *Storage) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var user User
	result := s.DB.WithContext(ctx).Where("email = ?", email).First(&user)
	if result.Error != nil {
		return nil, result.Error
	}
	return &user, nil
}

// GetUserByID gets a user by ID
func (s *Storage) GetUserByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var user User
	result := s.DB.WithContext(ctx).First(&user, "id = ?", id)
	if result.Error != nil {
		return nil, result.Error
	}
	return &user, nil
}

// VerifyPassword checks if the password matches the hash
func (u *User) VerifyPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}

// UpdateUser updates user data
func (s *Storage) UpdateUser(ctx context.Context, user *User) error {
	result := s.DB.WithContext(ctx).Model(user).Updates(user)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

// ListDailyBriefCandidates returns users who have opted into proactive updates
// and configured a daily-brief time. The scheduler evaluates each candidate's
// local clock to decide whether to fire today's brief.
func (s *Storage) ListDailyBriefCandidates(ctx context.Context) ([]User, error) {
	var users []User
	result := s.DB.WithContext(ctx).
		Where("proactive_enabled = ? AND daily_brief_time IS NOT NULL", true).
		Find(&users)
	if result.Error != nil {
		return nil, result.Error
	}
	return users, nil
}

// MarkDailyBriefSent records the timestamp at which a user's daily brief was
// last dispatched, used for once-per-day idempotency.
func (s *Storage) MarkDailyBriefSent(ctx context.Context, userID uuid.UUID, t time.Time) error {
	return s.DB.WithContext(ctx).
		Model(&User{}).
		Where("id = ?", userID).
		Update("daily_brief_last_sent", t).Error
}

// SetDailyBrief updates a user's timezone and daily-brief time. A nil briefTime
// disables the daily brief (column set to NULL).
func (s *Storage) SetDailyBrief(ctx context.Context, userID uuid.UUID, timezone, briefTime *string) error {
	updates := map[string]any{
		"daily_brief_time": briefTime, // nil → NULL (disable)
	}
	if timezone != nil {
		updates["timezone"] = *timezone
	}
	return s.DB.WithContext(ctx).
		Model(&User{}).
		Where("id = ?", userID).
		Updates(updates).Error
}
