package handlers

import (
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
)

type Handler struct {
	Store  *storage.Storage
	Logger *zap.Logger
}
