# AFM Action Extractor — Design Spec

**Date:** 2026-04-20  
**Status:** Approved

## Problem

The Python agent explicitly calls `MapsTool` and emits `actions` frames when it decides an action is needed. But when the agent responds in plain text — mentioning an address, asking a yes/no question, or listing URLs — no buttons are rendered. Users must manually tap-to-copy or switch apps.

## Solution

After every assistant message finishes streaming, run a lightweight on-device pass using Apple Foundation Models (AFM) to detect actionable items in the text and inject them as tappable buttons using the existing `actions` UI.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| When to run | Always, after every streamed response | Simpler; server-emitted actions survive (merged, not overwritten) |
| What to detect | Open-ended — model decides | Extensible; no hardcoded list to maintain |
| Output contract | Same `{command, label, url}` as server actions | Reuses existing button UI with no new components |
| How AFM returns data | JSON array in `generateText` response, then `JSON.parse` | Mirrors `chatTitleGenerator.ts`; avoids structured-output API uncertainty |
| Platform | iOS only; Android returns `[]` | AFM not available on Android |

## Architecture

```
Message stream ends (op=done)
        │
        ├─► emitGenerationDone(chatId)          [existing]
        │
        └─► extractActions(lastAssistantText)   [NEW — fire-and-forget]
                │
                ▼
         AFM generateText(prompt)               [~1–3 s on-device]
                │
                ▼
         JSON.parse(result.text)
                │
                ▼
         MessageAction[]
                │
                ▼
         chatStore.appendActions(...)           [NEW store method]
                │
                ▼
         existing action buttons UI            [no UI changes needed]
```

## Files

| File | Change |
|---|---|
| `front/src/services/actionExtractor.ts` | **Create** — AFM inference service |
| `front/src/store/chatStore.ts` | **Modify** — add `appendActions` method |
| `front/src/screens/chat/context.tsx` | **Modify** — call `extractActions` in `subscribeGenerationDone` |
| `front/__tests__/actionExtractor.test.ts` | **Create** — unit tests |

## Service: `actionExtractor.ts`

Mirrors `chatTitleGenerator.ts` exactly in structure.

**Signature:**
```typescript
export async function extractActions(text: string): Promise<MessageAction[]>
```

**Prompt sent to AFM:**
```
You are an action extractor. Read the assistant message below and identify any
discrete actions the user could take — opening a map location, visiting a URL,
answering a yes/no question, confirming something, etc.

Return ONLY a JSON array. Each item must have:
  "command": short snake_case verb (e.g. "open_maps", "open_web", "poll_yes", "poll_no")
  "label":   short human-readable button label (≤ 30 chars)
  "url":     full URL or deep link (omit or use "" if not applicable)

If there are no actionable items, return an empty array: []

Do NOT return any explanation, markdown, or text outside the JSON array.

Message:
<message text>
```

**Input truncation:** message text is capped at 2 000 characters before being inserted into the prompt, preventing very long responses from overwhelming AFM or hitting token limits.

**Behaviour:**
- Timeout: 5 000 ms (same as title generator)
- Android: returns `[]` immediately, no AFM call
- JSON parse failure: returns `[]`
- Empty model output: returns `[]`
- All errors caught; never throws

**Type guard after parse:**
```typescript
function isValidAction(a: unknown): a is MessageAction {
    return (
        typeof (a as any)?.command === 'string' &&
        typeof (a as any)?.label === 'string'
    );
}
```

## Store: `appendActions`

Added to `chatStore.ts`. Merges AFM-extracted actions with any server-emitted actions already on the message (server actions are not overwritten).

```typescript
appendActions: (chatId: string, messageId: string, actions: MessageAction[]) => void
```

## Call site: `context.tsx`

Inside the `subscribeGenerationDone` effect, after `flushPendingUpdates`:

```typescript
const messages = useChatStore.getState().chats[chatId] || [];
const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
if (lastAssistant?.text) {
    extractActions(lastAssistant.text)
        .then(actions => {
            if (actions.length > 0) {
                useChatStore.getState().appendActions(chatId, lastAssistant.id, actions);
            }
        })
        .catch(() => {});
}
```

Fire-and-forget. Never blocks the UI transition (`setAssistantWorking(false)` fires immediately as before).

## Extensibility

New action types work automatically — the AFM prompt is open-ended and the model infers command names from context. To handle a new command in the UI (e.g., `poll_yes`/`poll_no`), only `handleActionPress` in `message/screen.tsx` needs updating. No changes to the extractor or prompt.

## Error Handling

| Scenario | Behaviour |
|---|---|
| Android | Returns `[]` immediately |
| AFM module not available | Caught, returns `[]` |
| Timeout (> 5 s) | Caught, returns `[]` |
| Model returns non-JSON | Caught, returns `[]` |
| Model returns JSON with invalid shape | Items filtered by type guard, remainder used |
| `appendActions` called with empty array | No-op (early return) |

## Testing

- `extractActions` with mocked `generateText` returning valid JSON → returns parsed actions
- `extractActions` with mocked `generateText` returning malformed JSON → returns `[]`
- `extractActions` with mocked `generateText` timing out → returns `[]`
- `extractActions` on Android (mocked `Platform.OS = 'android'`) → returns `[]`
- `appendActions` merges with existing actions (no overwrite)
- `appendActions` on unknown messageId → no-op (state unchanged)
