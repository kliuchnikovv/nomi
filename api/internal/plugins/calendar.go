package plugins

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

func NewCalendarPlugin() Plugin {
	return &calendarPlugin{}
}

type calendarPlugin struct {
	state map[string]interface{}
	rt    *Runtime
}

func (c *calendarPlugin) Info() Info {
	return Info{
		Name:        "calendar",
		Description: "Google Calendar integration plugin",
		Version:     "0.1.0",
	}
}

func (c *calendarPlugin) DefaultState() map[string]interface{} {
	return map[string]interface{}{
		"connected":        false,
		"sync_window_days": 7,
	}
}

func (c *calendarPlugin) Init(ctx context.Context, rt *Runtime, state map[string]interface{}) error {
	c.state = state
	c.rt = rt
	return nil
}

func (c *calendarPlugin) RegisterRoutes(router *gin.RouterGroup) {
	router.GET("/state", c.stateHandler)
	router.POST("/agents/:name", c.callAgent)
}

func (c *calendarPlugin) Shutdown(ctx context.Context) error {
	return nil
}

func (c *calendarPlugin) stateHandler(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{"plugin": c.Info(), "state": c.state})
}

func (c *calendarPlugin) callAgent(ctx *gin.Context) {
	agent := ctx.Param("name")
	var payload map[string]interface{}
	_ = ctx.ShouldBindJSON(&payload)
	if _, err := c.rt.CallAgent(ctx.Request.Context(), agent, payload); err != nil {
		ctx.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	ctx.Status(http.StatusAccepted)
}
