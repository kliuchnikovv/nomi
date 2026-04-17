from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from pathlib import Path

CONFIG_PATH = Path(__file__).parent.parent.parent / "config" / "models.json"


class LLMProvider(ABC):
    @abstractmethod
    def complete(self, system: str, user: str, images: list[bytes] | None = None) -> str: ...

    @property
    @abstractmethod
    def supports_vision(self) -> bool: ...


class AnthropicProvider(LLMProvider):
    def __init__(self, model: str) -> None:
        import anthropic
        self.client = anthropic.Anthropic()
        self.model = model

    @property
    def supports_vision(self) -> bool:
        return True

    def complete(self, system: str, user: str, images: list[bytes] | None = None) -> str:
        import base64
        content: list[dict] = []
        if images:
            for img in images:
                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": base64.b64encode(img).decode(),
                    },
                })
        content.append({"type": "text", "text": user})
        msg = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": content}],
        )
        return msg.content[0].text


class GoogleProvider(LLMProvider):
    def __init__(self, model: str, api_key: str | None = None) -> None:
        import google.genai as genai
        self._genai = genai
        self._api_key = api_key or os.environ.get("GOOGLE_API_KEY", "placeholder")
        self._client: object | None = None
        self.model = model

    def _get_client(self):
        if self._client is None:
            self._client = self._genai.Client(api_key=self._api_key)
        return self._client

    @property
    def supports_vision(self) -> bool:
        return True

    def complete(self, system: str, user: str, images: list[bytes] | None = None) -> str:
        from google.genai import types
        client = self._get_client()
        parts: list = []
        if images:
            for img in images:
                parts.append(types.Part.from_bytes(data=img, mime_type="image/png"))
        parts.append(types.Part.from_text(text=user))
        response = client.models.generate_content(
            model=self.model,
            contents=parts,
            config=types.GenerateContentConfig(system_instruction=system),
        )
        return response.text


class OpenAICompatibleProvider(LLMProvider):
    def __init__(self, model: str, base_url: str, api_key: str) -> None:
        import openai
        self.client = openai.OpenAI(base_url=base_url, api_key=api_key)
        self.model = model
        self.base_url = base_url

    @property
    def supports_vision(self) -> bool:
        return False

    def complete(self, system: str, user: str, images: list[bytes] | None = None) -> str:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        content = response.choices[0].message.content
        if content is None:
            raise ValueError("Model returned no text content (empty or tool-only response)")
        return content


_KNOWN_PROVIDERS = {"anthropic", "google", "openai", "openrouter", "opencode", "z.ai"}


def load_provider(provider_name: str, model_name: str) -> LLMProvider:
    if provider_name not in _KNOWN_PROVIDERS:
        raise ValueError(f"Unknown provider: '{provider_name}'. Add it to providers.py.")

    with open(CONFIG_PATH) as f:
        config = json.load(f)

    model_cfg = next(
        (m for m in config["models"] if m["provider"] == provider_name and m["id"] == model_name),
        None,
    )
    if model_cfg is None:
        raise ValueError(f"Model '{model_name}' for provider '{provider_name}' not found in config/models.json")

    if provider_name == "anthropic":
        return AnthropicProvider(model=model_name)

    if provider_name == "google":
        return GoogleProvider(model=model_name)

    # openai, openrouter, opencode, z.ai — all OpenAI-compatible
    api_key = os.environ.get(f"{provider_name.upper().replace('.', '_')}_API_KEY", "placeholder")
    return OpenAICompatibleProvider(
        model=model_name,
        base_url=model_cfg["endpoint"],
        api_key=api_key,
    )
