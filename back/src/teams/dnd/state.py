from typing import List, Dict, Optional, Any
from pydantic import BaseModel, Field

class Character(BaseModel):
    name: str
    char_class: str
    level: int
    stats: Dict[str, int]
    features: List[str] = Field(default_factory=list)
    hp_current: int
    hp_max: int
    inventory: List[Dict[str, Any]] = Field(default_factory=list)

class PartyState(BaseModel):
    characters: Dict[str, Character] = Field(default_factory=dict)
    resources: Dict[str, Any] = Field(default_factory=dict)
    quests: List[str] = Field(default_factory=list)

class Entity(BaseModel):
    name: str
    type: str # "enemy", "npc", "object"
    hp: int
    max_hp: int
    ac: int
    initiative: int = 0
    position: Optional[Dict[str, int]] = None

class SceneState(BaseModel):
    location: str
    description: str
    entities: List[Entity] = Field(default_factory=list)
    turn_order: List[str] = Field(default_factory=list)
    current_turn_index: int = 0
    active: bool = False

class WorldState(BaseModel):
    name: str
    regions: List[str] = Field(default_factory=list)
    calendar: str = "Day 1"
    facts: List[str] = Field(default_factory=list)
