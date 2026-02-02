package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/kliuchnikovv/genie-api/internal/storage/repositories"
)

// AuthService contains authentication business logic
type AuthService struct {
	userRepo     repositories.UserRepository
	tokenManager *auth.TokenManager
	storage      *storage.Storage
}

// NewAuthService creates a new instance of AuthService
func NewAuthService(userRepo repositories.UserRepository, tokenManager *auth.TokenManager, storage *storage.Storage) *AuthService {
	return &AuthService{
		userRepo:     userRepo,
		tokenManager: tokenManager,
		storage:      storage,
	}
}

// RegisterRequest представляет запрос на регистрацию
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

// LoginRequest представляет запрос на вход
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AuthResponse представляет ответ с токенами
type AuthResponse struct {
	Token        string        `json:"token"`
	RefreshToken string        `json:"refresh_token"`
	User         *storage.User `json:"user"`
}

// Register регистрирует нового пользователя
func (s *AuthService) Register(ctx context.Context, req *RegisterRequest) (*AuthResponse, error) {
	// Валидация
	if req.Email == "" || req.Password == "" {
		return nil, ErrInvalidRequest
	}

	// Создаем пользователя
	user, err := s.userRepo.CreateUser(ctx, req.Email, req.Password, req.Name)
	if err != nil {
		return nil, err
	}

	// Генерируем токены
	return s.generateTokens(ctx, user)
}

// Login аутентифицирует пользователя
func (s *AuthService) Login(ctx context.Context, req *LoginRequest) (*AuthResponse, error) {
	// Валидация
	if req.Email == "" || req.Password == "" {
		return nil, ErrInvalidCredentials
	}

	// Получаем пользователя
	user, err := s.userRepo.GetUserByEmail(ctx, req.Email)
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	// Проверяем пароль
	if !user.VerifyPassword(req.Password) {
		return nil, ErrInvalidCredentials
	}

	// Генерируем токены
	return s.generateTokens(ctx, user)
}

// Refresh обновляет токены используя refresh token
func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (*AuthResponse, error) {
	if refreshToken == "" {
		return nil, ErrInvalidRefreshToken
	}

	// Потребляем refresh token
	rec, err := s.storage.ConsumeRefreshToken(ctx, refreshToken)
	if err != nil {
		return nil, ErrInvalidRefreshToken
	}

	// Получаем пользователя
	user, err := s.userRepo.GetUserByID(ctx, rec.UserID)
	if err != nil {
		return nil, ErrUserNotFound
	}

	// Генерируем новые токены
	return s.generateTokens(ctx, user)
}

// GoogleLoginRequest представляет запрос на вход через Google
type GoogleLoginRequest struct {
	IDToken string `json:"id_token"`
}

// GoogleLogin аутентифицирует пользователя через Google OIDC
func (s *AuthService) GoogleLogin(ctx context.Context, req *GoogleLoginRequest) (*AuthResponse, error) {
	if req.IDToken == "" {
		return nil, ErrInvalidRequest
	}

	// Создаем OIDC провайдер
	provider, err := oidc.NewProvider(ctx, "https://accounts.google.com")
	if err != nil {
		return nil, err
	}

	// Верифицируем токен
	verifier := provider.Verifier(&oidc.Config{
		SkipClientIDCheck: true,
	})

	idToken, err := verifier.Verify(ctx, req.IDToken)
	if err != nil {
		return nil, ErrInvalidToken
	}

	// Извлекаем claims
	var claims struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, err
	}

	// Проверяем существование пользователя или создаем нового
	user, err := s.userRepo.GetUserByEmail(ctx, claims.Email)
	if err != nil {
		// Пользователь не существует, создаем нового
		randomBytes := make([]byte, 16)
		_, _ = rand.Read(randomBytes)
		randomPassword := hex.EncodeToString(randomBytes)

		name := claims.Name
		if name == "" {
			name = strings.Split(claims.Email, "@")[0]
		}

		user, err = s.userRepo.CreateUser(ctx, claims.Email, randomPassword, name)
		if err != nil {
			return nil, err
		}
	}

	// Генерируем токены
	return s.generateTokens(ctx, user)
}

// UpdateUserRequest представляет запрос на обновление пользователя
type UpdateUserRequest struct {
	WebSearchEnabled *bool `json:"web_search_enabled"`
}

// UpdateUser обновляет данные пользователя
func (s *AuthService) UpdateUser(ctx context.Context, user *storage.User, req *UpdateUserRequest) (*storage.User, error) {
	if req.WebSearchEnabled != nil {
		user.WebSearchEnabled = *req.WebSearchEnabled
	}

	if err := s.userRepo.UpdateUser(ctx, user); err != nil {
		return nil, err
	}

	return user, nil
}

// generateTokens генерирует access и refresh токены для пользователя
func (s *AuthService) generateTokens(ctx context.Context, user *storage.User) (*AuthResponse, error) {
	// Генерируем access token
	token, err := s.tokenManager.GenerateToken(user)
	if err != nil {
		return nil, err
	}

	// Генерируем refresh token
	refreshToken, err := s.tokenManager.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	// Сохраняем refresh token
	if err := s.storage.SaveRefreshToken(ctx, user.ID, refreshToken, 30*24*time.Hour); err != nil {
		return nil, err
	}

	return &AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
	}, nil
}
