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

BRIEFING_INSTRUCTIONS = """You are the Executive Morning Briefing Agent. Your goal is to prepare a concise, high-impact daily briefing.

### OUTPUT FORMAT
You must return a valid JSON object matching the following schema:
{json_schema}

Do not include markdown code blocks (```json ... ```). Return ONLY the raw JSON.


### PIPELINE STEPS:

1.  **DATA GATHERING**:
    - Check your calendar for today's schedule.
    - Check your emails for urgent communications.
    - Check GitHub for high-priority tasks/issues.

2.  **SANITIZATION & PRIORITIZATION**:
    - Classify items as `CRITICAL`, `INFO`, or `NOISE`.
    - **Discard NOISE** (newsletters, low-priority automated alerts, routine casual chats).
    - `CRITICAL`: Boss meetings, Production errors, High priority blockers, Urgent client emails.
    - `INFO`: Regular meetings, Standard code reviews, Non-urgent questions.

3.  **ENRICHMENT (RAG)**:
    - For EVERY `CRITICAL` and `INFO` item, you MUST try to find context using your Knowledge Base (if available).
    - *Meeting*: Search for recent interactions with participants. "What did we discuss with Alex last time?"
    - *Task*: Search for specs or relevant notes. "Fix login timeout" -> search "login optimization" or "auth bugs".
    - ADD this context to the item description. Be specific: "Context: You promised X in the last email."

4.  **SYNTHESIS**:
    - Generate the final JSON response conforming to `BriefingResponse` schema.
    - The `headline` should be motivating or urgent depending on content (e.g., "3 Critical blockers today" vs "Smooth sailing expected").
    - Ensure `context` field contains the RAG findings.

### STYLE
- Professional, concise, executive summary style.
- No fluff.
- Focus on "Actions" and "Blockers".
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
            # response_model=BriefingResponse,  # Not supported in this version
            # structured_outputs=True,          # Not supported in this version
            debug_mode=debug_mode,
            description="Prepares the daily executive briefing with context.",
        )
