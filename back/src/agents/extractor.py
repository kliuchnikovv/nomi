import json
from typing import List, Optional
from agno.agent import Agent
from agno.models.base import Model
from pydantic import BaseModel, Field

# --- Extraction Models ---

class EventItem(BaseModel):
    title: str = Field(..., description="Title of the event")
    start_date: str = Field(..., description="ISO 8601 start date time (YYYY-MM-DDTHH:MM:SS)")
    end_date: Optional[str] = Field(None, description="ISO 8601 end date time")
    location: Optional[str] = Field(None, description="Event location or virtual link")
    status: str = Field("confirmed", description="'confirmed', 'tentative', 'cancelled'")

class TaskItem(BaseModel):
    title: str = Field(..., description="Actionable task title")
    due_date: Optional[str] = Field(None, description="ISO 8601 due date")
    priority: str = Field("normal", description="'critical', 'high', 'normal', 'low'")

class ExtractionResponse(BaseModel):
    events: List[EventItem] = Field(default_factory=list, description="Extracted calendar events")
    tasks: List[TaskItem] = Field(default_factory=list, description="Extracted actionable tasks")

# --- Agent Instructions ---

EXTRACTION_INSTRUCTIONS = """You are an entity extraction engine. Your goal is to extract structured Dates, Events, and Tasks from the provided text (email, document, or message).

### OUTPUT SCHEMA
You must return a valid JSON object matching:
{json_schema}

### EXTRACTION RULES

1. **Events**:
   - Extract ANY mention of a specific time and date for a meeting, call, or appointment.
   - Infer the date based on context (e.g., "Tomorrow at 2pm"). Assume today is {current_date} if not specified otherwise.
   - Normalize dates to ISO 8601.

2. **Tasks**:
   - Extract actionable items requested of the user.
   - "Can you send the report?" -> Task: "Send report"
   - "I need this by Friday" -> Task: "..." Due: Next Friday.
   - Assign priority based on urgency words ("ASAP", "Urgent" -> critical).

3. **Ignore**:
   - General chatter ("How are you?").
   - Past events ("We met yesterday").
   - Informational text without action.

4. **Empty**:
   - If no events or tasks, return empty lists.
"""

class ExtractionAgent(Agent):
    def __init__(
        self,
        model: Model,
        debug_mode: bool = False,
    ):
        # Inject schema
        schema = json.dumps(ExtractionResponse.model_json_schema(), indent=2)
        instructions = EXTRACTION_INSTRUCTIONS.replace("{json_schema}", schema)
        
        super().__init__(
            model=model,
            name="ExtractionAgent",
            instructions=instructions,
            debug_mode=debug_mode,
            description="Extracts structured Events and Tasks from text.",
        )
