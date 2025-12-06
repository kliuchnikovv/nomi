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

Rules:
- Use only information present in the email; do not invent details.
- Keep suggestions concise and practical for fast triage.
- If information is missing to decide, state what is missing before making a guess.
- Write summary as if you writing it to the user in the chat.
- Return ONLY raw JSON per expected_output, without markdown fences or extra text.
"""
expected_output = """
{
  "title": "{email_subject}",
  "importance": {"level": "high|medium|low", "reason": "short reason"},
  "urgency": {"level": "urgent|soon|can_wait", "reason": "short reason"},
  "summary": "2-3 sentence summary focusing on intent and key asks/dates",
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
            add_history_to_context=False,  # Disabled: history is passed via HISTORY frame
            add_datetime_to_context=True,
            debug_mode=debug_mode,
            stream=True
        )
