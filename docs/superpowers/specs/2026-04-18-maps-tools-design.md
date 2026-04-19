# Maps Tools — Design Spec

**Date:** 2026-04-18
**Scope:** Route building and place search for chat and planning modes via Apple Maps

---

## Context

Neither chat mode nor planning mode currently has access to map functionality. The planning workflow builds travel blocks between task locations but does not know the user's starting point, and neither mode can open Apple Maps or search for nearby places.

Goals:
1. Both modes can build routes → text response + "Open in Maps" button
2. Both modes can search nearby places → list + "Open in Maps" button per result
3. Planning workflow uses user's current location as route start point

---

## Architecture

### Data flow

```
Agent calls MapsTool
    → tool returns {"text": "...", "actions": [...]}
    → session sends tool_call frame (agent sees text result)
    → session detects "actions" key → sends actions frame to Go API
    → Go API forwards to mobile client
    → frontend renders ActionButton components
    → user taps → Linking.openURL("maps://...")
```

### File map

| File | Change |
|------|--------|
| `back/src/tools/maps.py` | New — `MapsTool` Toolkit |
| `back/src/agents/factory.py` | Register `MapsTool` for chat + planner agents |
| `back/src/server/redis_session.py` | Actions dispatch from tool result; pass `user_location` to workflow |
| `back/src/workflows/planning.py` | Accept `user_location` in session_state; RECON geocodes it as `__origin__` |
| `front/src/screens/chat/message/screen.tsx` | Add `open_maps` case to `handleActionPress` |

---

## Component Design

### `back/src/tools/maps.py`

New `MapsTool(Toolkit)` with two methods.

#### `open_route(stops: list[str], mode: str = "driving") -> str`

Builds an Apple Maps multi-stop URL and returns a JSON string.

- `stops`: list of address strings (1–10 items)
- `mode`: `"driving"` | `"walking"` | `"cycling"` (ignored by Apple Maps URL but included in text label)
- Encodes each stop with `encodeURIComponent`-equivalent (spaces → `+`), joins with `+to:`
- URL format: `maps://?daddr=stop1+to:stop2+to:stop3` (no `saddr` — Apple Maps uses current location)
- Returns:
```json
{
  "text": "Route: Surf Coffee → Технопарк → Магазин",
  "actions": [
    {"command": "open_maps", "label": "Открыть маршрут в Maps", "url": "maps://?daddr=Surf+Coffee+to:..."}
  ]
}
```

#### `search_places(query: str, near: str, radius_km: float = 3.0) -> str`

Searches Nominatim for places matching `query` near `near`.

- Geocodes `near` via ORS (`ors_client.geocode`) to get lat/lon
- Calls Nominatim `/search` with `q`, `viewbox` (bounding box from `near` + `radius_km`), `limit=5`, `format=json`
- Falls back to Nominatim without viewbox if ORS geocode fails
- Each result: name from `display_name` (first two comma-parts), address, approximate distance (haversine from `near` coords)
- Maps URL per result: `maps://?daddr=<encoded address>`
- Returns:
```json
{
  "text": "Ближайшие супермаркеты рядом с Технопарк, Москва:",
  "actions": [
    {"command": "open_maps", "label": "ВкусВилл · ул. Большая, 4 (400м)", "url": "maps://?daddr=..."},
    {"command": "open_maps", "label": "Перекрёсток · пр. Ленина, 12 (850м)", "url": "maps://?daddr=..."}
  ]
}
```
- If no results: returns `{"text": "Ничего не найдено по запросу «query» рядом с near.", "actions": []}`

---

### `back/src/agents/factory.py`

Add `MapsTool` registration alongside `PlanningTools`:

```python
from src.tools.maps import MapsTool

# In AgentFactory.build():
try:
    maps_tool = MapsTool()
    tools = list(tools) + [maps_tool]
    logger.info("[Factory] Added MapsTool")
except Exception as e:
    logger.warning("[Factory] Failed to add MapsTool: %s", e)
```

Registered unconditionally for all agent types (souper/chat and planner).

---

### `back/src/server/redis_session.py`

#### 1. Actions dispatch from tool results

After sending each `tool_call` frame, inspect the tool result for an `"actions"` key. The result string is `safe_tool.get("result")` — the value already set on the tool dict when the `tool_call` event is processed from the Agno event stream:

```python
# After the tool_call frame is sent:
try:
    result_data = json.loads(tool_result_str)
    if isinstance(result_data, dict) and result_data.get("actions"):
        await self._send_frame(make_data(
            self.next_id, Op.MESSAGE, msg_chat_id,
            {
                "type": "actions",
                "actions": result_data["actions"],
                "message_id": message_id,
            },
        ))
except (json.JSONDecodeError, TypeError, AttributeError):
    pass  # plain-text result, skip
```

Generic — not tied to `MapsTool`. Any future tool can emit action buttons the same way.

#### 2. Pass `user_location` to planning workflow

When building the planning workflow, include `user_location` in the initial session state:

```python
workflow = build_planning_workflow(
    session_id=self.session_id,
    session_state={
        "user_location": user_location,  # str | None, e.g. "Москва, Россия"
        # ... existing state keys
    },
    db=self.db,
)
```

---

### `back/src/workflows/planning.py`

#### RECON stage: geocode user's starting location

In `_run_recon_stage`, read `user_location` from the state and geocode it as `__origin__`:

```python
user_location = state.get("user_location")
if user_location:
    try:
        origin_coords = ors_client.geocode(user_location)
        locations["__origin__"] = {"coords": origin_coords, "hours": ""}
    except Exception:
        pass  # no origin — workflow continues without it
```

#### ROUTE stage: include origin → first cluster leg

In the route/travel-time calculation, if `__origin__` is present in locations, prepend a travel block from `__origin__` to the first cluster. This gives the user an estimated departure time and distance to the first stop.

---

### `front/src/screens/chat/message/screen.tsx`

Add `open_maps` to `handleActionPress`:

```tsx
import { Linking } from 'react-native';  // already imported in PlannerScreen; add here if missing

// In handleActionPress:
if (action?.command === 'open_maps' && action.url) {
    await Linking.openURL(action.url).catch(err =>
        console.warn('Failed to open Maps:', err)
    );
    return;
}
```

`ActionButton` rendering and styling require no changes — existing component handles the new command transparently.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| ORS geocode fails for `near` | `search_places` falls back to Nominatim without viewbox |
| Nominatim returns 0 results | Returns `{"text": "Ничего не найдено...", "actions": []}` |
| `open_maps` called with 0 stops | Tool returns error text, no actions sent |
| `user_location` not set / not shared | Workflow runs without `__origin__`; route starts from first cluster |
| `Linking.openURL` rejects | `.catch` logs warning; Maps not installed is extremely rare on iOS |

---

## Out of Scope

- Android Google Maps support (Maps URL scheme works on Android too, but not tested)
- Real-time traffic / ETA calculation (Apple Maps handles this natively)
- Saving/caching Nominatim results
- CI/CD integration
