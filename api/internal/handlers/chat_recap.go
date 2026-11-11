package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/kliuchnikovv/nomi-api/internal/apierror"
	"github.com/kliuchnikovv/nomi-api/internal/services"
)

// recapMinMessages is the threshold below which a chat is too short to be worth
// recapping. Keep this in sync with RECAP_MIN on the frontend.
const recapMinMessages = 6

type recapMessage struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type recapRequest struct {
	ChatID   string         `json:"chat_id"`
	UserID   string         `json:"user_id"`
	Messages []recapMessage `json:"messages"`
	// SessionID is the Agno session key (== chat id for chats); lets the brain
	// fetch a native session summary when SessionSummaryMode == "agno".
	SessionID          string `json:"session_id"`
	SessionSummaryMode string `json:"session_summary_mode"`
}

// GenerateRecap handles POST /api/chats/:id/recap. It loads the chat's messages
// (scoped to the authenticated user), and — if the chat is long enough — asks
// the Python brain to summarize them. The brain caches the recap in
// chats.session_flags and only regenerates it when the message count changes.
func (h *ChatHandler) GenerateRecap(c *gin.Context) {
	ctx := c.Request.Context()

	chatID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		apierror.Respond(c, apierror.NewBadRequest("Invalid chat UUID", nil))
		return
	}

	user, err := userFromCtx(ctx)
	if err != nil {
		apierror.Respond(c, apierror.NewUnauthorized(err.Error()))
		return
	}

	messages, err := h.messageService.GetMessages(ctx, user.ID, chatID, &services.GetMessagesRequest{})
	if err != nil {
		apierror.Respond(c, apierror.NewInternalServerError("Failed to fetch messages"))
		return
	}

	// Short chats don't need a recap — return an empty one so the client hides
	// the banner without a wasted LLM call.
	if len(messages) < recapMinMessages {
		c.JSON(http.StatusOK, gin.H{"recap": ""})
		return
	}

	payload := recapRequest{
		ChatID:             chatID.String(),
		UserID:             user.ID.String(),
		Messages:           make([]recapMessage, 0, len(messages)),
		SessionID:          chatID.String(),
		SessionSummaryMode: user.SessionSummaryMode,
	}
	for _, m := range messages {
		payload.Messages = append(payload.Messages, recapMessage{
			Role: string(m.Role),
			Text: m.Text,
		})
	}

	recap, err := h.requestRecap(ctx, payload)
	if err != nil {
		// Log the detail server-side; return a generic message so backend URLs
		// and internal error text don't leak to the client.
		log.Printf("recap generation failed (chat %s): %v", chatID, err)
		apierror.Respond(c, apierror.NewInternalServerError("Failed to generate recap"))
		return
	}

	c.JSON(http.StatusOK, recap)
}

func (h *ChatHandler) recapBackendURL() string {
	if h.cfg != nil && h.cfg.LLM.BaseURL != "" {
		return h.cfg.LLM.BaseURL
	}
	return "http://127.0.0.1:7777"
}

// requestRecap proxies the recap request to the Python brain and returns the
// raw decoded JSON response (e.g. {"recap": "...", "cached": true}).
func (h *ChatHandler) requestRecap(ctx context.Context, payload recapRequest) (map[string]any, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.recapBackendURL()+"/chats/recap", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.recapClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &backendError{status: resp.StatusCode, body: string(respBody)}
	}

	var parsed map[string]any
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}
