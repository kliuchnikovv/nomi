import logging
import json
from typing import Optional, List
from agno.agent import Agent
from agno.models.base import Model
from agno.knowledge import Knowledge
from agno.tools import Toolkit
from pydantic import BaseModel, Field

class BriefingItem(BaseModel):
    id: str = Field(..., description="Unique identifier for the item")
    type: str = Field(..., description="Type of item: 'meeting', 'email', 'task', 'alert'")
    priority: str = Field(..., description="Priority: 'CRITICAL', 'INFO'")
    title: str = Field(..., description="Short title/summary of the item")
    description: str = Field(..., description="Detailed description")
    context: Optional[str] = Field(None, description="Enriched context from knowledge base (e.g., 'Last email sent 2 days ago')")
    action_required: bool = Field(False, description="True if immediate action is needed")
    source_link: Optional[str] = Field(None, description="Link to source (e.g., email link, github issue)")

class BriefingResponse(BaseModel):
    headline: str = Field(..., description="Catchy header for the daily briefing")
    summary: str = Field(..., description="1-2 sentence high-level summary of the day")
    items: List[BriefingItem] = Field(..., description="List of prioritized briefing items")

BRIEFING_INSTRUCTIONS = """You are the Executive Morning Briefing Agent. Your goal is to prepare a concise, high-impact daily briefing using the provided integration data.

### OUTPUT FORMAT
You must return a valid JSON object matching the following schema:
{json_schema}

Do not include markdown code blocks (```json ... ```). Return ONLY the raw JSON.

### INPUT DATA
You will be provided with a context containing data from user integrations (Emails, Calendar, GitHub, etc.).
DO NOT try to call tools to fetch this data. Use the provided context directly.

### PIPELINE STEPS:

1.  **DATA ANALYSIS**:
    Analyze the provided `integration_data` in the context.
    
    - **Emails**: Check for urgent messages, project updates, meeting invites.
    - **Calendar**: Check for upcoming meetings in the next 24h, conflicts.
    - **GitHub**: Check for assigned issues, PRs awaiting review, mentions.
    
    - **Web Search**: Use for current events or context enrichment (only if necessary/enabled).

    - Classify items as `CRITICAL`, `INFO`, or `NOISE`.
    - **Discard ONLY obvious NOISE** (spam, marketing newsletters).
    - **ALWAYS INCLUDE** at least the top 1-2 items from EACH tool source (Email, Calendar, GitHub) if any data is present.
    - `CRITICAL`: Boss meetings, Production errors, High priority blockers, Urgent client emails.
    - `INFO`: Everything else found (Regular meetings, PRs, Emails from colleagues).

3.  **ENRICHMENT (RAG & WEB SEARCH)**:
    - For EVERY `CRITICAL` and `INFO` item, try to enrich with context if knowledge base is available.
    - ADD enriched context to the `context` field.

4.  **SYNTHESIS**:
    - Generate the final JSON response conforming to `BriefingResponse` schema.
    - The `headline` should be compelling and accurate.
    - Limit to 5-8 most important items (focus on quality over quantity).

### STYLE
- Professional, concise, executive summary style.
- No fluff - every word counts.
- Focus on "Actions" and "Blockers".
- If data is missing/empty, be helpful: suggest connecting integrations or say "No recent items found".
- Use present tense for immediacy.
"""

class BriefingAgent(Agent):
    def __init__(
        self,
        model: Model,
        tools: Optional[List[Toolkit]] = None,
        knowledge: Optional[Knowledge] = None,
        debug_mode: bool = False,
    ):
        # Inject schema into instructions
        instructions_with_schema = BRIEFING_INSTRUCTIONS.replace("{json_schema}", json.dumps(BriefingResponse.model_json_schema(), indent=2))

        super().__init__(
            model=model,
            name="BriefingAgent",
            instructions=instructions_with_schema,
            tools=tools,
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),
            debug_mode=debug_mode,
            description="Prepares the daily executive briefing with context.",
        )

    async def run(self, user_id: str, integration_data: dict = None):
        """
        Run the agent with provided integration data injected into the context/prompt.
        """
        message = "Please generate my daily briefing."

        if integration_data:
            # Format the data as a structured string for the prompt
            data_context = "Here is the data from my integrations:\n\n"

            if integration_data.get('emails'):
                data_context += "### EMAILS (Last 24h):\n"
                for email in integration_data['emails']:
                    data_context += f"- [{email.get('date')}] From: {email.get('from')} | Subject: {email.get('subject')} | Snippet: {email.get('snippet')}\n"

            if integration_data.get('events'):
                data_context += "\n### CALENDAR (Next 24h):\n"
                for event in integration_data['events']:
                    data_context += f"- [{event.get('start')} - {event.get('end')}] {event.get('summary')}\n"

            if integration_data.get('issues'):
                data_context += "\n### GITHUB ISSUES (Assigned):\n"
                for issue in integration_data['issues']:
                    data_context += f"- #{issue.get('id')} {issue.get('title')} ({issue.get('state')})\n"

            if integration_data.get('tasks'):
                data_context += "\n### JULES TASKS:\n"
                for task in integration_data['tasks']:
                     data_context += f"- {task.get('title')} ({task.get('status')})\n"

            message = f"{data_context}\n\n{message}"
        else:
            message += "\n(No integration data provided - please remind me to connect my accounts if I want personalized updates)"

        # We call the parent print_response or just return the generator/response
        # But 'run' usually isn't an async method in Agno Agent base unless we use async_run?
        # Checking base class... Usually it's .print_response() or .run().
        # The prompt implies we are modifying the 'run' method or wrapper.
        # Since I can't see `Agent` code, I'll assume standard usage.
        # But wait, `app.py` calls `await briefing_agent.run(...)`.
        # So I should implement `run` or ensure `Agent` supports it.
        # Actually `Agent` usually has `run`. I am overriding it here effectively to prepend context.
        # But `Agent.run` signature might be different.
        # I'll rename this to `generate_briefing` to avoid conflict and update `app.py` call.

        # ACTUALLY, checking `app.py` (next file to read), it calls `await briefing_agent.run(...)`?
        # No, `app.py` code I haven't read yet but plan to modify.
        # The plan says: `result = await briefing_agent.run(...)`.

        # I will implement `generate_briefing` and call `self.aprint_response` or `self.arun` if it exists.
        # Let's assume `arun` (async run) is the method name in Agno for async.

        return await self.arun(message)

    # We need to expose a method that `app.py` can call.
    async def generate_briefing(self, user_id: str, integration_data: dict = None):
         # Same logic as above
        message = "Please generate my daily briefing."
        if integration_data:
            data_context = "Here is the data from my integrations:\n\n"
            if integration_data.get('emails'):
                data_context += "### EMAILS (Last 24h):\n" + json.dumps(integration_data['emails'], indent=2) + "\n"
            if integration_data.get('events'):
                data_context += "### CALENDAR (Next 24h):\n" + json.dumps(integration_data['events'], indent=2) + "\n"
            if integration_data.get('issues'):
                data_context += "### GITHUB ISSUES:\n" + json.dumps(integration_data['issues'], indent=2) + "\n"

            message = f"{data_context}\n\n{message}"

        # Use arun to get response
        response = await self.arun(message)
        # response is usually a RunResponse object.
        # We need to extract content.
        return response.content
