"""Pydantic models for the Day Planner workflow."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class PlanTask(BaseModel):
    id: str
    title: str
    location: Optional[str] = None
    duration_min: Optional[int] = None
    notes: Optional[str] = None


class PlanBlock(BaseModel):
    id: str
    title: str
    start: str  # "HH:MM"
    end: str  # "HH:MM"
    duration_min: int
    location: Optional[str] = None
    travel_before_min: int = 0
    type: Literal["task", "travel", "buffer", "break"] = "task"
    task_id: Optional[str] = None
    notes: Optional[str] = None


class PlanStatus:
    GATHERING = "gathering"
    BUILDING = "building"
    REVIEW = "review"
    COMMITTED = "committed"
    REPLANNING = "replanning"


class DayPlan(BaseModel):
    id: str
    chat_id: str
    planning_date: str
    tasks: list[PlanTask] = Field(default_factory=list)
    blocks: list[PlanBlock] = Field(default_factory=list)
    reminders_ids: list[str] = Field(default_factory=list)
    status: str = "gathering"


class PlanningInput(BaseModel):
    user_message: str
    chat_id: str
    user_id: str
    planning_date: str
    tasks: list[PlanTask] = Field(default_factory=list)
    session_state: dict = Field(default_factory=dict)
    timezone: str = "UTC"
