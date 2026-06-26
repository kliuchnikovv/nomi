"""Shared summarization helpers for chat recaps.

Extracted from the ``/compact`` slash command so both the command and the
``POST /chats/recap`` endpoint share one prompt and one summarizer. The recap
endpoint summarizes the API's ``messages`` rows (role/text pairs) instead of
Agno session runs, but the LLM call and prompt are identical.
"""

from __future__ import annotations

from typing import Any

# Bound the prompt — long conversations can blow the context window of the
# summarizer otherwise. ~16k chars ≈ 4k tokens — fits any small model.
_MAX_CHARS = 16_000

SUMMARY_PROMPT = (
    "Summarize the conversation below in 1-2 paragraphs. Preserve concrete "
    "facts, names, decisions, open questions, and the user's stated "
    "preferences. Omit pleasantries. Write in the same language as the user. "
    "Do not address the user — write a neutral third-person recap.\n\n"
    "--- CONVERSATION ---\n{body}\n--- END ---\n\nSummary:"
)


def _truncate(text: str) -> str:
    if len(text) > _MAX_CHARS:
        # Keep the tail — most recent turns matter more than ancient ones.
        return "[…earlier turns truncated…]\n" + text[-_MAX_CHARS:]
    return text


def messages_to_text(messages: list[dict[str, Any]]) -> str:
    """Flatten API messages (``{"role", "text"}`` pairs) into a transcript."""
    lines: list[str] = []
    for msg in messages or []:
        role = str(msg.get("role") or "").lower()
        text = msg.get("text") or msg.get("content") or ""
        if not isinstance(text, str) or not text.strip():
            continue
        speaker = "USER" if role in ("user", "human") else "ASSISTANT"
        lines.append(f"{speaker}: {text.strip()}")
    return _truncate("\n".join(lines))


async def summarize(model: Any, body: str) -> str:
    """Run a single one-shot LLM call. Returns the summary string."""
    from agno.models.message import Message

    prompt = SUMMARY_PROMPT.format(body=body)
    response = await model.aresponse(messages=[Message(role="user", content=prompt)])
    content = getattr(response, "content", None) or str(response)
    return str(content).strip()


async def generate_recap(
    messages: list[dict[str, Any]],
    flags: dict[str, Any],
    build_model: Any,
    model_name: str = "gpt-4o-mini",
) -> tuple[str, bool, dict[str, Any] | None]:
    """Decide whether to reuse the cached recap or generate a fresh one.

    Returns ``(recap, cached, updates)``:
      * cache hit (same message count) → ``(cached_recap, True, None)``
      * empty transcript / empty summary → ``("", False, None)``
      * fresh generation → ``(summary, False, {flag updates to persist})``

    ``build_model`` is a callable ``(model_name) -> model``. The caller persists
    ``updates`` (without a timestamp, which it adds itself).
    """
    msg_count = len(messages)

    cached = flags.get("chat_recap")
    if cached and flags.get("chat_recap_msg_count") == msg_count:
        return str(cached), True, None

    body = messages_to_text(messages)
    if not body:
        return "", False, None

    model = build_model(model_name)
    summary = await summarize(model, body)
    if not summary:
        return "", False, None

    updates = {"chat_recap": summary, "chat_recap_msg_count": msg_count}
    return summary, False, updates
