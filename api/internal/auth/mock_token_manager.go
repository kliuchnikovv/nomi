package auth

import "github.com/kliuchnikovv/genie-api/internal/storage"

type MockTokenManager struct {
	*TokenManager
	GenerateTokenFunc        func(user *storage.User) (string, error)
	GenerateRefreshTokenFunc func() (string, error)
}

func (m *MockTokenManager) GenerateToken(user *storage.User) (string, error) {
	return m.GenerateTokenFunc(user)
}

func (m *MockTokenManager) GenerateRefreshToken() (string, error) {
	return m.GenerateRefreshTokenFunc()
}
