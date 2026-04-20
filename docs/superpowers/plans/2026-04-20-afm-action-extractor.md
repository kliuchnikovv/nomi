# AFM Action Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every assistant message finishes streaming, run Apple Foundation Models on-device to detect actionable items (maps, URLs, yes/no questions, etc.) in the text and inject them as tappable buttons using the existing actions UI.

**Architecture:** A new `actionExtractor.ts` service mirrors the existing `chatTitleGenerator.ts` pattern — iOS-only, `generateText` + JSON parse, 5 s timeout, returns `[]` on Android/error. The `chatStore` gains an `appendActions` method that merges AFM-extracted actions with any server-emitted ones. The call site is the `subscribeGenerationDone` effect in `context.tsx`, fired fire-and-forget after each stream completes.

**Tech Stack:** React Native, TypeScript, `@react-native-ai/apple`, Vercel AI SDK (`ai` package), Zustand (`front/src/store/chatStore.ts`), Jest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `front/src/services/actionExtractor.ts` | Create | AFM inference — prompt, parse, type-guard, timeout |
| `front/__tests__/actionExtractor.test.ts` | Create | Unit tests for the extractor service |
| `front/src/store/chatStore.ts` | Modify | Add `appendActions` to interface + implementation |
| `front/src/screens/chat/context.tsx` | Modify | Fire `extractActions` in `subscribeGenerationDone` |

---

## Task 1: `actionExtractor.ts` service

**Files:**
- Create: `front/src/services/actionExtractor.ts`
- Test: `front/__tests__/actionExtractor.test.ts`

**Context:** The existing `front/src/services/chatTitleGenerator.ts` is the exact template to follow. The `MessageAction` type lives in `front/src/screens/main/models.tsx`:
```typescript
export type MessageAction = {
    label: string
    command: string
    url?: string | null
    prompt?: string | null
    agent?: string
    why?: string
}
```
The `@react-native-ai/apple` and `ai` packages are already installed (used by `chatTitleGenerator.ts`).

---

- [ ] **Step 1: Write the failing tests**

Create `front/__tests__/actionExtractor.test.ts`:

```typescript
import { Platform } from 'react-native';
import { extractActions } from '../src/services/actionExtractor';

// Mock react-native Platform
jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

// Mock @react-native-ai/apple and ai
const mockGenerateText = jest.fn();
jest.mock('@react-native-ai/apple', () => ({
    apple: () => 'apple-model',
}));
jest.mock('ai', () => ({
    generateText: (...args: any[]) => mockGenerateText(...args),
}));

describe('extractActions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (Platform as any).OS = 'ios';
    });

    it('returns [] on Android without calling AFM', async () => {
        (Platform as any).OS = 'android';
        const result = await extractActions('Meet me at Central Park');
        expect(result).toEqual([]);
        expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('parses valid JSON array of actions', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: '[{"command":"open_maps","label":"Central Park","url":"maps://?daddr=40.785,-73.968"}]',
        });
        const result = await extractActions('Meet me at Central Park');
        expect(result).toHaveLength(1);
        expect(result[0].command).toBe('open_maps');
        expect(result[0].label).toBe('Central Park');
        expect(result[0].url).toBe('maps://?daddr=40.785,-73.968');
    });

    it('returns [] when AFM returns empty array', async () => {
        mockGenerateText.mockResolvedValueOnce({ text: '[]' });
        const result = await extractActions('The sky is blue.');
        expect(result).toEqual([]);
    });

    it('returns [] when AFM returns malformed JSON', async () => {
        mockGenerateText.mockResolvedValueOnce({ text: 'not json at all' });
        const result = await extractActions('Some text');
        expect(result).toEqual([]);
    });

    it('returns [] when AFM times out', async () => {
        jest.useFakeTimers();
        mockGenerateText.mockImplementation(
            () => new Promise(resolve => setTimeout(resolve, 10_000)),
        );
        const promise = extractActions('Some text');
        jest.advanceTimersByTime(6000);
        const result = await promise;
        expect(result).toEqual([]);
        jest.useRealTimers();
    });

    it('filters out items missing command or label', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: '[{"command":"open_maps","label":"Valid"},{"url":"https://example.com"}]',
        });
        const result = await extractActions('Some text');
        expect(result).toHaveLength(1);
        expect(result[0].command).toBe('open_maps');
    });

    it('truncates long input to 2000 chars', async () => {
        mockGenerateText.mockResolvedValueOnce({ text: '[]' });
        const longText = 'a'.repeat(5000);
        await extractActions(longText);
        const callArgs = mockGenerateText.mock.calls[0][0];
        expect(callArgs.prompt).toContain('a'.repeat(2000));
        expect(callArgs.prompt).not.toContain('a'.repeat(2001));
    });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd front && npm test -- --testPathPattern="actionExtractor" --no-coverage 2>&1 | tail -20
```

