"""Inline action registry for the Telegram plugin.

Inline mode (``@bot <text>``) offers a menu of actions rather than a single
"ask" card. Each action maps the typed text to a prompt sent to the brain. The
chosen action is encoded into the inline result id (``<action>|<uuid>``) so
``chosen_inline_result`` can recover it, and a prefix (``tr: привет``) lets power
users skip the menu and pick an action directly.

Everything an action needs lives in :data:`INLINE_ACTIONS`; add a new entry here
to add a new inline action — no other file needs to know the list.
"""

import uuid
from typing import Optional, Tuple

# Order matters: this is the order cards appear in the inline menu ("ask" first).
# "title" is the bold first line of the card; "hint" is the gray second line
# (a static description of what the action does, not an echo of the typed text).
INLINE_ACTIONS: dict[str, dict] = {
    "ask": {
        "emoji": "🔎",
        "title": "🔎 Ask Nomi",
        "hint": "Answer your question",
        "prefixes": [],
        "template": "{text}",
    },
    "translate": {
        "emoji": "🌐",
        "title": "🌐 Translate",
        "hint": "Auto RU ↔ EN",
        "prefixes": ["tr", "перевод", "перевести"],
        "template": (
            "Переведи текст. Если он на русском — переведи на английский, "
            "иначе на русский. Выведи только перевод, без пояснений:\n\n{text}"
        ),
    },
    "summarize": {
        "emoji": "📝",
        "title": "📝 Summarize",
        "hint": "Short TL;DR",
        "prefixes": ["sum", "tldr", "кратко"],
        "template": (
            "Сократи текст до 1–2 предложений, сохранив ключевые факты. "
            "Выведи только результат:\n\n{text}"
        ),
    },
    "rewrite": {
        "emoji": "✍️",
        "title": "✍️ Rewrite",
        "hint": "Clearer & correct",
        "prefixes": ["rw", "rewrite", "переписать"],
        "template": (
            "Перепиши текст грамотно и понятно, сохранив смысл и язык оригинала. "
            "Выведи только результат:\n\n{text}"
        ),
    },
    "explain": {
        "emoji": "💡",
        "title": "💡 Explain",
        "hint": "In simple words",
        "prefixes": ["eli5", "объясни"],
        "template": "Объясни простыми словами:\n\n{text}",
    },
}

DEFAULT_ACTION = "ask"

# Twemoji (jdecked fork) colored emoji PNGs, served by jsDelivr. Telegram fetches
# the thumbnail server-side, so a public CDN needs no hosting on our end.
TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72"
TWEMOJI_THUMB_SIZE = 72

# prefix (lowercased) -> action_key, built once from the registry.
_PREFIX_TO_ACTION: dict[str, str] = {
    prefix.lower(): key
    for key, spec in INLINE_ACTIONS.items()
    for prefix in spec["prefixes"]
}


def parse_inline_command(text: str) -> Tuple[Optional[str], str]:
    """Split an explicit action prefix off the typed text.

    Recognises ``<prefix>:<rest>`` and ``<prefix> <rest>`` (case-insensitive),
    e.g. ``tr: привет`` or ``sum длинный текст``. Returns ``(action_key, rest)``
    when a known prefix is found, otherwise ``(None, text)`` (the menu case).
    """
    stripped = (text or "").strip()
    if not stripped:
        return None, ""

    # "prefix: rest" — colon separator.
    if ":" in stripped:
        head, _, rest = stripped.partition(":")
        action = _PREFIX_TO_ACTION.get(head.strip().lower())
        if action is not None:
            return action, rest.strip()

    # "prefix rest" — whitespace separator (only the first token).
    head, _, rest = stripped.partition(" ")
    action = _PREFIX_TO_ACTION.get(head.strip().lower())
    if action is not None and rest.strip():
        return action, rest.strip()

    return None, stripped


def encode_result_id(action_key: str) -> str:
    """Pack an action into an inline result id so chosen_inline_result can read it."""
    return f"{action_key}|{uuid.uuid4()}"


def decode_result_id(result_id: str) -> str:
    """Recover the action from a result id; unknown/missing falls back to "ask"."""
    action = (result_id or "").split("|", 1)[0]
    return action if action in INLINE_ACTIONS else DEFAULT_ACTION


def action_emoji(action_key: str) -> str:
    """Emoji for an action (used in placeholder/answer headers)."""
    return INLINE_ACTIONS.get(action_key, INLINE_ACTIONS[DEFAULT_ACTION])["emoji"]


def _twemoji_filename(emoji: str) -> str:
    """Twemoji asset name: hyphen-joined lowercase codepoints, FE0F dropped."""
    return "-".join(f"{ord(ch):x}" for ch in emoji if ord(ch) != 0xFE0F)


def thumbnail_url(action_key: str) -> str:
    """Public Twemoji PNG url for an action's emoji (Telegram card thumbnail)."""
    emoji = action_emoji(action_key)
    return f"{TWEMOJI_BASE}/{_twemoji_filename(emoji)}.png"


def render_prompt(action_key: str, payload_text: str) -> str:
    """Apply an action's template to the payload text → prompt for the brain."""
    spec = INLINE_ACTIONS.get(action_key, INLINE_ACTIONS[DEFAULT_ACTION])
    return spec["template"].format(text=payload_text)
