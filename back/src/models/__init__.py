"""Models package with custom wrappers."""
from .safe_gemini import SafeGemini
from .safe_openai import SafeOpenAI

__all__ = ["SafeGemini", "SafeOpenAI"]