Expected: `Cannot find module '../src/services/actionExtractor'`

- [ ] **Step 3: Create `front/src/services/actionExtractor.ts`**

```typescript
/**
 * AFM Action Extractor — detects actionable items in assistant responses.
 * On iOS: uses Apple Foundation Models (on-device) to extract actions.
 * On Android or on error: returns [] immediately.
 */

import { Platform } from 'react-native';
import { MessageAction } from '../screens/main/models';

const EXTRACTION_TIMEOUT_MS = 5_000;
const MAX_INPUT_LENGTH = 2_000;
const LOG_TAG = '[ActionExtractor]';

function isValidAction(a: unknown): a is MessageAction {
    return (
        typeof (a as any)?.command === 'string' &&
        typeof (a as any)?.label === 'string'
    );
}

/**
 * Runs Apple Foundation Models on-device to extract tappable actions from text.
 * Returns [] on Android, on timeout, or on any error — never throws.
 */
export async function extractActions(text: string): Promise<MessageAction[]> {
    if (Platform.OS !== 'ios') {
        return [];
    }

    const trimmed = text.trim().slice(0, MAX_INPUT_LENGTH);
    if (!trimmed) {
        return [];
    }

    try {
        const { apple } = require('@react-native-ai/apple');
        const { generateText } = require('ai');

        const prompt = `You are an action extractor. Read the assistant message below and identify any discrete actions the user could take — opening a map location, visiting a URL, answering a yes/no question, confirming something, etc.

Return ONLY a JSON array. Each item must have:
  "command": short snake_case verb (e.g. "open_maps", "open_web", "poll_yes", "poll_no")
  "label":   short human-readable button label (30 chars max)
  "url":     full URL or deep link (omit or use "" if not applicable)

If there are no actionable items, return an empty array: []

Do NOT return any explanation, markdown, or text outside the JSON array.

Message:
${trimmed}`;

        const resultPromise = generateText({ model: apple(), prompt });
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error('Action extraction timeout')),
                EXTRACTION_TIMEOUT_MS,
            ),
        );

        const result = await Promise.race([resultPromise, timeoutPromise]);
        const raw = (result as { text?: string })?.text?.trim() ?? '';

        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        const actions = parsed.filter(isValidAction);
        console.log(LOG_TAG, `Extracted ${actions.length} action(s)`);
        return actions;
    } catch (e) {
        console.warn(LOG_TAG, 'AFM unavailable or error:', e);
        return [];
    }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd front && npm test -- --testPathPattern="actionExtractor" --no-coverage 2>&1 | tail -20
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 5: Commit**

```bash
cd front && git add src/services/actionExtractor.ts ../__tests__/actionExtractor.test.ts
git commit -m "feat(front): add AFM action extractor service with tests"
```

---

## Task 2: `appendActions` in `chatStore.ts`

**Files:**
- Modify: `front/src/store/chatStore.ts` (lines 23–31 for interface, ~line 205 for implementation)

**Context:** `chatStore.ts` uses Zustand. The `ChatStore` interface at the top declares method signatures. Each method is implemented inside the `create()(...)` call below. The `removeMessage` method (lines 172–183) is the closest in shape to what we need — it reads `state.chats[chatId]`, checks existence, returns unchanged state on miss. The `Message` type has `actions?: MessageAction[]`.

---

- [ ] **Step 1: Add `appendActions` to the `ChatStore` interface**

In `front/src/store/chatStore.ts`, find the `ChatStore` interface (lines 23–31). Add one line:

```typescript
interface ChatStore {
    chats: Record<string, Message[]>;
    addMessage: (chatId: string, payload: any) => void;
    setMessages: (chatId: string, messages: Message[]) => void;
    mergeMessages: (chatId: string, incoming: Message[]) => void;
    removeMessage: (chatId: string, messageId: string) => void;
    clearChat: (chatId: string) => void;
    flushPendingUpdates: (chatId: string) => void;
    appendActions: (chatId: string, messageId: string, actions: MessageAction[]) => void;
}
```

Also add `MessageAction` to the import at the top of the file (line 5):

```typescript
import { Message, ContentPart, MessageAction } from '../screens/main/models';
```

- [ ] **Step 2: Add the `appendActions` implementation**

In `front/src/store/chatStore.ts`, after the `clearChat` implementation block (around line 205, after its closing `},`), add:

```typescript
            appendActions: (chatId, messageId, actions) => {
                if (actions.length === 0) return;
                set((state) => {
                    const msgs = state.chats[chatId];
                    if (!msgs) return state;
                    const idx = msgs.findIndex(m => m.id === messageId);
                    if (idx === -1) return state;
                    const updated = [...msgs];
                    updated[idx] = {
                        ...updated[idx],
                        actions: [...(updated[idx].actions ?? []), ...actions],
                    };
                    return {
                        chats: {
                            ...state.chats,
                            [chatId]: updated,
                        },
                    };
                });
            },
