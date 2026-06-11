"""Judge agent for proactive event triage.

Builds a lightweight LLM judge that decides whether a proactive event is worth
surfacing to the user ("surface") or should be silently dropped ("skip").

Model selection: uses gemini-2.5-flash-lite (the cheapest/fastest model in
config/models.json).  Falls back to the factory default model if unavailable.
"""
import json
import logging
import os

from agno.agent import Agent

logger = logging.getLogger(__name__)

JUDGE_SYSTEM_PROMPT = (
    "You decide whether an event is worth surfacing to the user right now.\n"
    'Return ONLY a JSON object: {"decision": "surface" | "skip", "reason": "<one short sentence>"}.\n'
    "Be conservative: when in doubt, skip. The user's attention is precious.\n"
    "Consider: relevance, urgency, redundancy with what they likely already know."
)

# Cheapest model available in config/models.json (gemini-2.5-flash-lite).
# No Anthropic/Haiku entry exists in the current config, so we use Google's
# lightweight Flash-Lite.  Override via JUDGE_MODEL_ID env var if needed.
_DEFAULT_JUDGE_MODEL_ID = "gemini-2.5-flash-lite"


def build_judge_agent(model_id: str | None = None) -> Agent:
    """Build a minimal stateless judge agent.

    Args:
        model_id: Optional model ID override.  Defaults to gemini-2.5-flash-lite.

    Returns:
        An Agno Agent configured for triage decisions.
    """
    from src.core.gemini_keys import KEY_MANAGER
    from src.models.safe_gemini import SafeGemini

    chosen_id = model_id or os.getenv("JUDGE_MODEL_ID", _DEFAULT_JUDGE_MODEL_ID)
    model = SafeGemini(id=chosen_id, api_key=KEY_MANAGER.current())
    logger.info("[Judge] Building judge agent with model=%s", chosen_id)
    return Agent(model=model, system_prompt=JUDGE_SYSTEM_PROMPT)


def build_judge_user_message(event_type: str, payload: dict) -> str:
    """Serialize an event for the judge prompt."""
    return (
        f"Event type: {event_type}\n"
        f"Payload: {json.dumps(payload, indent=2)}\n"
        "(Memory context unavailable in V1 — V2 will add top-5 facts.)"
    )


async def run_judge(event: dict) -> dict:
    """Run the judge on a proactive event dict.

    Args:
        event: Dict with keys: event_id, user_id, event_type, payload,
               and optionally updates_chat_id.

    Returns:
        Dict with keys: decision ("surface"|"skip"), reason (str).
    """
    event_type = event.get("event_type", "unknown")
    payload = event.get("payload", {})

    agent = build_judge_agent()
    user_msg = build_judge_user_message(event_type, payload)

    try:
        result = await agent.arun(user_msg)
        text = result.content if result else ""
        # Extract JSON from response
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(text[start:end])
        else:
            logger.warning("[Judge] Could not extract JSON from response: %s", text[:200])
            data = {"decision": "skip", "reason": "Failed to parse judge response"}
    except Exception as e:
        logger.error("[Judge] Judge agent failed: %s", e, exc_info=True)
        data = {"decision": "skip", "reason": f"Judge error: {e}"}

    decision = data.get("decision", "skip")
    reason = data.get("reason", "")
    logger.info("[Judge] event_type=%s decision=%s reason=%s", event_type, decision, reason)
    return {"decision": decision, "reason": reason}
