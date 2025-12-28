# Agno Reasoning: Three Approaches

Документация по трём подходам к reasoning в библиотеке Agno.

---

## 1. Reasoning Models (Нативное reasoning)

**Когда использовать:** Модель имеет встроенное reasoning (Gemini 2.5+, o1, DeepSeek R1)

**Параметры на уровне MODEL:**
```python
from agno.models.google import Gemini

# Gemini 2.5+ native thinking
model = Gemini(
    id="gemini-2.5-pro",
    thinking_budget=1024,      # Количество токенов для "мышления"
    include_thoughts=True      # Включать мысли в вывод
)

# Gemini 3+ alternative
model = Gemini(
    id="gemini-3-pro-preview",
    thinking_level="low"       # "low" или "high"
)
```

**Совместимость:** ✅ Function calling работает

---

## 2. Reasoning Tools (ReasoningTools toolkit)

**Когда использовать:** Добавить reasoning к обычным моделям (GPT-4o, Claude 3.5)

**Параметры на уровне AGENT tools:**
```python
from agno.tools.reasoning import ReasoningTools

agent = Agent(
    model=Claude(id="claude-3-5-sonnet-20241022"),
    tools=[
        ReasoningTools(add_instructions=True),  # Добавляет think() и analyze()
    ],
)

agent.print_response("...", show_full_reasoning=True)
```

**Совместимость:** ✅ Function calling работает (инструменты = функции)

---

## 3. Reasoning Agents (Manual Chain-of-Thought)

**Когда использовать:** ⚠️ ОСТОРОЖНО - может конфликтовать с function calling!

**Параметры на уровне AGENT/TEAM:**
```python
agent = Agent(
    model=model,
    reasoning=True,              # Включает manual CoT
    reasoning_min_steps=1,
    reasoning_max_steps=5,
)
```

**Совместимость:** ❌ НЕ совместимо с Gemini function calling!
- Использует `response_mime_type="application/json"` 
- Вызывает ошибку: "Function calling with a response mime type: 'application/json' is unsupported"

---

## Рекомендации для DnD Team

| Модель | Рекомендуемый подход |
|--------|---------------------|
| Gemini 2.5 Pro/Flash | `Gemini(thinking_budget=1024, include_thoughts=True)` на MODEL |
| Gemini 3.x | `Gemini(thinking_level="low")` на MODEL |
| Gemini 2.0 | Без reasoning ИЛИ `ReasoningTools` |
| GPT-4o, Claude | `ReasoningTools(add_instructions=True)` в tools |

**Никогда не используйте `reasoning=True` на Agent/Team с Gemini + function calling!**
