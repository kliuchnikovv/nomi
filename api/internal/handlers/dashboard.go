package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/chat"
	"github.com/kliuchnikovv/genie-api/internal/storage"
)

// DashboardHandler handles dashboard data requests.
type DashboardHandler struct {
	storage *storage.Storage
}

// NewDashboardHandler creates a new instance of DashboardHandler.
func NewDashboardHandler(storage *storage.Storage) *DashboardHandler {
	return &DashboardHandler{storage: storage}
}

// DashboardResponse represents the dashboard data structure.
type DashboardResponse struct {
	User struct {
		Name string `json:"name"`
	} `json:"user"`
	RecentChats []chat.Chat `json:"recent_chats"`
	Stats       struct {
		UnreadEmails int `json:"unread_emails"`
		TodayEvents  int `json:"today_events"`
	} `json:"stats"`
}

// GetDashboard returns dashboard data for the authenticated user.
func (h *DashboardHandler) GetDashboard(c *gin.Context) {
	ctx := c.Request.Context()

	user, err := userFromCtx(ctx)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}

	// Get recent chats (last 5)
	allChats, err := h.storage.GetUserChats(ctx, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch chats"})
		return
	}

	// Limit to 5 most recent chats
	recentChats := allChats
	if len(allChats) > 5 {
		recentChats = allChats[:5]
	}

	// Add icons to chats
	for i := range recentChats {
		recentChats[i].Icon = getIconForTeam(recentChats[i].TeamID)
	}

	// Prepare response
	response := DashboardResponse{
		RecentChats: make([]chat.Chat, len(recentChats)),
	}

	// Copy chats (dereference pointers)
	for i, chat := range recentChats {
		if chat != nil {
			response.RecentChats[i] = *chat
		}
	}

	response.User.Name = user.Name

	// TODO: Add stats from integrations (unread emails, today's events)
	// This will require querying the integrations/plugins system
	response.Stats.UnreadEmails = 0
	response.Stats.TodayEvents = 0

	c.JSON(http.StatusOK, response)
}
