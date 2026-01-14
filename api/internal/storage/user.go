package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// User представляет информацию о пользователе
type User struct {
	ID               uuid.UUID      `json:"id" gorm:"type:uuid;primary_key"`
	Email            string         `json:"email" gorm:"uniqueIndex;not null"`
	PasswordHash     string         `json:"-" gorm:"not null"`
	Name             string         `json:"name"`
	WebSearchEnabled bool           `json:"web_search_enabled" gorm:"default:false"`
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

// CreateUser создает нового пользователя
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

	result := s.DB.WithContext(ctx).Create(user)
	if result.Error != nil {
		return nil, result.Error
	}

	return user, nil
}

// GetUserByEmail получает пользователя по email
func (s *Storage) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	var user User
	result := s.DB.WithContext(ctx).Where("email = ?", email).First(&user)
	if result.Error != nil {
		return nil, result.Error
	}
	return &user, nil
}

// GetUserByID получает пользователя по ID
func (s *Storage) GetUserByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var user User
	result := s.DB.WithContext(ctx).First(&user, "id = ?", id)
	if result.Error != nil {
		return nil, result.Error
	}
	return &user, nil
}

// VerifyPassword проверяет соответствие пароля хешу
func (u *User) VerifyPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}

// UpdateUser обновляет данные пользователя
func (s *Storage) UpdateUser(ctx context.Context, user *User) error {
	result := s.DB.WithContext(ctx).Model(user).Updates(user)
	if result.Error != nil {
		return result.Error
	}
	return nil
}
