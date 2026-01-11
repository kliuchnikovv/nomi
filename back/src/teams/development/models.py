from typing import List, Literal, Optional
from pydantic import BaseModel, Field

class FunctionalRequirement(BaseModel):
    id: str = Field(
        ...,
        description="Уникальный код (напр., REQ-001). Используется для трассировки в коммитах."
    )
    title: str = Field(
        ...,
        description="Краткое техническое название требования."
    )
    description: str = Field(
        ...,
        description="Подробное описание: что именно должно происходить и какая бизнес-логика реализуется."
    )
    priority: Literal["P0", "P1", "P2", "P3"] = Field(
        "P1",
        description="P0: Блокирующее, P1: Критичное, P2: Важное, P3: Желательное."
    )

    # Ключевой блок для Jules и Reviewer
    acceptance_criteria: List[str] = Field(
        ...,
        description="Четкие проверяемые условия (напр., 'API возвращает 404, если ID не найден')."
    )

    # Помогаем Архитектору
    module_context: List[Literal["front", "back", "api", "infra"]] = Field(
        ...,
        description="На какие части системы влияет это конкретное требование."
    )

    is_breaking_change: bool = Field(
        False,
        description="Флаг, указывающий на изменение существующих контрактов или API."
    )

class UserScenario(BaseModel):
    scenario: str = Field(..., description="Описание пути пользователя (As a user I want to...)")
    acceptance_criteria: List[str] = Field(..., description="Список условий, при которых задача считается выполненной")

class AnalystOutput(BaseModel):
    project_id: str = Field(..., description="ID проекта из БД. Use 'unknown' if not clear from context.")
    task_id: str = Field(..., description="ID задачи в очереди (UUID). Use '00000000-0000-0000-0000-000000000000' if not applicable.")

    summary: str = Field(..., description="Высокоуровневое резюме того, что должно измениться")

    # Ключевые требования
    requirements: List[FunctionalRequirement]

    # Сценарии приемки (для будущего тестирования)
    scenarios: List[UserScenario]

    # Анализ контекста
    affected_modules: List[str] = Field(
        ..., description="Список модулей, которые затрагивает задача (front, back, api, infrastructure)"
    )
    relevant_rag_snippets: List[str] = Field(
        default_factory=list,
        description="Краткие выдержки из документации проекта, на которые опирался аналитик"
    )

    constraints: List[str] = Field(
        default_factory=list,
        description="Ограничения (например: 'не изменять API эндпоинты' или 'сохранить обратную совместимость')"
    )

class ArchitectPlanContext(BaseModel):
    repository_name: str = Field(..., description="Full repository name (e.g., 'owner/repo')")
    branch_name: str = Field(..., description="Target branch name for the feature")
    task_id: str = Field(..., description="UUID of the task in the database")

class ArchitectPlan(BaseModel):
    # Context
    project_id: str
    task_id: str

    # Decisions
    adr_title: str
    adr_decision: str
    adr_consequences: List[str]

    # Implementation Plan
    files_to_create: List[str]
    files_to_modify: List[str]

    technical_approach: str = Field(..., description="Detailed technical approach for the developer")

    # Validation
    verification_steps: List[str]
      
    context: ArchitectPlanContext = Field(..., description="Context identifiers for the task")

    steps: List[str] = Field(..., description="List of atomic implementation steps")
    style_guide_rules: List[str] = Field(..., description="Coding standards from AGENTS.md")
    reference_snippets: List[str] = Field(..., description="Relevant code snippets from the codebase")

class ReviewComment(BaseModel):
    file_path: str = Field(..., description="File path related to the comment")
    line_number: Optional[int] = Field(None, description="Line number for the comment")
    body: str = Field(..., description="The comment text")
    severity: Literal["critical", "warning", "info"] = Field("warning")

class ReviewVerdict(BaseModel):
    approved: bool = Field(..., description="Whether the changes are approved")
    summary: str = Field(..., description="Summary of the review")
    comments: List[ReviewComment] = Field(default_factory=list, description="List of specific comments")
    required_changes: List[str] = Field(default_factory=list, description="List of high-level required changes")

class FinalAcceptance(BaseModel):
    accepted: bool
    reason: str

class ArchitectureDecisionRecord(BaseModel):
    title: str = Field(..., description="Short name of the decision")
    status: Literal["Proposed", "Accepted", "Rejected", "Deprecated"] = Field("Proposed")
    context: str = Field(..., description="Why are we doing this?")
    decision: str = Field(..., description="What is the technical solution?")
    consequences: str = Field(..., description="Trade-offs")

class ImplementationStep(BaseModel):
    file_path: str = Field(..., description="Path to the file")
    description: str = Field(..., description="Description of changes")
    action: Literal["create", "modify", "delete"] = Field(..., description="Type of action")

class ArchitectOutput(BaseModel):
    context_analysis: str = Field(..., description="Analysis of affected components and constraints")
    adr: ArchitectureDecisionRecord = Field(..., description="Architecture Decision Record")
    implementation_plan: List[ImplementationStep] = Field(..., description="List of files and changes")
    definition_of_done: List[str] = Field(..., description="Checklist of required artifacts and tests")

class ReviewerInput(BaseModel):
    pr_diff: str = Field(..., description="The diff of the pull request")
    analyst_output: AnalystOutput = Field(..., description="The original requirements")
    architect_output: ArchitectOutput = Field(..., description="The architectural plan")
    file_list: List[str] = Field(..., description="List of files changed in PR")
