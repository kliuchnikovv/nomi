# Task 14 Report: `plan.build` command + PlanBuildScreen

## Actual `build_planning_workflow` signature (planning.py:783)

```python
def build_planning_workflow(
    session_id: str,
    session_state: dict | None = None,
    db: Any | None = None,
) -> Workflow:
```

The brief's template assumed kwargs `user_id` and `tools_config` — neither exists. The workflow takes only `session_id` and optional `session_state`.

## How `_run_workflow` was adapted

The real call site (`redis_session.py:606`) shows:
1. Build `session_state` dict with `planning_date` and other context
2. Call `build_planning_workflow(session_id=..., session_state=...)`
3. Build a `WorkflowExecutionInput(input=user_message, additional_data={"planning_input": PlanningInput(...)})`
4. Iterate `_planning_steps(workflow, execution_input)` synchronously (it's a sync generator, not async)
5. After iteration, read result from `workflow.session_state`

`_run_workflow` in `plan_build.py` replicates this exactly, wrapping the sync iteration in `asyncio.to_thread`. The brief's `on_stage` callback was omitted — `_planning_steps` does not accept such a parameter.

## Test results

```
27 passed in 0.55s
```

Both new tests pass:
- `test_plan_build_invokes_workflow` — monkeypatches `_run_workflow`, verifies `result.ok` and `result.data["document"] == "PLAN!"`
- `test_plan_build_args_validation` — verifies `PlanBuildArgs(date="bad", ...)` raises `ValidationError`

Required the `_reset_and_load()` pattern (matching `test_memory_note.py`) to clear `_loaded` flag and re-import module between tests.

## TypeScript type-check

No new errors introduced. Pre-existing errors in `FlashMessageList.tsx`, `SoupAnimation.tsx`, and `markdownRules.tsx` remain unchanged.

## Deviations from brief

1. **`build_planning_workflow` signature**: brief assumed `user_id` + `tools_config` kwargs — actual signature uses `session_id` + `session_state`.
2. **`arun` call**: brief assumed `workflow.arun(date=..., freeform=..., on_stage=...)` — actual pattern is sync iteration of `_planning_steps` generator, no `arun` method exists.
3. **`CommandScreen` route**: brief did not mention registering the `CommandScreen` navigation route, but the input component already had `navigation.navigate('CommandScreen' as any, ...)`. Added `CommandScreen` to `ChatStackParamList`, registered it in `ChatStack.tsx`, and created `front/src/screens/chat/CommandScreen.tsx` as the route wrapper.
4. **`CommandScreenProps` mismatch**: brief showed `runCommand` + `onClose` props; actual interface has `onResult` + `onCancel`. `PlanBuildScreen` uses `useChat().runCommand` directly.
