package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/services"
)

type AuthHandler struct {
	service *services.AuthService
}

func NewAuthHandler(service *services.AuthService) *AuthHandler {
	return &AuthHandler{
		service: service,
	}
}

// Use types from services
type RegisterRequest = services.RegisterRequest
type LoginRequest = services.LoginRequest
type AuthResponse = services.AuthResponse

// Register handles user registration
// @Summary Register a new user
// @Description Creates a new user and returns a JWT token
// @Tags auth
// @Accept json
// @Produce json
// @Param request body RegisterRequest true "Registration data"
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

	resp, err := h.service.Register(r.Context(), &req)
	if err != nil {
		if err == services.ErrInvalidRequest {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "Failed to register user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// Login handles user login
// @Summary User login
// @Description Authenticates user and returns a JWT token
// @Tags auth
// @Accept json
// @Produce json
// @Param request body LoginRequest true "Login data"
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

	resp, err := h.service.Login(r.Context(), &req)
	if err != nil {
		if err == services.ErrInvalidCredentials || err == services.ErrInvalidRequest {
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}
		http.Error(w, "Failed to login", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// Refresh accepts a refresh_token and returns a new access+refresh pair (rotation)
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.RefreshToken == "" {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	resp, err := h.service.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		if err == services.ErrInvalidRefreshToken || err == services.ErrUserNotFound {
			http.Error(w, "Invalid or expired refresh token", http.StatusUnauthorized)
			return
		}
		http.Error(w, "Failed to refresh token", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// GetMe returns current user info
// @Summary Current user info
// @Description Returns info about the currently authenticated user
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

// UpdateMe updates current user info
// @Summary Update current user info
// @Description Updates current user settings
// @Tags auth
// @Accept json
// @Produce json
// @Security Bearer
// @Param request body map[string]interface{} true "Fields to update"
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

	var req services.UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	updatedUser, err := h.service.UpdateUser(r.Context(), user, &req)
	if err != nil {
		http.Error(w, "Failed to update user", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updatedUser)
}

// GoogleLoginRequest represents a Google login request
type GoogleLoginRequest = services.GoogleLoginRequest

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

	resp, err := h.service.GoogleLogin(r.Context(), &req)
	if err != nil {
		if err == services.ErrInvalidRequest || err == services.ErrInvalidToken {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		http.Error(w, "Failed to authenticate with Google", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
