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
    label: str = Field(..., description="Human-readable action label in Russian")
    params: dict = Field(default_factory=dict, description="Parameters for action execution")


class EmailAnalysisResponse(BaseModel):
    """Response from email analysis."""
    urgency: str = Field("normal", description="Urgency level: 'asap', 'high', 'normal', 'low'")
    connections: List[str] = Field(default_factory=list, description="Related people, projects, or topics")
    time_frame: Optional[str] = Field(None, description="Deadline or time reference (ISO date if applicable)")
    suggested_actions: List[SuggestedAction] = Field(default_factory=list, description="2-5 suggested actions")


EMAIL_ANALYZER_INSTRUCTIONS = """Ты — агент анализа email. Твоя задача — проанализировать письмо и извлечь структурированную информацию.

### ФОРМАТ ВЫВОДА
Верни валидный JSON объект по схеме:
{json_schema}

Не включай markdown-блоки (```json ... ```). Возвращай ТОЛЬКО чистый JSON.

### ПРАВИЛА АНАЛИЗА

#### 1. СРОЧНОСТЬ (urgency)
Определи уровень срочности:
- **asap**: Требует немедленного действия. Ключевые слова: "срочно", "ASAP", "urgent", "немедленно", "сегодня до EOD", "critical", "блокер", "production down"
- **high**: Важно, но не критично. Ключевые слова: "важно", "приоритет", "deadline завтра", "до конца недели" 
- **normal**: Обычная переписка без явной срочности
- **low**: Информационные письма, рассылки, автоматические уведомления

#### 2. СВЯЗИ (connections)
Извлеки:
- Имена людей, упомянутых в письме (кроме отправителя)
- Названия проектов, продуктов, команд
- Ключевые темы/топики

#### 3. ВРЕМЕННЫЕ РАМКИ (time_frame)
Если в письме упоминается:
- Конкретная дата/время → верни в ISO формате (YYYY-MM-DD или YYYY-MM-DDTHH:MM:SS)
- "завтра", "в пятницу", "на следующей неделе" → рассчитай относительно текущей даты: {current_date}
- Нет дедлайна → null

#### 4. ПРЕДЛАГАЕМЫЕ ДЕЙСТВИЯ (suggested_actions)
Предложи 2-5 действий. Типы действий:
- **reply**: Ответить на письмо. params: {{"suggested_text": "краткий текст ответа"}}
- **forward**: Переслать коллеге. params: {{"reason": "почему переслать"}}
- **schedule**: Создать событие/напоминание. params: {{"title": "название", "date": "ISO date"}}
- **delegate**: Делегировать задачу. params: {{"to": "кому", "task": "что сделать"}}
- **archive**: Архивировать (низкий приоритет). params: {{}}
- **followup**: Запланировать follow-up. params: {{"date": "ISO date", "reason": "причина"}}

### ПРИМЕРЫ

**Письмо**: "Срочно! Нужен отчёт по проекту Alpha до конца дня. John ждёт."
**Анализ**:
```
{
  "urgency": "asap",
  "connections": ["John", "проект Alpha"],
  "time_frame": "{current_date}T23:59:00",
  "suggested_actions": [
    {"action_type": "reply", "label": "Подтвердить получение", "params": {"suggested_text": "Принял, отчёт будет готов до EOD"}},
    {"action_type": "schedule", "label": "Создать напоминание", "params": {"title": "Отчёт Alpha для John", "date": "{current_date}T17:00:00"}},
    {"action_type": "delegate", "label": "Делегировать сбор данных", "params": {"to": "команда", "task": "собрать метрики для отчёта"}}
  ]
}
```

**Письмо**: "Newsletter: Новости компании за январь"
**Анализ**:
```
{
  "urgency": "low",
  "connections": [],
  "time_frame": null,
  "suggested_actions": [
    {"action_type": "archive", "label": "Архивировать", "params": {}}
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
