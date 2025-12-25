package handlers

import (
	"fmt"
	"net/http"
	"time"

	"encoding/json"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/llm"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// SidebarHandler exposes sidebar-specific aggregations grouped by plugin/integration.
type SidebarHandler struct {
	storage *storage.Storage
	llm     *llm.Service
}

func NewSidebarHandler(storage *storage.Storage, llmService *llm.Service) *SidebarHandler {
	return &SidebarHandler{storage: storage, llm: llmService}
}

type SidebarMessage struct {
	ID       uuid.UUID `json:"id"`
	ThreadID uint64    `json:"thread_id"`
	Title    string    `json:"title"`
	Preview  string    `json:"preview,omitempty"`
	Sender   string    `json:"sender,omitempty"`
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
	ID         uuid.UUID             `json:"id"`
	ThreadID   uint64                `json:"thread_id"`
	Title      string                `json:"title"`
	Role       string                `json:"role"`
	Summary    string                `json:"summary,omitempty"`
	Content    string                `json:"content,omitempty"`
	Actions    []storage.InboxAction `json:"actions,omitempty"`
	Status     string                `json:"status"`
	ReceivedAt time.Time             `json:"received_at"`
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

	// Group messages by integration (account)
	byIntegration := make(map[uuid.UUID][]SidebarMessage)
	for _, msg := range inboxes {
		byIntegration[msg.IntegrationID] = append(byIntegration[msg.IntegrationID], SidebarMessage{
			ID:       msg.ID,
			ThreadID: msg.ThreadID,
			Title:    msg.Header,
			Preview:  msg.Summary,
			Sender:   msg.Sender,
		})
	}

	items := make([]SidebarIntegration, 0, len(integrations))
	for _, integ := range integrations {
		items = append(items, SidebarIntegration{
			IntegrationID: integ.ID,
			Name:          integ.Name,
			Provider:      integ.Provider,
			Entries:       byIntegration[integ.ID],
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

	var integrationFilter *uuid.UUID
	if integIDStr := c.Query("integration_id"); integIDStr != "" {
		if integID, err := uuid.Parse(integIDStr); err == nil {
			integrationFilter = &integID
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration_id"})
			return
		}
	}

	chats, err := h.storage.ListPluginChatsWithStats(ctx, user.ID, provider, integrationFilter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load chats"})
		return
	}

	// DEBUG: Log what we got from storage
	fmt.Printf("[DEBUG ListChats] provider=%s, integration_id=%v, user_id=%s, chats_count=%d\n", 
		provider, integrationFilter, user.ID.String(), len(chats))
	for i, chat := range chats {
		fmt.Printf("[DEBUG ListChats] chat[%d]: id=%s, title=%s, count=%d\n", 
			i, chat.ID.String(), chat.Title, chat.Count)
	}

	resp := make([]SidebarChat, 0, len(chats))
	for _, chat := range chats {
		var last time.Time
		if chat.LastReceived != nil {
			last = *chat.LastReceived
		}
		resp = append(resp, SidebarChat{
			ChatID:       chat.ID.String(),
			Title:        firstNonEmpty(chat.LastTitle, chat.Title),
			LastReceived: last,
			Count:        int(chat.Count),
		})
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

	chatUUID, err := uuid.Parse(chatID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat_id must be UUID"})
		return
	}

	chatModel, err := h.storage.GetPluginChat(ctx, user.ID, chatUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if chatModel.Provider != provider {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider mismatch"})
		return
	}

	var rows []storage.Inbox
	if err := h.storage.DB.WithContext(ctx).
		Where("user_id = ? AND source = ? AND metadata->>'chat_id' = ?", user.ID, provider, chatUUID.String()).
		Order("received_at ASC").
		Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load chat messages"})
		return
	}

	result := make([]SidebarChatMessage, len(rows))
	for i, msg := range rows {
		var actions []storage.InboxAction
		if len(msg.Actions) > 0 {
			_ = json.Unmarshal(msg.Actions, &actions)
		}
		result[i] = SidebarChatMessage{
			ID:         msg.ID,
			ThreadID:   msg.ThreadID,
			Title:      msg.Header,
			Role:       msg.Role,
			Summary:    msg.Summary,
			Content:    msg.Content,
			Actions:    actions,
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

	chatUUID, err := uuid.Parse(chatID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "chat_id must be UUID"})
		return
	}

	pluginChat, err := h.storage.GetPluginChat(ctx, user.ID, chatUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "chat not found"})
		return
	}
	if pluginChat.Provider != provider {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider mismatch"})
		return
	}

	var req struct {
		Content string `json:"content"`
		Title   string `json:"title"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content is required"})
		return
	}

	threadID := parseThreadFromExternal(pluginChat.ExternalID)
	now := time.Now().UTC()
	msgID := uuid.NewString()

	metadata := map[string]interface{}{
		"chat_id":     pluginChat.ID.String(),
		"external_id": pluginChat.ExternalID,
		"thread_id":   threadID,
	}
	metadataBytes, _ := json.Marshal(metadata)

	inboxItem := &storage.Inbox{
		ID:            uuid.New(),
		UserID:        user.ID,
		IntegrationID: pluginChat.IntegrationID,
		Source:        provider,
		MessageID:     msgID,
		ThreadID:      threadID,
		Sender:        user.Email,
		Role:          "user",
		Header:        firstNonEmpty(req.Title, pluginChat.Title),
		Content:       req.Content,
		Status:        "sent",
		Metadata:      metadataBytes,
		ReceivedAt:    now,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := h.storage.DB.WithContext(ctx).Create(inboxItem).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save message"})
		return
	}

	responsePayload := SidebarChatMessage{
		ID:         inboxItem.ID,
		ThreadID:   inboxItem.ThreadID,
		Title:      inboxItem.Header,
		Role:       inboxItem.Role,
		Summary:    inboxItem.Summary,
		Content:    inboxItem.Content,
		Actions:    []storage.InboxAction{},
		Status:     inboxItem.Status,
		ReceivedAt: inboxItem.ReceivedAt,
	}

	// Generate assistant reply using LLM (best-effort).
	var replyPayload *SidebarChatMessage
	if h.llm != nil {
		reply, err := h.llm.GenerateSimple(ctx, user.ID, req.Content, "plugin_chat")
		if err == nil && reply != "" {
			replyMetadata := map[string]interface{}{
				"chat_id":       pluginChat.ID.String(),
				"external_id":   pluginChat.ExternalID,
				"reply_to_id":   msgID,
				"provider_msg":  pluginChat.ExternalID,
				"provider_chat": pluginChat.ExternalID,
				"thread_id":     threadID,
			}
			replyMetaBytes, _ := json.Marshal(replyMetadata)

			replyInbox := &storage.Inbox{
				ID:            uuid.New(),
				UserID:        user.ID,
				IntegrationID: pluginChat.IntegrationID,
				Source:        provider,
				MessageID:     "assistant-" + uuid.NewString(),
				ThreadID:      threadID,
				Sender:        provider,
				Role:          "assistant", // model reply triggered by user
				Header:        firstNonEmpty(req.Title, pluginChat.Title),
				Content:       reply,
				Status:        "processed",
				Metadata:      replyMetaBytes,
				ReceivedAt:    now,
				CreatedAt:     now,
				UpdatedAt:     now,
			}
			if err := h.storage.DB.WithContext(ctx).Create(replyInbox).Error; err == nil {
				replyPayload = &SidebarChatMessage{
					ID:         replyInbox.ID,
					ThreadID:   replyInbox.ThreadID,
					Title:      replyInbox.Header,
					Role:       replyInbox.Role,
					Summary:    replyInbox.Summary,
					Content:    replyInbox.Content,
					Actions:    []storage.InboxAction{},
					Status:     replyInbox.Status,
					ReceivedAt: replyInbox.ReceivedAt,
				}
			}
		}
	}

	if replyPayload != nil {
		c.JSON(http.StatusCreated, gin.H{
			"message": responsePayload,
			"reply":   replyPayload,
		})
		return
	}

	c.JSON(http.StatusCreated, responsePayload)
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

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func parseThreadFromExternal(s string) uint64 {
	if s == "" {
		return 0
	}
	var tid uint64
	if _, err := fmt.Sscanf(s, "%d", &tid); err == nil {
		return tid
	}
	return 0
}
