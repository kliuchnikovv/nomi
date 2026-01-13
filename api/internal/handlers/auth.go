package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"context"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

type AuthStorer interface {
	GetUserByEmail(ctx context.Context, email string) (*storage.User, error)
	SaveRefreshToken(ctx context.Context, userID uuid.UUID, token string, ttl time.Duration) error
	CreateUser(ctx context.Context, email, password, name string) (*storage.User, error)
	ConsumeRefreshToken(ctx context.Context, token string) (*storage.RefreshToken, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (*storage.User, error)
	UpdateUser(ctx context.Context, user *storage.User) error
}

type AuthTokenManager interface {
	GenerateToken(user *storage.User) (string, error)
	GenerateRefreshToken() (string, error)
}

type AuthHandler struct {
	storage      AuthStorer
	tokenManager AuthTokenManager
}

func NewAuthHandler(storage AuthStorer, tokenManager AuthTokenManager) *AuthHandler {
	return &AuthHandler{
		storage:      storage,
		tokenManager: tokenManager,
	}
}

type RegisterRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AuthResponse struct {
	Token        string        `json:"token"`
	RefreshToken string        `json:"refresh_token"`
	User         *storage.User `json:"user"`
}

// Register обрабатывает регистрацию нового пользователя
// @Summary Регистрация нового пользователя
// @Description Создает нового пользователя и возвращает JWT токен
// @Tags auth
// @Accept json
// @Produce json
// @Param request body RegisterRequest true "Данные для регистрации"
// @Success 200 {object} AuthResponse
// @Failure 400 {object} string "Invalid request"
// @Failure 500 {object} string "Internal server error"
// @Router /api/auth/register [post]
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Проверяем, что все необходимые поля заполнены
	if req.Email == "" || req.Password == "" {
		http.Error(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	// Создаем нового пользователя
	user, err := h.storage.CreateUser(r.Context(), req.Email, req.Password, req.Name)
	if err != nil {
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}

	// Генерируем JWT токен + refresh
	token, err := h.tokenManager.GenerateToken(user)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}
	rtoken, err := h.tokenManager.GenerateRefreshToken()
	if err != nil {
		http.Error(w, "Failed to generate refresh token", http.StatusInternalServerError)
		return
	}
	if err := h.storage.SaveRefreshToken(r.Context(), user.ID, rtoken, 30*24*time.Hour); err != nil { // 30d
		http.Error(w, "Failed to persist refresh token", http.StatusInternalServerError)
		return
	}

	// Отправляем ответ
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{Token: token, RefreshToken: rtoken, User: user})
}

// Login обрабатывает вход пользователя
// @Summary Вход пользователя
// @Description Аутентифицирует пользователя и возвращает JWT токен
// @Tags auth
// @Accept json
// @Produce json
// @Param request body LoginRequest true "Данные для входа"
// @Success 200 {object} AuthResponse
// @Failure 400 {object} string "Invalid request"
// @Failure 401 {object} string "Invalid credentials"
// @Failure 500 {object} string "Internal server error"
// @Router /api/auth/login [post]
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Проверяем, что все необходимые поля заполнены
	if req.Email == "" || req.Password == "" {
		http.Error(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	// Получаем пользователя по email
	user, err := h.storage.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	// Проверяем пароль
	if !user.VerifyPassword(req.Password) {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	// Генерируем JWT токен + refresh
	token, err := h.tokenManager.GenerateToken(user)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}
	rtoken, err := h.tokenManager.GenerateRefreshToken()
	if err != nil {
		http.Error(w, "Failed to generate refresh token", http.StatusInternalServerError)
		return
	}
	if err := h.storage.SaveRefreshToken(r.Context(), user.ID, rtoken, 30*24*time.Hour); err != nil {
		http.Error(w, "Failed to persist refresh token", http.StatusInternalServerError)
		return
	}

	// Отправляем ответ
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{Token: token, RefreshToken: rtoken, User: user})

}

