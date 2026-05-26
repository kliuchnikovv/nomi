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
	AgentStorageMode string         `json:"agent_storage_mode" gorm:"default:'payload'"`
	// Proactive / reactive-agent fields
	UpdatesChatID    *uuid.UUID     `json:"updates_chat_id,omitempty" gorm:"type:uuid;default:null"`
	QuietHoursStart  *string        `json:"quiet_hours_start,omitempty" gorm:"type:time;default:null"`
	QuietHoursEnd    *string        `json:"quiet_hours_end,omitempty" gorm:"type:time;default:null"`
	ProactiveEnabled bool           `json:"proactive_enabled" gorm:"default:false"`
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
