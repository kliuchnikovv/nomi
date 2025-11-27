package plugins

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/notifier"
	"github.com/kliuchnikovv/genie-api/internal/storage"
	"go.uber.org/zap"
	"golang.org/x/oauth2"
)

// Interfaces to decouple plugins from core implementations.
type StoragePort interface {
	GetIntegrations(ctx context.Context, userID uuid.UUID) ([]storage.Integration, error)
	GetIntegrationsByProvider(ctx context.Context, provider string) ([]storage.Integration, error)
	GetOAuthTokenByUser(ctx context.Context, userID uuid.UUID, provider string) (*storage.OAuthToken, error)
	UpdateOAuthToken(ctx context.Context, token *storage.OAuthToken) error
	InboxExistsByMessageID(ctx context.Context, userID uuid.UUID, messageID string) (bool, error)
	CreateInbox(ctx context.Context, inbox *storage.Inbox) error
	UpdateInbox(ctx context.Context, inbox *storage.Inbox) error
	FindPluginChatByExternalID(ctx context.Context, userID uuid.UUID, provider string, externalID string) (*storage.PluginChat, error)
	CreatePluginChat(ctx context.Context, chat *storage.PluginChat) (*storage.PluginChat, error)
	FindChatByTitleAndModel(ctx context.Context, userID uuid.UUID, title string, modelID uuid.UUID) (*storage.Chat, error)
	CreateChat(ctx context.Context, userID uuid.UUID, c *chat.Chat) (*chat.Chat, error)
}

type LLMPort interface {
	GenerateSimple(ctx context.Context, userID uuid.UUID, prompt string, agent string) (string, error)
}

type NotifierPort interface {
	Publish(chatID uuid.UUID, ev notifier.Event)
}

// Runtime exposes helpers that plugins can rely on to interact with the
// application runtime: run routines, call models/agents and push events.
type Runtime struct {
	notifier   NotifierPort
	Storage    StoragePort
	Logger     *zap.Logger
	LLMService LLMPort

	RoutineRunner func(ctx context.Context, plugin, routine string, payload interface{}) error
	ModelCaller   func(ctx context.Context, model string, payload interface{}) (interface{}, error)
	AgentCaller   func(ctx context.Context, agent string, payload interface{}) (interface{}, error)
	OAuthConfigs  map[string]*oauth2.Config
}

func NewRuntime(n NotifierPort, s StoragePort, l *zap.Logger, llm LLMPort, oauthConfigs map[string]*oauth2.Config) *Runtime {
	return &Runtime{
		notifier:     n,
		Storage:      s,
		Logger:       l,
		LLMService:   llm,
		OAuthConfigs: oauthConfigs,
	}
}

func (r *Runtime) RunRoutine(ctx context.Context, plugin, routine string, payload interface{}) error {
	if r.RoutineRunner == nil {
		return errors.New("routine runner is not configured")
	}
	return r.RoutineRunner(ctx, plugin, routine, payload)
}

func (r *Runtime) CallModel(ctx context.Context, model string, payload interface{}) (interface{}, error) {
	if r.ModelCaller == nil {
		return nil, errors.New("model caller is not configured")
	}
	return r.ModelCaller(ctx, model, payload)
}

func (r *Runtime) CallAgent(ctx context.Context, agent string, payload interface{}) (interface{}, error) {
	if r.AgentCaller == nil {
		return nil, errors.New("agent caller is not configured")
	}
	return r.AgentCaller(ctx, agent, payload)
}

func (r *Runtime) SendEvent(chatID uuid.UUID, payload interface{}) {
	if r.notifier == nil {
		return
	}
	r.notifier.Publish(chatID, notifier.Event{Type: "plugin_event", Payload: payload})
}

type Info struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Version     string `json:"version"`
}

// PluginState represents the persisted state of the plugin along with
// its enabled flag.
type PluginState struct {
	Enabled bool                   `json:"enabled"`
	State   map[string]interface{} `json:"state"`
}

// Plugin is the interface that all plugins must implement.
type Plugin interface {
	Info() Info
	DefaultState() map[string]interface{}
	Init(ctx context.Context, rt *Runtime, state map[string]interface{}) error
	RegisterRoutes(router *gin.RouterGroup)
	Shutdown(ctx context.Context) error
}

// Actionable interface for plugins that can execute actions on messages
type Actionable interface {
	ExecuteAction(ctx context.Context, userID uuid.UUID, action storage.InboxAction, message storage.Inbox) error
}

type registeredPlugin struct {
	plugin  Plugin
	state   map[string]interface{}
	rt      *Runtime
	enabled bool
}

// Manager keeps track of registered plugins, their state and lifecycle.
type Manager struct {
	mu      sync.RWMutex
	runtime *Runtime
	plugins map[string]*registeredPlugin
	initial map[string]PluginState
}

func NewManager(rt *Runtime, initial map[string]PluginState) *Manager {
	if initial == nil {
		initial = map[string]PluginState{}
	}
	return &Manager{
		runtime: rt,
		plugins: map[string]*registeredPlugin{},
		initial: initial,
	}
}

