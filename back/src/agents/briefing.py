from typing import Optional, List
from agno.agent import Agent
from agno.models.base import Model
from agno.knowledge import Knowledge
from agno.tools import Toolkit
from pydantic import BaseModel, Field

from src.tools.mock_productivity import MockProductivityTools

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

### PIPELINE STEPS:

1.  **DATA GATHERING**:
    - Call `get_upcoming_events` to see the day's schedule.
    - Call `get_recent_emails` to check for urgent communications.
    - Call `get_github_issues` to see high-priority tasks.

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
        knowledge: Optional[Knowledge] = None,
        debug_mode: bool = False,
    ):
        super().__init__(
            model=model,
            name="BriefingAgent",
            instructions=BRIEFING_INSTRUCTIONS,
            tools=[MockProductivityTools()],
            knowledge=knowledge,
            search_knowledge=(knowledge is not None),
            response_model=BriefingResponse,
            structured_outputs=True,
            debug_mode=debug_mode,
            description="Prepares the daily executive briefing with context.",
        )
