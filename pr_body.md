## What
This PR adds the ability to auto-detect available LLM models by querying a provider's `/v1/models` endpoint using an API key and endpoint URL.

## Why
Currently, models are loaded from a static `config/models.json` file. This feature allows users to dynamically discover what models are available from their configured providers (OpenAI-compatible), reducing manual configuration overhead.

## How
- **New endpoint**: `POST /api/v1/models/discover` accepts `{"apiKey": "...", "endpoint": "..."}` and returns a list of available models
- **OpenAI-compatible**: Works with any provider that implements the `/v1/models` endpoint (OpenAI, OpenRouter, Together AI, etc.)
- **Integration**: Built on top of the existing `ModelsHandler` pattern, with `*zap.Logger` for structured logging

## Files Changed
- `api/internal/handlers/model_discovery.go` (new) - Discovery logic and HTTP handler
- `api/internal/handlers/model_discovery_test.go` (new) - Unit tests
- `api/internal/handlers/models.go` (modified) - Added logger and discoverModelsFunc to ModelsHandler
- `api/internal/server/server.go` (modified) - Registered new route and pass logger

## Testing
Run: `cd api && go test ./internal/handlers/ -v -run TestDiscoverModels`

All tests pass: TestDiscoverModels and TestDiscoverModelsHandler.

## Example
```bash
curl -X POST http://localhost:8080/api/v1/models/discover \
  -H 'Content-Type: application/json' \
  -d '{"apiKey": "sk-...", "endpoint": "https://api.openai.com"}'
```