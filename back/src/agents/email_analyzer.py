# """
# Email Analyzer Agent
# Analyzes emails to extract urgency, connections, time frames, and suggested actions.
# """
# import json
# from typing import List, Optional, Any
# from agno.agent import Agent
# from agno.models.base import Model
# from pydantic import BaseModel, Field
#
#
# class SuggestedAction(BaseModel):
#     """A suggested action for an email."""
#     action_type: str = Field(..., description="Action type: 'reply', 'forward', 'schedule', 'delegate', 'archive', 'followup'")
#     label: str = Field(..., description="Human-readable action label in the user's language")
#     params: dict = Field(default_factory=dict, description="Parameters for action execution")
#
#
# class EmailAnalysisResponse(BaseModel):
#     """Response from email analysis."""
#     urgency: str = Field("normal", description="Urgency level: 'asap', 'high', 'normal', 'low'")
#     connections: List[str] = Field(default_factory=list, description="Related people, projects, or topics")
#     time_frame: Optional[str] = Field(None, description="Deadline or time reference (ISO date if applicable)")
#     target_date: Optional[str] = Field(None, description="The specific date (YYYY-MM-DD) this email is relevant for or should be acted upon.")
#     suggested_actions: List[SuggestedAction] = Field(default_factory=list, description="2-5 suggested actions")
#
#
# EMAIL_ANALYZER_INSTRUCTIONS = """You are an email analysis agent. Your task is to analyze emails and extract structured information.
#
# ### OUTPUT FORMAT
# Return a valid JSON object according to this schema:
# {json_schema}
#
# Do NOT include markdown blocks (```json ... ```). Return ONLY raw JSON.
#
# ### ANALYSIS RULES
#
# #### 1. URGENCY
# Determine the urgency level:
# - **asap**: Requires immediate action. Keywords: "urgent", "ASAP", "immediately", "today by EOD", "critical", "blocker", "production down"
# - **high**: Important but not critical. Keywords: "important", "priority", "deadline tomorrow", "by end of week"
# - **normal**: Regular correspondence without explicit urgency
# - **low**: Informational emails, newsletters, automated notifications
#
# #### 2. CONNECTIONS
# Extract:
# - Names of people mentioned in the email (excluding the sender)
# - Project, product, or team names
# - Key topics/themes
#
# #### 3. TIME FRAME & TARGET DATE
# - **time_frame**: Text description of the deadline (e.g. "Tomorrow 5pm", "Next Friday").
# - **target_date**: The specific calendar date (YYYY-MM-DD) when this item should appear in the user's briefing.
#   - If the email says "can you do this by Friday?", target_date is this Friday's date.
#   - If it's for a meeting on date X, target_date is X.
#   - If it's just general info, target_date is null.
#   - If "ASAP" or "Today", target_date is {current_date}.
#
# #### 4. SUGGESTED ACTIONS
# Suggest 2-5 actions. Action types:
# - **reply**: Reply to the email. params: {{"suggested_text": "short reply text"}}
# - **forward**: Forward to a colleague. params: {{"reason": "why to forward"}}
# - **schedule**: Create an event/reminder. params: {{"title": "title", "date": "ISO date"}}
# - **delegate**: Delegate the task. params: {{"to": "whom", "task": "what to do"}}
# - **archive**: Archive (low priority). params: {{}}
# - **followup**: Schedule a follow-up. params: {{"date": "ISO date", "reason": "reason"}}
#
# ### EXAMPLES
#
# **Email**: "Urgent! Need the Alpha project report by end of day. John is waiting."
# **Analysis**:
# ```
# {
#   "urgency": "asap",
#   "connections": ["John", "Alpha project"],
#   "time_frame": "{current_date}T23:59:00",
#   "target_date": "{current_date}",
#   "suggested_actions": [
#     {"action_type": "reply", "label": "Acknowledge receipt", "params": {"suggested_text": "Received, report will be ready by EOD"}},
#     {"action_type": "schedule", "label": "Set reminder", "params": {"title": "Alpha report for John", "date": "{current_date}T17:00:00"}},
#     {"action_type": "delegate", "label": "Delegate data collection", "params": {"to": "team", "task": "gather metrics for report"}}
#   ]
# }
# ```
#
# **Email**: "Can we meet next Monday regarding the budget?"
# **Analysis** (assuming today is {current_date}):
# ```
# {
#   "urgency": "normal",
#   "connections": ["Budget"],
#   "time_frame": "Next Monday",
#   "target_date": "<next Monday's date in YYYY-MM-DD>",
#   "suggested_actions": [
#     {"action_type": "reply", "label": "Reply to schedule", "params": {"suggested_text": "Sure, what time works for you?"}}
#   ]
# }
# ```
#
# **Email**: "Newsletter: Company news for January"
# **Analysis**:
# ```
# {
#   "urgency": "low",
#   "connections": [],
#   "time_frame": null,
#   "target_date": null,
#   "suggested_actions": [
#     {"action_type": "archive", "label": "Archive", "params": {}}
#   ]
# }
# ```
# """
#
#
# class EmailAnalyzerAgent(Agent):
#     """Agent for analyzing emails to extract urgency, connections, and suggested actions."""
#
#     def __init__(
#         self,
#         model: Model,
#         db: Optional[Any] = None,
#         debug_mode: bool = False,
#         user_id: Optional[str] = None,
#         learning: bool = False,
#     ):
#         from datetime import datetime
#         current_date = datetime.now().strftime("%Y-%m-%d")
#
#         # Inject schema and current date into instructions
#         schema = json.dumps(EmailAnalysisResponse.model_json_schema(), indent=2)
#         instructions = EMAIL_ANALYZER_INSTRUCTIONS.replace("{json_schema}", schema)
#         instructions = instructions.replace("{current_date}", current_date)
#
#         super().__init__(
#             db=db,
#             model=model,
#             name="EmailAnalyzerAgent",
#             instructions=instructions,
#             debug_mode=debug_mode,
#             user_id=user_id,
#             learning=learning,
#             description="Analyzes emails to extract urgency, connections, time frames, and suggested actions.",
#         )