```

- [ ] **Step 3: Type-check**

```bash
cd front && npm run type-check 2>&1 | grep -E "error|appendActions" | head -20
```

Expected: no errors mentioning `appendActions` or `MessageAction`.

- [ ] **Step 4: Commit**

```bash
git add front/src/store/chatStore.ts
git commit -m "feat(front): add appendActions to chatStore for merging AFM actions"
```

---

## Task 3: Wire up in `context.tsx`

**Files:**
- Modify: `front/src/screens/chat/context.tsx` (around line 25 for imports, lines 1119–1136 for the effect)

**Context:** The `subscribeGenerationDone` effect (line 1118) fires once per stream completion. After `flushPendingUpdates` (line 1126), the store's message list is final and the last assistant message's `.text` is complete. `useChatStore` is already imported. `startTransition` is already imported. We add fire-and-forget calls after `flushPendingUpdates`, before `startTransition`.

---

- [ ] **Step 1: Add import for `extractActions`**

In `front/src/screens/chat/context.tsx`, after the existing import at line 25 (`import { generateChatTitle } from '../../services/chatTitleGenerator';`), add:

```typescript
import { extractActions } from '../../services/actionExtractor';
```

- [ ] **Step 2: Add the fire-and-forget call in `subscribeGenerationDone`**

Find the `subscribeGenerationDone` effect (starting at line 1118). Replace the body with:

```typescript
    useEffect(() => {
        const unsubscribe = subscribeGenerationDone(chatId => {
            if (chatId === activeChatID) {
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                // Flush final streaming state before transitioning UI
                useChatStore.getState().flushPendingUpdates(chatId);

                // Fire-and-forget: extract action buttons from final assistant text
                const msgs = useChatStore.getState().chats[chatId] ?? [];
                const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
                if (lastAssistant?.text) {
                    extractActions(lastAssistant.text)
                        .then(actions => {
                            if (actions.length > 0) {
                                useChatStore.getState().appendActions(chatId, lastAssistant.id, actions);
                            }
                        })
                        .catch(() => {});
                }

                generatingForChatRef.current = null;
                startTransition(() => {
                    setAssistantWorking(false);
                    setActiveAgentsCount(0);
                    setGenerationStatus(null);
                });
            }
        });
        return unsubscribe;
    }, [activeChatID]);
```

- [ ] **Step 3: Type-check**

```bash
cd front && npm run type-check 2>&1 | grep error | head -20
```

Expected: no errors.

- [ ] **Step 4: Run existing tests to confirm nothing is broken**

```bash
cd front && npm test -- --no-coverage 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add front/src/screens/chat/context.tsx
git commit -m "feat(front): wire AFM action extractor into post-stream hook"
```

---

## Done

All three tasks complete. The flow is:

1. Stream ends → `subscribeGenerationDone` fires
2. `flushPendingUpdates` makes final text available in store
3. `extractActions(text)` runs on-device via AFM (iOS only, ~1–3 s)
4. `appendActions` merges extracted actions with any server-emitted ones
5. Existing action button UI renders them — no UI changes needed
