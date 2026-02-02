package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/kliuchnikovv/genie-api/internal/plugins"
)

// ListPlugins returns the list of loaded plugin manifests (GET /api/plugins).
// Used by frontend and Python to discover available integrations.
func ListPlugins(c *gin.Context) {
	if plugins.Manifests == nil {
		c.JSON(http.StatusOK, []interface{}{})
		return
	}
	c.JSON(http.StatusOK, plugins.Manifests)
}
