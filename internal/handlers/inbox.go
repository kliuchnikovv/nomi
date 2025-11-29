package handlers

import (
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// InboxHandler exposes inbox data grouped as chat->thread->message.
type InboxHandler struct {
	storage *storage.Storage
}

func NewInboxHandler(storage *storage.Storage) *InboxHandler {
	return &InboxHandler{storage: storage}
}

type InboxMessage struct {
	ID         uuid.UUID             `json:"id"`
	ThreadID   string                `json:"thread_id"`
	Title      string                `json:"title"`
	Role       string                `json:"role"`
	Summary    string                `json:"summary,omitempty"`
	Content    string                `json:"content,omitempty"`
	Actions    []storage.InboxAction `json:"actions,omitempty"`
	Status     string                `json:"status"`
	ReceivedAt time.Time             `json:"received_at"`
	Sender     string                `json:"sender,omitempty"`
}

type InboxThread struct {
	ThreadID     string         `json:"thread_id"`
	Title        string         `json:"title"`
	LastReceived time.Time      `json:"last_received"`
	Count        int            `json:"count"`
	Messages     []InboxMessage `json:"messages"`
}

type InboxChat struct {
	ChatID        string        `json:"chat_id"`
	Sender        string        `json:"sender"`
	IntegrationID uuid.UUID     `json:"integration_id"`
	Provider      string        `json:"provider"`
	LastReceived  time.Time     `json:"last_received"`
	Count         int           `json:"count"`
	Threads       []InboxThread `json:"threads"`
}

// ListInbox builds chat->thread->message structure for inbox items.
func (h *InboxHandler) ListInbox(c *gin.Context) {
	ctx := c.Request.Context()
	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// Optional filters
	var integrationFilter *uuid.UUID
	if integIDStr := c.Query("integration_id"); integIDStr != "" {
		if integID, err := uuid.Parse(integIDStr); err == nil {
			integrationFilter = &integID
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integration_id"})
			return
		}
	}
	sourceFilter := c.Query("provider")

	// Load inbox messages
	var inboxes []storage.Inbox
	q := h.storage.DB.WithContext(ctx).Where("user_id = ?", user.ID)
	if integrationFilter != nil {
		q = q.Where("integration_id = ?", *integrationFilter)
	}
	if sourceFilter != "" {
		q = q.Where("source = ?", sourceFilter)
	}
	if err := q.Order("received_at ASC").Find(&inboxes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load messages"})
		return
	}

	// Group messages by sender (chat) and thread.
	type threadState struct {
		threadID string
		thread   *InboxThread
	}
	chatMap := make(map[string]*InboxChat)

	for _, msg := range inboxes {
		chatKey := msg.Sender + "|" + msg.IntegrationID.String()
		threadID := extractThreadID(msg)

		if _, ok := chatMap[chatKey]; !ok {
			chatMap[chatKey] = &InboxChat{
				ChatID:        deterministicID(chatKey),
				Sender:        msg.Sender,
				IntegrationID: msg.IntegrationID,
				Provider:      msg.Source,
				LastReceived:  msg.ReceivedAt,
				Threads:       []InboxThread{},
			}
		}
		chat := chatMap[chatKey]
		if msg.ReceivedAt.After(chat.LastReceived) {
			chat.LastReceived = msg.ReceivedAt
		}
		chat.Count++

		var t *InboxThread
		for i := range chat.Threads {
			if chat.Threads[i].ThreadID == threadID {
				t = &chat.Threads[i]
				break
			}
		}
		if t == nil {
			t = &InboxThread{
				ThreadID: threadID,
				Title:    firstNonEmpty(msg.Header, msg.Summary),
				Messages: []InboxMessage{},
			}
			chat.Threads = append(chat.Threads, *t)
			t = &chat.Threads[len(chat.Threads)-1]
		}
		t.Count++
		if msg.ReceivedAt.After(t.LastReceived) {
			t.LastReceived = msg.ReceivedAt
		}

		var actions []storage.InboxAction
		if len(msg.Actions) > 0 {
			_ = json.Unmarshal(msg.Actions, &actions)
		}

		t.Messages = append(t.Messages, InboxMessage{
			ID:         msg.ID,
			ThreadID:   threadID,
			Title:      msg.Header,
			Role:       msg.Role,
			Summary:    msg.Summary,
			Content:    msg.Content,
			Actions:    actions,
			Status:     msg.Status,
			ReceivedAt: msg.ReceivedAt,
			Sender:     msg.Sender,
		})
	}

	// Flatten to slice preserving insertion order (best-effort sorted by last_received desc)
	result := make([]InboxChat, 0, len(chatMap))
	for _, chat := range chatMap {
		result = append(result, *chat)
	}

	// sort chats by LastReceived desc
	sort.Slice(result, func(i, j int) bool {
		return result[i].LastReceived.After(result[j].LastReceived)
	})
	for i := range result {
		// sort threads by LastReceived desc
		sort.Slice(result[i].Threads, func(a, b int) bool {
			return result[i].Threads[a].LastReceived.After(result[i].Threads[b].LastReceived)
		})
	}

	c.JSON(http.StatusOK, gin.H{"items": result})
}

// extractThreadID tries to derive a stable thread identifier from metadata/thread fields.
func extractThreadID(msg storage.Inbox) string {
	// Prefer metadata chat_id if present
	if len(msg.Metadata) > 0 {
		var meta map[string]interface{}
		if err := json.Unmarshal(msg.Metadata, &meta); err == nil {
			if val, ok := meta["chat_id"].(string); ok && val != "" {
				return val
			}
			if val, ok := meta["thread_id"]; ok {
				switch v := val.(type) {
				case string:
					if v != "" {
						return v
					}
				case float64:
					if v != 0 {
						return strconv.FormatUint(uint64(v), 10)
					}
				}
			}
		}
	}
	if msg.ThreadID != 0 {
		return strconv.FormatUint(msg.ThreadID, 10)
	}
	if msg.MessageID != "" {
		return msg.MessageID
	}
	return msg.ID.String()
}

// deterministicID produces a stable UUID from a string key.
func deterministicID(key string) string {
	ns := uuid.Nil
	return uuid.NewSHA1(ns, []byte(key)).String()
}
