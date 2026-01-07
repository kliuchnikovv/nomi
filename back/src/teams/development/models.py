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
    task_id: int = Field(..., description="ID задачи в очереди. Use 0 if not applicable.")

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
