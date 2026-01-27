package container

import (
	"github.com/kliuchnikovv/genie-api/internal/auth"
	"github.com/kliuchnikovv/genie-api/internal/config"
	"github.com/kliuchnikovv/genie-api/internal/domain"
	"github.com/kliuchnikovv/genie-api/internal/hub"
	"github.com/kliuchnikovv/genie-api/internal/services"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"github.com/kliuchnikovv/genie-api/internal/storage/repositories"
	"go.uber.org/zap"
)

// Container содержит все зависимости приложения
type Container struct {
	// Storage
	Storage *storage.Storage

	// Repositories
	ChatRepo    domain.ChatRepository
	MessageRepo domain.MessageRepository
	UserRepo    domain.UserRepository

	// Services
	ChatService    *services.ChatService
	MessageService *services.MessageService
	AuthService    *services.AuthService

	// Infrastructure
	Hub         *hub.Hub
	Logger      *zap.Logger
	TokenManager *auth.TokenManager
}

// NewContainer создает новый контейнер с инициализированными зависимостями
func NewContainer(cfg *config.Config, logger *zap.Logger) (*Container, error) {
	// Инициализация storage
	store, err := storage.New(cfg)
	if err != nil {
		return nil, err
	}

	// Инициализация репозиториев
	chatRepo := repositories.NewChatRepository(store)
	messageRepo := repositories.NewMessageRepository(store)
	userRepo := repositories.NewUserRepository(store)

	// Инициализация token manager
	tokenManager := auth.NewTokenManager(cfg.Token.JWTSecret)

	// Инициализация сервисов
	chatService := services.NewChatService(chatRepo)
	messageService := services.NewMessageService(messageRepo)
	authService := services.NewAuthService(userRepo, tokenManager, store)

	// Инициализация Hub
	hubInstance := hub.NewHub(store, logger, cfg.LLM.BaseURL)
	go hubInstance.Run()

	return &Container{
		Storage:        store,
		ChatRepo:       chatRepo,
		MessageRepo:    messageRepo,
		UserRepo:       userRepo,
		ChatService:    chatService,
		MessageService: messageService,
		AuthService:    authService,
		Hub:            hubInstance,
		Logger:         logger,
		TokenManager:   tokenManager,
	}, nil
}
