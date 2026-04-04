package container

import (
	"encoding/hex"

	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/credentials"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/services"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/kliuchnikovv/genie-api/internal/storage/repositories"
	"go.uber.org/zap"
)

// Container contains all application dependencies
type Container struct {
	// Storage
	Storage *storage.Storage

	// Repositories (implemented as concrete types, not interfaces)
	chatRepo    repositories.ChatRepository
	messageRepo repositories.MessageRepository
	userRepo    repositories.UserRepository

	// Services
	ChatService    *services.ChatService
	MessageService *services.MessageService
	AuthService    *services.AuthService

	// Infrastructure
	Hub          *hub.Hub
	Logger       *zap.Logger
	TokenManager *auth.TokenManager

	// Credentials store (Redis-backed)
	CredentialsStore credentials.Store
}

// NewContainer creates a new container with initialized dependencies
func NewContainer(cfg *config.Config, logger *zap.Logger) (*Container, error) {
	// Initialize storage
	store, err := storage.New(cfg)
	if err != nil {
		return nil, err
	}

	// Initialize repositories
	chatRepo := repositories.NewChatRepository(store)
	messageRepo := repositories.NewMessageRepository(store)
	userRepo := repositories.NewUserRepository(store)

	// Initialize token manager
	tokenManager := auth.NewTokenManager(cfg.Token.JWTSecret)

	// Initialize services
	chatService := services.NewChatService(chatRepo)
	messageService := services.NewMessageService(messageRepo)
	authService := services.NewAuthService(userRepo, tokenManager, store)

	// Initialize Hub
	cryptoKey, _ := hex.DecodeString(cfg.Token.EncryptionKey)
	hubInstance := hub.NewHub(store, logger, cfg.LLM.BaseURL, cryptoKey)
	go hubInstance.Run()

	// Initialize credentials store with Redis from Hub
	credStore := credentials.NewRedisStore(hubInstance.Redis())

	return &Container{
		Storage:          store,
		chatRepo:         chatRepo,
		messageRepo:      messageRepo,
		userRepo:         userRepo,
		ChatService:      chatService,
		MessageService:   messageService,
		AuthService:      authService,
		Hub:              hubInstance,
		Logger:           logger,
		TokenManager:     tokenManager,
		CredentialsStore: credStore,
	}, nil
}
