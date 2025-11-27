package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// SidebarHandler exposes sidebar-specific aggregations grouped by plugin/integration.
type SidebarHandler struct {
	storage *storage.Storage
}

func NewSidebarHandler(storage *storage.Storage) *SidebarHandler {
	return &SidebarHandler{storage: storage}
}

type SidebarMessage struct {
	ID       uuid.UUID `json:"id"`
	ThreadID uint64    `json:"thread_id"`
	Title    string    `json:"title"`
	Preview  string    `json:"preview,omitempty"`
}

type SidebarIntegration struct {
	IntegrationID uuid.UUID        `json:"integration_id,omitempty"`
	Name          string           `json:"name"`
	Provider      string           `json:"provider"`
	Entries       []SidebarMessage `json:"entries"`
}

type SidebarResponse struct {
	Items []SidebarIntegration `json:"items"`
}

type SidebarChat struct {
	ChatID       string    `json:"chat_id"`
	Title        string    `json:"title"`
	LastReceived time.Time `json:"last_received"`
	Count        int       `json:"count"`
}

type SidebarChatMessage struct {
	ID         uuid.UUID `json:"id"`
	ThreadID   uint64    `json:"thread_id"`
	Title      string    `json:"title"`
	Summary    string    `json:"summary,omitempty"`
	Content    string    `json:"content,omitempty"`
	Status     string    `json:"status"`
	ReceivedAt time.Time `json:"received_at"`
}

// ListSidebar aggregates all inbox messages grouped by integration for sidebar consumption.
func (h *SidebarHandler) ListSidebar(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	integrations, err := h.storage.GetIntegrations(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load integrations"})
		return
	}

	var inboxes []storage.Inbox
	if err := h.storage.DB.WithContext(ctx).
		Where("user_id = ?", user.ID).
		Order("received_at DESC").
		Find(&inboxes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load messages"})
		return
	}

	// Group messages by provider (plugin)
	byProvider := make(map[string][]SidebarMessage)
	for _, msg := range inboxes {
		byProvider[msg.Source] = append(byProvider[msg.Source], SidebarMessage{
			ID:       msg.ID,
			ThreadID: msg.ThreadID,
			Title:    msg.Header,
			Preview:  msg.Summary,
		})
	}

	items := make([]SidebarIntegration, 0, len(integrations))
	for _, integ := range integrations {
		items = append(items, SidebarIntegration{
			IntegrationID: integ.ID,
			Name:          integ.Name,
			Provider:      integ.Provider,
			Entries:       byProvider[integ.Provider],
		})
	}

	c.JSON(http.StatusOK, SidebarResponse{Items: items})
}

// ListChats returns chats (threads) for a given provider.
func (h *SidebarHandler) ListChats(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	provider := c.Param("provider")
	if provider == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider is required"})
		return
	}

	var rows []storage.Inbox
	if err := h.storage.DB.WithContext(ctx).
		Where("user_id = ? AND source = ?", user.ID, provider).
		Order("received_at DESC").
		Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load messages"})
		return
	}

	chats := make(map[string]SidebarChat)
	for _, msg := range rows {
		key := chatKey(msg)
		if key == "" {
			continue
		}
		if existing, ok := chats[key]; ok {
			if msg.ReceivedAt.After(existing.LastReceived) {
				existing.LastReceived = msg.ReceivedAt
				existing.Title = msg.Header
			}
			existing.Count++
			chats[key] = existing
		} else {
			chats[key] = SidebarChat{
				ChatID:       key,
				Title:        msg.Header,
				LastReceived: msg.ReceivedAt,
				Count:        1,
			}
		}
	}

	resp := make([]SidebarChat, 0, len(chats))
	for _, v := range chats {
		resp = append(resp, v)
	}

	c.JSON(http.StatusOK, gin.H{"provider": provider, "chats": resp})
}

// GetChat returns messages for a chat/thread of the given provider.
func (h *SidebarHandler) GetChat(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	provider := c.Param("provider")
	chatID := c.Param("chat_id")
	if provider == "" || chatID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider and chat_id are required"})
		return
	}

	var rows []storage.Inbox
	query := h.storage.DB.WithContext(ctx).Where("user_id = ? AND source = ?", user.ID, provider)

	if tid, err := parseThreadID(chatID); err == nil {
		query = query.Where("thread_id = ?", tid)
	} else if msgID, err := uuid.Parse(chatID); err == nil {
		query = query.Where("id = ?", msgID)
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat_id must be thread_id or message uuid"})
		return
	}

	if err := query.Order("received_at ASC").Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load chat messages"})
		return
	}

	result := make([]SidebarChatMessage, len(rows))
	for i, msg := range rows {
		result[i] = SidebarChatMessage{
			ID:         msg.ID,
			ThreadID:   msg.ThreadID,
			Title:      msg.Header,
			Summary:    msg.Summary,
			Content:    msg.Content,
			Status:     msg.Status,
			ReceivedAt: msg.ReceivedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"provider": provider,
		"chat_id":  chatID,
		"messages": result,
	})
}

// PostChatMessage is a placeholder to send a message into a plugin chat.
func (h *SidebarHandler) PostChatMessage(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "sending messages to plugins is not implemented yet"})
}

func chatKey(msg storage.Inbox) string {
	if msg.ThreadID != 0 {
		return fmt.Sprintf("%d", msg.ThreadID)
	}
	if msg.ID != uuid.Nil {
		return msg.ID.String()
	}
	return ""
}

func parseThreadID(s string) (uint64, error) {
	var tid uint64
	_, err := fmt.Sscanf(s, "%d", &tid)
	return tid, err
}
