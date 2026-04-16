# Agno Reasoning: Three Approaches

Documentation on three approaches to reasoning in the Agno library.

---

## 1. Reasoning Models (Native Reasoning)

**When to use:** The model has built-in reasoning (Gemini 2.5+, o1, DeepSeek R1)

**MODEL-level parameters:**
```python
from agno.models.google import Gemini

# Gemini 2.5+ native thinking
model = Gemini(
    id="gemini-2.5-pro",
    thinking_budget=1024,      # Number of tokens for "thinking"
    include_thoughts=True      # Include thoughts in output
)

# Gemini 3+ alternative
model = Gemini(
    id="gemini-3-pro-preview",
    thinking_level="low"       # "low" or "high"
)
```

**Compatibility:** ✅ Function calling works

---

## 2. Reasoning Tools (ReasoningTools toolkit)

**When to use:** Add reasoning to regular models (GPT-4o, Claude 3.5)

**AGENT tools-level parameters:**
```python
from agno.tools.reasoning import ReasoningTools

agent = Agent(
    model=Claude(id="claude-3-5-sonnet-20241022"),
    tools=[
        ReasoningTools(add_instructions=True),  # Adds think() and analyze()
    ],
)

agent.print_response("...", show_full_reasoning=True)
```

**Compatibility:** ✅ Function calling works (tools = functions)

---

## 3. Reasoning Agents (Manual Chain-of-Thought)

**When to use:** ⚠️ CAUTION - may conflict with function calling!

**AGENT/TEAM-level parameters:**
```python
agent = Agent(
    model=model,
    reasoning=True,              # Enables manual CoT
    reasoning_min_steps=1,
    reasoning_max_steps=5,
)
```

**Compatibility:** ❌ NOT compatible with Gemini function calling!
- Uses `response_mime_type="application/json"` 
- Causes error: "Function calling with a response mime type: 'application/json' is unsupported"

---

## Recommendations for DnD Team

| Model | Recommended Approach |
|--------|---------------------|
| Gemini 2.5 Pro/Flash | `Gemini(thinking_budget=1024, include_thoughts=True)` at MODEL level |
| Gemini 3.x | `Gemini(thinking_level="low")` at MODEL level |
| Gemini 2.0 | No reasoning OR `ReasoningTools` |
| GPT-4o, Claude | `ReasoningTools(add_instructions=True)` in tools |

**Never use `reasoning=True` on Agent/Team with Gemini + function calling!**