// Refresh принимает refresh_token и возвращает новую пару access+refresh (ротация)
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RefreshToken == "" {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	rec, err := h.storage.ConsumeRefreshToken(r.Context(), body.RefreshToken)
	if err != nil {
		http.Error(w, "Invalid or expired refresh token", http.StatusUnauthorized)
		return
	}
	user, err := h.storage.GetUserByID(r.Context(), rec.UserID)
	if err != nil {
		http.Error(w, "User not found", http.StatusUnauthorized)
		return
	}
	access, err := h.tokenManager.GenerateToken(user)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}
	newRefresh, err := h.tokenManager.GenerateRefreshToken()
	if err != nil {
		http.Error(w, "Failed to generate refresh token", http.StatusInternalServerError)
		return
	}
	if err := h.storage.SaveRefreshToken(r.Context(), user.ID, newRefresh, 30*24*time.Hour); err != nil {
		http.Error(w, "Failed to persist refresh token", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{Token: access, RefreshToken: newRefresh, User: user})
}

// GetMe возвращает информацию о текущем пользователе
// @Summary Информация о текущем пользователе
// @Description Возвращает информацию о текущем аутентифицированном пользователе
// @Tags auth
// @Accept json
// @Produce json
// @Security Bearer
// @Success 200 {object} storage.User
// @Failure 401 {object} string "Unauthorized"
// @Router /api/auth/me [get]
func (h *AuthHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

// UpdateMe обновляет информацию о текущем пользователе
// @Summary Обновление информации о текущем пользователе
// @Description Обновляет настройки текущего пользователя
// @Tags auth
// @Accept json
// @Produce json
// @Security Bearer
// @Param request body map[string]interface{} true "Поля для обновления"
// @Success 200 {object} storage.User
// @Failure 400 {object} string "Invalid request"
// @Failure 401 {object} string "Unauthorized"
// @Failure 500 {object} string "Internal server error"
// @Router /api/auth/me [put]
func (h *AuthHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.GetUserFromContext(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		WebSearchEnabled *bool `json:"web_search_enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	updated := false
	if body.WebSearchEnabled != nil {
		user.WebSearchEnabled = *body.WebSearchEnabled
		updated = true
	}

	if updated {
		if err := h.storage.UpdateUser(r.Context(), user); err != nil {
			http.Error(w, "Failed to update user", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(user)
}

type GoogleLoginRequest struct {
	IDToken string `json:"id_token"`
}

// GoogleLogin handles Google Sign-In
// @Summary Google Sign-In
// @Description Authenticates user via Google ID Token
// @Tags auth
// @Accept json
// @Produce json
// @Param request body GoogleLoginRequest true "Google ID Token"
// @Success 200 {object} AuthResponse
// @Failure 400 {object} string "Invalid request"
// @Failure 401 {object} string "Invalid token"
// @Failure 500 {object} string "Internal server error"
// @Router /api/auth/google [post]
func (h *AuthHandler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	var req GoogleLoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.IDToken == "" {
		http.Error(w, "id_token is required", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	provider, err := oidc.NewProvider(ctx, "https://accounts.google.com")
	if err != nil {
		http.Error(w, "Failed to get OIDC provider", http.StatusInternalServerError)
		return
	}

	verifier := provider.Verifier(&oidc.Config{
		SkipClientIDCheck: true, // Client ID is checked on client side
	})

	idToken, err := verifier.Verify(ctx, req.IDToken)
	if err != nil {
		http.Error(w, "Invalid token: "+err.Error(), http.StatusUnauthorized)
		return
	}

	var claims struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		http.Error(w, "Failed to parse claims", http.StatusInternalServerError)
		return
	}

	// Check if user exists
	user, err := h.storage.GetUserByEmail(ctx, claims.Email)
	if err != nil {
		// User does not exist, create new one
		// Generate random password
		randomBytes := make([]byte, 16)
		_, _ = rand.Read(randomBytes)
		randomPassword := hex.EncodeToString(randomBytes)

		name := claims.Name
		if name == "" {
			name = strings.Split(claims.Email, "@")[0]
		}

		user, err = h.storage.CreateUser(ctx, claims.Email, randomPassword, name)
		if err != nil {
			http.Error(w, "Failed to create user", http.StatusInternalServerError)
			return
		}
	}

	// Generate tokens
	token, err := h.tokenManager.GenerateToken(user)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		return
	}
	rtoken, err := h.tokenManager.GenerateRefreshToken()
	if err != nil {
		http.Error(w, "Failed to generate refresh token", http.StatusInternalServerError)
		return
	}
	if err := h.storage.SaveRefreshToken(ctx, user.ID, rtoken, 30*24*time.Hour); err != nil {
		http.Error(w, "Failed to persist refresh token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(AuthResponse{Token: token, RefreshToken: rtoken, User: user})
}
