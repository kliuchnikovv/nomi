from typing import Sequence

from agno.db.postgres import PostgresDb
from agno.agent import Agent
from agno.models.base import Model
from agno.tools import Toolkit, Function

name = 'Mailer'
description = (
    "Email triage agent that rates importance and urgency, summarizes the message, "
    "and proposes clear follow-up options."
)
instructions = """
You receive a single email (plain text or snippet) with metadata. Do the following:
1) Classify importance (high/medium/low) and urgency (urgent/soon/can wait) with one-line reasons.
2) Write a 2–3 sentence summary focused on sender intent and key asks/dates.
3) Propose 3–5 action options. You MUST follow these rules for actions:
    - ALWAYS include an "Open in Web" action with command "open_web".
    - IF the email is NOT marked as read (or if you can't tell, assume it's unread), include a "Mark as Done" action with command "mark_done".
    - IF the email contains an unsubscribe link or is clearly promotional/newsletter, include an "Unsubscribe" action with command "unsubscribe".
    - You may include other actions like "Reply" (command "reply") if appropriate.

For each action, provide:
    - label: A short, human-readable label.
    - why: A one-line rationale.
    - command: The machine-readable command identifier.
    - agent: "mailer".
    - url: For "open_web" command, extract the Gmail web URL from the email metadata if provided (look for fields like "web_url", "link", "gmail_url"). If not found, set to null. For all other commands, set to null.
    - prompt: A natural language prompt for the agent to execute the command (REQUIRED for "mark_done", "unsubscribe", "reply", etc., null for "open_web").

Rules:
- Use only information present in the email; do not invent details.
- Keep suggestions concise and practical for fast triage.
- If information is missing to decide, state what is missing before making a guess.
- Return ONLY raw JSON per expected_output, without markdown fences or extra text.
"""
expected_output = """
{
  "title": "{email_subject}",
  "importance": {"level": "high|medium|low", "reason": "short reason"},
  "urgency": {"level": "urgent|soon|can_wait", "reason": "short reason"},
  "summary": "2-3 sentence summary focusing on intent and key asks/dates",
  "actions": [
    {
      "label": "Open in Web",
      "why": "View original message",
      "command": "open_web",
      "agent": "mailer",
      "url": "{extracted_gmail_url_from_metadata_or_null}",
      "prompt": null
    },
    {
      "label": "Mark as Done",
      "why": "No further action needed",
      "command": "mark_done",
      "agent": "mailer",
      "url": null,
      "prompt": "Mark email '{email_subject}' as read"
    },
    {
      "label": "Reply",
      "why": "Urgent request",
      "command": "reply",
      "agent": "mailer",
      "url": null,
      "prompt": "Reply to '{sender}' regarding '{email_subject}'"
    }
  ],
  "missing_info": "what is missing to decide, or empty string if nothing"
}
"""

class MailerAgent(Agent):
    def __init__(
        self,
        model: Model,
        db: PostgresDb | None = None,
        tools: Sequence[Toolkit | Function | dict] | None = None,
        debug_mode: bool = False,
    ):
        super().__init__(
            db=db,
            name=name,
            model=model,
            tools=tools,
            description=description,
            instructions=instructions,
            expected_output=expected_output,
            add_history_to_context=True,
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            stream=True
        )
