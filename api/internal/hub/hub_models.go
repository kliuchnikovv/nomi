package hub

import (
	"encoding/json"
	"os"

	"go.uber.org/zap"
)

type modelsStreamingConfig struct {
	Models []struct {
		ID        string `json:"id"`
		Streaming bool   `json:"streaming"`
	} `json:"models"`
}

func loadModelsStreaming() map[string]bool {
	paths := []string{"api/config/models.json", "config/models.json"}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var cfg modelsStreamingConfig
		if err := json.Unmarshal(data, &cfg); err != nil {
			continue
		}
		m := make(map[string]bool, len(cfg.Models))
		for _, model := range cfg.Models {
			m[model.ID] = model.Streaming
		}
		return m
	}
	return nil
}

// Streaming returns true if the model has streaming enabled (do not persist text
// chunks; only DONE overwrite). False if unknown or not configured.
func (h *Hub) Streaming(modelID string) bool {
	if modelID == "" {
		return false
	}
	h.streamingMu.RLock()
	defer h.streamingMu.RUnlock()
	if h.streamingMap == nil {
		return false
	}
	return h.streamingMap[modelID]
}

// initStreamingMap loads models config and populates streamingMap. Call from NewHub.
func (h *Hub) initStreamingMap() {
	m := loadModelsStreaming()
	h.streamingMu.Lock()
	h.streamingMap = m
	h.streamingMu.Unlock()
	if m != nil {
		h.logger.Debug("loaded models streaming config", zap.Int("models_count", len(m)))
	} else {
		h.logger.Warn("models config not loaded; Streaming(modelID) will always return false")
	}
}
