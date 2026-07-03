## What
Auto-detect available LLM models from a given API key and endpoint for OpenAI-compatible providers.

## How it works
- New module `back/src/models/model_detector.py` with `detect_available_models(base_url, api_key, provider=None)` function
- Queries the OpenAI-compatible `GET /v1/models` endpoint to fetch available models
- Returns a list of `ModelInfo` (Pydantic BaseModel with `id`, `created`, `owned_by`)
- Graceful error handling: `AuthenticationError` (401), `EndpointNotSupportedError` (404), `ModelDetectionTimeoutError`, generic `ModelDetectionError`
- Static model lists for non-OpenAI-compatible providers (Anthropic, Google Gemini)
- Convenience wrapper `detect_models(provider, api_key, base_url=None)` resolves provider defaults

## Supported Providers
- **OpenAI** (`https://api.openai.com/v1`)
- **OpenRouter** (`https://openrouter.ai/api/v1`)
- **Groq** (`https://api.groq.com/openai/v1`)
- **Together AI** (`https://api.together.xyz/v1`)
- **Local Ollama** (`http://localhost:11434/v1`)
- **Any custom OpenAI-compatible endpoint**
- **Anthropic** (static list fallback)
- **Google Gemini** (static list fallback)

## How to test
```bash
cd back && pytest tests/models/test_model_detector.py -v
```

## Tests
38 unit tests covering: successful detection, 401/404/500 errors, timeout, network errors, non-JSON responses, malformed data, Anthropic/Gemini static fallback, custom endpoints, ModelInfo validation, exception hierarchy.