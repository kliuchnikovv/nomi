"""
Email Analyzer Agent
Analyzes emails to extract urgency, connections, time frames, and suggested actions.
"""
import json
from typing import List, Optional
from agno.agent import Agent
from agno.models.base import Model
from pydantic import BaseModel, Field


class SuggestedAction(BaseModel):
    """A suggested action for an email."""
    action_type: str = Field(..., description="Action type: 'reply', 'forward', 'schedule', 'delegate', 'archive', 'followup'")
    label: str = Field(..., description="Human-readable action label in English")
    params: dict = Field(default_factory=dict, description="Parameters for action execution")


class EmailAnalysisResponse(BaseModel):
    """Response from email analysis."""
    urgency: str = Field("normal", description="Urgency level: 'asap', 'high', 'normal', 'low'")
    connections: List[str] = Field(default_factory=list, description="Related people, projects, or topics")
    time_frame: Optional[str] = Field(None, description="Deadline or time reference (ISO date if applicable)")
    suggested_actions: List[SuggestedAction] = Field(default_factory=list, description="2-5 suggested actions")


EMAIL_ANALYZER_INSTRUCTIONS = """You are an email analysis agent. Your task is to analyze emails and extract structured information.

### OUTPUT FORMAT
Return a valid JSON object according to this schema:
{json_schema}

Do NOT include markdown blocks (```json ... ```). Return ONLY raw JSON.

### ANALYSIS RULES

#### 1. URGENCY
Determine the urgency level:
- **asap**: Requires immediate action. Keywords: "urgent", "ASAP", "immediately", "today by EOD", "critical", "blocker", "production down"
- **high**: Important but not critical. Keywords: "important", "priority", "deadline tomorrow", "by end of week"
- **normal**: Regular correspondence without explicit urgency
- **low**: Informational emails, newsletters, automated notifications

#### 2. CONNECTIONS
Extract:
- Names of people mentioned in the email (excluding the sender)
- Project, product, or team names
- Key topics/themes

#### 3. TIME FRAME
If the email mentions:
- A specific date/time → return in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
- "tomorrow", "on Friday", "next week" → calculate relative to current date: {current_date}
- No deadline → null

#### 4. SUGGESTED ACTIONS
Suggest 2-5 actions. Action types:
- **reply**: Reply to the email. params: {{"suggested_text": "short reply text"}}
- **forward**: Forward to a colleague. params: {{"reason": "why to forward"}}
- **schedule**: Create an event/reminder. params: {{"title": "title", "date": "ISO date"}}
- **delegate**: Delegate the task. params: {{"to": "whom", "task": "what to do"}}
- **archive**: Archive (low priority). params: {{}}
- **followup**: Schedule a follow-up. params: {{"date": "ISO date", "reason": "reason"}}

### EXAMPLES

**Email**: "Urgent! Need the Alpha project report by end of day. John is waiting."
**Analysis**:
```
{
  "urgency": "asap",
  "connections": ["John", "Alpha project"],
  "time_frame": "{current_date}T23:59:00",
  "suggested_actions": [
    {"action_type": "reply", "label": "Acknowledge receipt", "params": {"suggested_text": "Received, report will be ready by EOD"}},
    {"action_type": "schedule", "label": "Set reminder", "params": {"title": "Alpha report for John", "date": "{current_date}T17:00:00"}},
    {"action_type": "delegate", "label": "Delegate data collection", "params": {"to": "team", "task": "gather metrics for report"}}
  ]
}
```

**Email**: "Newsletter: Company news for January"
**Analysis**:
```
{
  "urgency": "low",
  "connections": [],
  "time_frame": null,
  "suggested_actions": [
    {"action_type": "archive", "label": "Archive", "params": {}}
  ]
}
```
"""


class EmailAnalyzerAgent(Agent):
    """Agent for analyzing emails to extract urgency, connections, and suggested actions."""
    
    def __init__(
        self,
        model: Model,
        debug_mode: bool = False,
    ):
        from datetime import datetime
        current_date = datetime.now().strftime("%Y-%m-%d")
        
        # Inject schema and current date into instructions
        schema = json.dumps(EmailAnalysisResponse.model_json_schema(), indent=2)
        instructions = EMAIL_ANALYZER_INSTRUCTIONS.replace("{json_schema}", schema)
        instructions = instructions.replace("{current_date}", current_date)
        
        super().__init__(
            model=model,
            name="EmailAnalyzerAgent",
            instructions=instructions,
            debug_mode=debug_mode,
            description="Analyzes emails to extract urgency, connections, time frames, and suggested actions.",
        )
