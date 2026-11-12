package container

import (
	"encoding/hex"

	"github.com/kliuchnikovv/nomi-api/internal/auth"
	"github.com/kliuchnikovv/nomi-api/internal/config"
	"github.com/kliuchnikovv/nomi-api/internal/credentials"
	"github.com/kliuchnikovv/nomi-api/internal/githubapp"
	"github.com/kliuchnikovv/nomi-api/internal/hub"
	"github.com/kliuchnikovv/nomi-api/internal/services"
	"github.com/kliuchnikovv/nomi-api/internal/storage"
	"github.com/kliuchnikovv/nomi-api/internal/storage/repositories"
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
	ProjectService *services.ProjectService

	// Infrastructure
	Hub          *hub.Hub
	Logger       *zap.Logger
	TokenManager *auth.TokenManager

	// Credentials store (Redis-backed)
	CredentialsStore credentials.Store

	// CryptoKey is the AES-256 key (decoded from cfg.Token.EncryptionKey) used to
	// encrypt/decrypt at-rest secrets such as BYOK API keys.
	CryptoKey []byte

	// GitHub App installation-token minter (nil if not configured)
	GitHubApp *githubapp.Client
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

	projectRepo := repositories.NewProjectRepository(store)
	projectService := services.NewProjectService(projectRepo)

	// Initialize GitHub App minter if configured (optional — feature is off otherwise)
	var githubAppClient *githubapp.Client
	if cfg.GitHub.AppID != 0 && cfg.GitHub.PrivateKey != "" {
		githubAppClient, err = githubapp.NewClient(cfg.GitHub.AppID, cfg.GitHub.PrivateKey)
		if err != nil {
			logger.Warn("GitHub App configured but failed to initialize; disabling", zap.Error(err))
			githubAppClient = nil
		} else {
			logger.Info("GitHub App minter initialized", zap.Int64("app_id", cfg.GitHub.AppID))
		}
	} else {
		logger.Warn("GitHub App not configured (GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY unset); installation tokens unavailable")
	}

	// Initialize Hub
	cryptoKey, _ := hex.DecodeString(cfg.Token.EncryptionKey)
	hubInstance := hub.NewHub(store, logger, cfg.LLM.BaseURL, cryptoKey, githubAppClient)
	go hubInstance.Run()

	// Initialize credentials store with Redis from Hub
	credStore := credentials.NewRedisStore(hubInstance.Redis())

	return &Container{
		Storage:          store,
		GitHubApp:        githubAppClient,
		chatRepo:         chatRepo,
		messageRepo:      messageRepo,
		userRepo:         userRepo,
		ChatService:      chatService,
		MessageService:   messageService,
		AuthService:      authService,
		ProjectService:   projectService,
		Hub:              hubInstance,
		Logger:           logger,
		TokenManager:     tokenManager,
		CredentialsStore: credStore,
		CryptoKey:        cryptoKey,
	}, nil
}
