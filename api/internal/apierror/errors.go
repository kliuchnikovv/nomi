package apierror

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
)

// APIError represents a structured error response
type APIError struct {
	Code    int         `json:"-"`       // HTTP status code
	Message string      `json:"error"`   // Error message
	Details interface{} `json:"details"` // Optional details
}

// Error implements the error interface
func (e *APIError) Error() string {
	return fmt.Sprintf("code=%d, message=%s", e.Code, e.Message)
}

// New creates a new APIError
func New(code int, message string, details interface{}) *APIError {
	return &APIError{
		Code:    code,
		Message: message,
		Details: details,
	}
}

// Common error helpers

func NewBadRequest(message string, details interface{}) *APIError {
	return New(http.StatusBadRequest, message, details)
}

func NewUnauthorized(message string) *APIError {
	return New(http.StatusUnauthorized, message, nil)
}

func NewForbidden(message string) *APIError {
	return New(http.StatusForbidden, message, nil)
}

func NewNotFound(message string) *APIError {
	return New(http.StatusNotFound, message, nil)
}

func NewInternalServerError(message string) *APIError {
	return New(http.StatusInternalServerError, message, nil)
}

func NewValidationFailed(message string, details interface{}) *APIError {
	return New(http.StatusBadRequest, message, details)
}

// Respond sends the error response to the client
func Respond(c *gin.Context, err error) {
	if apiErr, ok := err.(*APIError); ok {
		c.JSON(apiErr.Code, apiErr)
		return
	}

	// Default to internal server error for unknown errors
	c.JSON(http.StatusInternalServerError, gin.H{
		"error": err.Error(),
	})
}
