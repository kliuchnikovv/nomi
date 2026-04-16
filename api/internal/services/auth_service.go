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

// RegisterRequest represents a registration request
type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

// LoginRequest represents a login request
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// AuthResponse represents a token response
type AuthResponse struct {
	Token        string        `json:"token"`
	RefreshToken string        `json:"refresh_token"`
	User         *storage.User `json:"user"`
}

// Register registers a new user
func (s *AuthService) Register(ctx context.Context, req *RegisterRequest) (*AuthResponse, error) {
	// Validation
	if req.Email == "" || req.Password == "" {
		return nil, ErrInvalidRequest
	}

	// Create user
	user, err := s.userRepo.CreateUser(ctx, req.Email, req.Password, req.Name)
	if err != nil {
		return nil, err
	}

	// Generate tokens
	return s.generateTokens(ctx, user)
}

// Login authenticates a user
func (s *AuthService) Login(ctx context.Context, req *LoginRequest) (*AuthResponse, error) {
	// Validation
	if req.Email == "" || req.Password == "" {
		return nil, ErrInvalidCredentials
	}

	// Get user
	user, err := s.userRepo.GetUserByEmail(ctx, req.Email)
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	// Verify password
	if !user.VerifyPassword(req.Password) {
		return nil, ErrInvalidCredentials
	}

	// Generate tokens
	return s.generateTokens(ctx, user)
}

// Refresh refreshes tokens using a refresh token
func (s *AuthService) Refresh(ctx context.Context, refreshToken string) (*AuthResponse, error) {
	if refreshToken == "" {
		return nil, ErrInvalidRefreshToken
	}

	// Consume refresh token
	rec, err := s.storage.ConsumeRefreshToken(ctx, refreshToken)
	if err != nil {
		return nil, ErrInvalidRefreshToken
	}

	// Get user
	user, err := s.userRepo.GetUserByID(ctx, rec.UserID)
	if err != nil {
		return nil, ErrUserNotFound
	}

	// Generate new tokens
	return s.generateTokens(ctx, user)
}

// GoogleLoginRequest represents a Google login request
type GoogleLoginRequest struct {
	IDToken string `json:"id_token"`
}

// GoogleLogin authenticates a user via Google OIDC
func (s *AuthService) GoogleLogin(ctx context.Context, req *GoogleLoginRequest) (*AuthResponse, error) {
	if req.IDToken == "" {
		return nil, ErrInvalidRequest
	}

	// Create OIDC provider
	provider, err := oidc.NewProvider(ctx, "https://accounts.google.com")
	if err != nil {
		return nil, err
	}

	// Verify token
	verifier := provider.Verifier(&oidc.Config{
		SkipClientIDCheck: true,
	})

	idToken, err := verifier.Verify(ctx, req.IDToken)
	if err != nil {
		return nil, ErrInvalidToken
	}

	// Extract claims
	var claims struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, err
	}

	// Check if user exists or create a new one
	user, err := s.userRepo.GetUserByEmail(ctx, claims.Email)
	if err != nil {
		// User does not exist, create a new one
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

	// Generate tokens
	return s.generateTokens(ctx, user)
}

// UpdateUserRequest represents a user update request
type UpdateUserRequest struct {
	WebSearchEnabled *bool `json:"web_search_enabled"`
}

// UpdateUser updates user data
func (s *AuthService) UpdateUser(ctx context.Context, user *storage.User, req *UpdateUserRequest) (*storage.User, error) {
	if req.WebSearchEnabled != nil {
		user.WebSearchEnabled = *req.WebSearchEnabled
	}

	if err := s.userRepo.UpdateUser(ctx, user); err != nil {
		return nil, err
	}

	return user, nil
}

// generateTokens generates access and refresh tokens for a user
func (s *AuthService) generateTokens(ctx context.Context, user *storage.User) (*AuthResponse, error) {
	// Generate access token
	token, err := s.tokenManager.GenerateToken(user)
	if err != nil {
		return nil, err
	}

	// Generate refresh token
	refreshToken, err := s.tokenManager.GenerateRefreshToken()
	if err != nil {
		return nil, err
	}

	// Save refresh token
	if err := s.storage.SaveRefreshToken(ctx, user.ID, refreshToken, 30*24*time.Hour); err != nil {
		return nil, err
	}

	return &AuthResponse{
		Token:        token,
		RefreshToken: refreshToken,
		User:         user,
	}, nil
}