// Register registers a plugin and loads its initial state.
func (m *Manager) Register(p Plugin) error {
	info := p.Info()
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.plugins[info.Name]; exists {
		return errors.New("plugin already registered")
	}

	state := p.DefaultState()
	cfg, ok := m.initial[info.Name]
	if ok {
		if cfg.State != nil {
			for k, v := range cfg.State {
				state[k] = v
			}
		}
	}

	rp := &registeredPlugin{plugin: p, state: state, rt: m.runtime, enabled: cfg.Enabled}
	if rp.enabled {
		if err := p.Init(context.Background(), m.runtime, state); err != nil {
			return err
		}
	}

	m.plugins[info.Name] = rp
	return nil
}

// ExecuteAction delegates the action execution to the appropriate plugin based on source
func (m *Manager) ExecuteAction(ctx context.Context, userID uuid.UUID, source string, action storage.InboxAction, message storage.Inbox) error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Find plugin by source (assuming source matches plugin name)
	plugin, exists := m.plugins[source]
	if !exists {
		return fmt.Errorf("plugin not found for source: %s", source)
	}

	// Check if plugin is enabled
	if !plugin.enabled {
		return fmt.Errorf("plugin %s is disabled", source)
	}

	// Check if plugin implements Actionable
	actionable, ok := plugin.plugin.(Actionable)
	if !ok {
		return fmt.Errorf("plugin %s does not support actions", source)
	}

	return actionable.ExecuteAction(ctx, userID, action, message)
}

func (m *Manager) List() []PluginStateInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]PluginStateInfo, 0, len(m.plugins))
	for name, rp := range m.plugins {
		res = append(res, PluginStateInfo{Name: name, Info: rp.plugin.Info(), State: rp.state, Enabled: rp.enabled})
	}
	return res
}

func (m *Manager) Enable(ctx context.Context, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	rp, ok := m.plugins[name]
	if !ok {
		return errors.New("plugin not found")
	}
	if rp.enabled {
		return nil
	}
	if err := rp.plugin.Init(ctx, m.runtime, rp.state); err != nil {
		return err
	}
	rp.enabled = true
	return nil
}

func (m *Manager) Disable(ctx context.Context, name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	rp, ok := m.plugins[name]
	if !ok {
		return errors.New("plugin not found")
	}
	if !rp.enabled {
		return nil
	}
	if err := rp.plugin.Shutdown(ctx); err != nil {
		return err
	}
	rp.enabled = false
	return nil
}

func (m *Manager) GetState(name string) (map[string]interface{}, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	rp, ok := m.plugins[name]
	if !ok {
		return nil, false
	}
	return rp.state, rp.enabled
}

func (m *Manager) UpdateState(name string, state map[string]interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	rp, ok := m.plugins[name]
	if !ok {
		return errors.New("plugin not found")
	}
	rp.state = state
	return nil
}

// Mount registers management and plugin routes under the provided group.
func (m *Manager) Mount(group *gin.RouterGroup) {
	group.GET("", m.listHandler)
	group.POST(":name/enable", m.enableHandler)
	group.POST(":name/disable", m.disableHandler)
	group.GET(":name/state", m.getStateHandler)
	group.PUT(":name/state", m.updateStateHandler)

	for name, rp := range m.plugins {
		pluginGroup := group.Group(name)
		pluginGroup.Use(m.requireEnabled(name))
		rp.plugin.RegisterRoutes(pluginGroup)
	}
}

func (m *Manager) requireEnabled(name string) gin.HandlerFunc {
	return func(c *gin.Context) {
		m.mu.RLock()
		rp, ok := m.plugins[name]
		enabled := ok && rp.enabled
		m.mu.RUnlock()
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "plugin not found"})
			c.Abort()
			return
		}
		if !enabled {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "plugin disabled"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func (m *Manager) listHandler(c *gin.Context) {
	c.JSON(http.StatusOK, m.List())
}

func (m *Manager) enableHandler(c *gin.Context) {
	name := c.Param("name")
	if err := m.Enable(c.Request.Context(), name); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (m *Manager) disableHandler(c *gin.Context) {
	name := c.Param("name")
	if err := m.Disable(c.Request.Context(), name); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (m *Manager) getStateHandler(c *gin.Context) {
	name := c.Param("name")
	state, enabled := m.GetState(name)
	if state == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "plugin not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"enabled": enabled, "state": state})
}

func (m *Manager) updateStateHandler(c *gin.Context) {
	name := c.Param("name")
	var payload map[string]interface{}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid state"})
		return
	}
	if err := m.UpdateState(name, payload); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// Shutdown gracefully stops all plugins that are currently enabled.
func (m *Manager) Shutdown(ctx context.Context) error {
	m.mu.RLock()
	plugins := make([]*registeredPlugin, 0, len(m.plugins))
	for _, p := range m.plugins {
		plugins = append(plugins, p)
	}
	m.mu.RUnlock()

	for _, p := range plugins {
		if p.enabled {
			if err := p.plugin.Shutdown(ctx); err != nil {
				return err
			}
		}
	}
	return nil
}

type PluginStateInfo struct {
	Name    string                 `json:"name"`
	Info    Info                   `json:"info"`
	State   map[string]interface{} `json:"state"`
	Enabled bool                   `json:"enabled"`
}
