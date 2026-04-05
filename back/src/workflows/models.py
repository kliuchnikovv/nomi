from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class PlanStatus(str, Enum):
    EXTRACT    = "extract"
    RECON      = "recon"
    CLUSTER    = "cluster"
    ROUTE      = "route"
    BUILD      = "build"
    REVIEW     = "review"
    ITERATE    = "iterate"
    CLARIFYING = "_clarifying"  # internal pseudo-status, not persisted long-term


@dataclass
class StageResult:
    output: dict[str, Any]
    pending_questions: list[str] = field(default_factory=list)
    is_complete: bool = True


@dataclass
class Cluster:
    location: str
    context_type: str  # "home" | "hotel" | "place" | "transit" | "none"
    coords: tuple[float, float] | None = None
    task_ids: list[str] = field(default_factory=list)


@dataclass
class TravelBlock:
    from_location: str
    to_location: str
    duration_min: int
    mode: str  # "foot-walking" | "driving-car" | "cycling-regular"
    title: str
    insert_before_cluster_index: int  # index of destination cluster in clusters list


class PlanTask(BaseModel):
    id: str
    title: str
    location: str | None = None
    duration_min: int | None = None
    notes: str | None = None


class PlanningInput(BaseModel):
    user_message: str
    chat_id: str
    user_id: str
    planning_date: str
    tasks: list[PlanTask] = Field(default_factory=list)
    session_state: dict[str, Any] = Field(default_factory=dict)
    timezone: str = "UTC"
