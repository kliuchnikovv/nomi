from typing import List, Literal, Optional, Dict, Any
from pydantic import BaseModel, Field

# --- Shared Action Model ---
class AgentAction(BaseModel):
    tool: str = Field(..., description="Название инструмента (например, 'github', 'jira').")
    method: str = Field(..., description="Метод для вызова.")
    params: Dict[str, Any] = Field(default_factory=dict, description="Параметры вызова.")
    description: str = Field(..., description="Текст на кнопке (например, 'Создать задачу').")

# --- ANALYST ---
class FunctionalRequirement(BaseModel):
    id: str = Field(..., description="Уникальный код (напр., REQ-001).")
    title: str = Field(..., description="Краткое название.")
    description: str = Field(..., description="Подробное описание бизнес-логики.")
    priority: Literal["P0", "P1", "P2", "P3"] = Field("P1")
    acceptance_criteria: List[str] = Field(..., description="Критерии приемки.")
    module_context: List[Literal["front", "back", "api", "infra"]] = Field(...)
    is_breaking_change: bool = Field(False)

class UserScenario(BaseModel):
    scenario: str = Field(..., description="User Story (As a user...)")
    acceptance_criteria: List[str] = Field(...)

class AnalystDetails(BaseModel):
    project_id: str = Field(..., description="ID проекта.")
    task_id: str = Field(..., description="ID задачи.")
    summary: str = Field(..., description="Резюме изменений.")
    requirements: List[FunctionalRequirement]
    scenarios: List[UserScenario]
    affected_modules: List[str] = Field(..., description="Затронутые модули.")
    relevant_rag_snippets: List[str] = Field(default_factory=list)
    constraints: List[str] = Field(default_factory=list)

class AnalystOutput(BaseModel):
    msg: str = Field(..., description="Краткое сообщение для пользователя.")
    content: AnalystDetails = Field(..., description="Детальный анализ требований.")
    actions: List[AgentAction] = Field(default_factory=list, description="Предлагаемые действия (кнопки).")

# --- ARCHITECT ---
class ArchitectPlanContext(BaseModel):
    repository_name: str = Field(...)
    branch_name: str = Field(...)
    task_id: str = Field(...)

class ArchitectureDecisionRecord(BaseModel):
    title: str = Field(...)
    status: Literal["Proposed", "Accepted", "Rejected", "Deprecated"] = Field("Proposed")
    context: str = Field(...)
    decision: str = Field(...)
    consequences: str = Field(...) 

class ImplementationStep(BaseModel):
    file_path: str = Field(...)
    description: str = Field(...)
    action: Literal["create", "modify", "delete"] = Field(...)
    status: Literal["pending", "in_progress", "completed", "failed"] = Field("pending")
    logs: Optional[str] = Field(None)

class ArchitectDetails(BaseModel):
    project_id: str
    task_id: str
    adr: ArchitectureDecisionRecord = Field(..., description="ADR запись.")
    technical_approach: str = Field(..., description="Технический подход.")
    files_to_create: List[str]
    files_to_modify: List[str]
    verification_steps: List[str]
    context: ArchitectPlanContext = Field(...)
    steps: List[ImplementationStep] = Field(..., description="Список шагов реализации.")
    style_guide_rules: List[str] = Field(...)
    reference_snippets: List[str] = Field(...)
    complexity: Literal["low", "high"] = Field(..., description="Complexity of the task")
    reasoning: str = Field(..., description="Reasoning for the complexity")

class ArchitectPlan(BaseModel):
    msg: str = Field(..., description="Краткое сообщение (напр., 'План готов').")
    content: ArchitectDetails = Field(..., description="Детальный архитектурный план.")
    actions: List[AgentAction] = Field(default_factory=list)

# --- REVIEWER ---
class ReviewComment(BaseModel):
    file_path: str = Field(...)
    line_number: Optional[int] = Field(None)
    body: str = Field(...)
    severity: Literal["critical", "warning", "info"] = Field("warning")

class ReviewDetails(BaseModel):
    approved: bool = Field(..., description="Одобрено ли.")
    summary: str = Field(..., description="Резюме ревью.")
    comments: List[ReviewComment] = Field(default_factory=list)
    required_changes: List[str] = Field(default_factory=list)

class ReviewVerdict(BaseModel):
    msg: str = Field(..., description="Краткое сообщение (напр., 'Требуются правки').")
    content: ReviewDetails = Field(..., description="Детальный вердикт.")
    actions: List[AgentAction] = Field(default_factory=list)

# --- VERIFIER ---
class FinalAcceptanceDetails(BaseModel):
    accepted: bool
    reason: str

class FinalAcceptance(BaseModel):
    msg: str = Field(...)
    content: FinalAcceptanceDetails = Field(...)
    actions: List[AgentAction] = Field(default_factory=list)

class ArchitectOutput(BaseModel): # Kept for potential backward compatibility or internal use if needed, but ArchitectDetails covers it
    context_analysis: str = Field(..., description="Analysis of affected components and constraints")
    adr: ArchitectureDecisionRecord = Field(..., description="Architecture Decision Record")
    implementation_plan: List[ImplementationStep] = Field(..., description="List of files and changes")
    definition_of_done: List[str] = Field(..., description="Checklist of required artifacts and tests")

class ReviewerInput(BaseModel):
    pr_diff: str = Field(..., description="The diff of the pull request")
    analyst_output: AnalystOutput = Field(..., description="The original requirements")
    architect_output: ArchitectOutput = Field(..., description="The architectural plan")
    file_list: List[str] = Field(..., description="List of files changed in PR")


# --- PR OUTPUT (Unified) ---
class PRCreatedOutput(BaseModel):
    """Unified output from both Git-Developer and Jules-Manager"""
    msg: str = Field(..., description="Status message (e.g., 'PR created successfully')")
    pr_url: str = Field(..., description="URL of created Pull Request")
    source: Literal["git_agent", "jules"] = Field(..., description="Which agent created the PR")
    branch_name: str = Field(..., description="Name of the feature branch")


# --- REVIEWER INPUT V2 (Unified) ---
class ReviewerInputV2(BaseModel):
    """Unified input for Reviewer agent"""
    pr_url: str = Field(..., description="URL of Pull Request to review")
    original_prd: str = Field(..., description="Original PRD requirements for verification")

