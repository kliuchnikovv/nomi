package services

// ServiceError представляет ошибку сервиса
type ServiceError struct {
	Message string
	Code    string
}

func (e *ServiceError) Error() string {
	return e.Message
}

// Общие ошибки сервисов
var (
	ErrInvalidRequest      = &ServiceError{Message: "Invalid request", Code: "INVALID_REQUEST"}
	ErrInvalidCredentials  = &ServiceError{Message: "Invalid credentials", Code: "INVALID_CREDENTIALS"}
	ErrInvalidRefreshToken = &ServiceError{Message: "Invalid or expired refresh token", Code: "INVALID_REFRESH_TOKEN"}
	ErrInvalidToken        = &ServiceError{Message: "Invalid token", Code: "INVALID_TOKEN"}
	ErrUserNotFound        = &ServiceError{Message: "User not found", Code: "USER_NOT_FOUND"}
)
