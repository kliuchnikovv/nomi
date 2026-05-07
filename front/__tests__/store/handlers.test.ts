import { handleTextPayload } from '../../src/store/handlers/text';
import { handleToolCallPayload } from '../../src/store/handlers/toolCall';
import { handleReasoningPayload } from '../../src/store/handlers/reasoning';
import { handleClientActionPayload } from '../../src/store/handlers/clientAction';
import { handleMemberResponsePayload } from '../../src/store/handlers/memberResponse';
import { handleActionsPayload } from '../../src/store/handlers/actions';
import { handleUsagePayload } from '../../src/store/handlers/usage';
import { dispatchPayload } from '../../src/store/handlers/index';
import type { Message } from '../../src/screens/main/models';

// ── Helper ────────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<Message> = {}): Message {
    return {
        id: 'm1', chat_id: 'c1', sender: 'assistant', role: 'assistant',
        text: '', created_at: 1000, content_parts: [], tool_calls: [],
        ...overrides,
    };
}

// ── handleTextPayload ─────────────────────────────────────────────────────────

describe('handleTextPayload', () => {
    it('appends text to an empty message', () => {
        const msgs = [makeMsg()];
        const result = handleTextPayload({ type: 'text', message: 'Hello' }, msgs, 0);
        expect(result[0].text).toBe('Hello');
    });

    it('appends delta to existing text', () => {
        const msgs = [makeMsg({ text: 'Hello' })];
        const result = handleTextPayload({ type: 'text', delta: ' World' }, msgs, 0);
        expect(result[0].text).toBe('Hello World');
    });

    it('deduplicates by stream index — skips older ix', () => {
        const msgs = [makeMsg({ text: 'A', _stream_ix: 5 })];
        const result = handleTextPayload({ type: 'text', message: 'B', ix: 3 }, msgs, 0);
        expect(result).toBe(msgs); // same reference → no change
    });

    it('updates stream index', () => {
        const msgs = [makeMsg({ text: 'A', _stream_ix: 1 })];
        const result = handleTextPayload({ type: 'text', message: ' B', ix: 2 }, msgs, 0);
        expect(result[0]._stream_ix).toBe(2);
    });

    it('returns unchanged array when text is empty', () => {
        const msgs = [makeMsg()];
        const result = handleTextPayload({ type: 'text', message: '' }, msgs, 0);
        expect(result).toEqual(msgs);
    });

    it('returns unchanged array when messageIdx is out of bounds', () => {
        const msgs = [makeMsg()];
        const result = handleTextPayload({ type: 'text', message: 'x' }, msgs, 5);
        expect(result).toEqual(msgs);
    });

    it('skips duplicate text (currentText already ends with newText)', () => {
        const msgs = [makeMsg({ text: 'Hello World' })];
        const result = handleTextPayload({ type: 'text', message: 'World' }, msgs, 0);
        expect(result).toBe(msgs);
    });

    it('handles cumulative stream — extracts delta from full text', () => {
        const msgs = [makeMsg({ text: 'Hello' })];
        // Backend sends full text so far
        const result = handleTextPayload({ type: 'text', message: 'Hello World' }, msgs, 0);
        expect(result[0].text).toBe('Hello World');
    });

    it('adds text content part', () => {
        const msgs = [makeMsg()];
        const result = handleTextPayload({ type: 'text', message: 'Hi' }, msgs, 0);
        const parts = result[0].content_parts ?? [];
        expect(parts.some((p: any) => p.type === 'text' && p.text === 'Hi')).toBe(true);
    });

    it('appends to existing text content part', () => {
        const msgs = [makeMsg({ text: 'Hi', content_parts: [{ type: 'text', text: 'Hi' }] })];
        const result = handleTextPayload({ type: 'text', delta: '!' }, msgs, 0);
        const parts = result[0].content_parts ?? [];
        const textPart = parts.find((p: any) => p.type === 'text') as any;
        expect(textPart?.text).toBe('Hi!');
    });
});

// ── handleToolCallPayload ────────────────────────────────────────────────────

describe('handleToolCallPayload', () => {
    it('appends a new tool call when none exist', () => {
        const msgs = [makeMsg()];
        const tool = { id: 'tc1', name: 'search', arguments: '{}', status: 'running' };
        const result = handleToolCallPayload({ type: 'tool_call', tool }, msgs, 0);
        expect(result[0].tool_calls).toHaveLength(1);
        expect(result[0].tool_calls![0].id).toBe('tc1');
    });

    it('updates existing tool call by ID', () => {
        const existing = { id: 'tc1', name: 'search', arguments: '{}', status: 'running' };
        const msgs = [makeMsg({
            tool_calls: [existing],
            content_parts: [{ type: 'tool_call', tool_call: existing }],
        })];
        const update = { id: 'tc1', name: 'search', result: 'done', status: 'done' };
        const result = handleToolCallPayload({ type: 'tool_call', tool: update }, msgs, 0);
        expect(result[0].tool_calls![0].status).toBe('done');
    });

    it('matches running tool call by name when no ID', () => {
        const existing = { name: 'search', arguments: '{}', status: 'running' };
        const msgs = [makeMsg({
            tool_calls: [existing],
            content_parts: [{ type: 'tool_call', tool_call: existing }],
        })];
        const update = { name: 'search', result: 'results', status: 'done' };
        const result = handleToolCallPayload({ type: 'tool_call', tool: update }, msgs, 0);
        expect(result[0].tool_calls![0].result).toBe('results');
    });

    it('returns unchanged array when no tool in payload', () => {
        const msgs = [makeMsg()];
        const result = handleToolCallPayload({ type: 'tool_call' }, msgs, 0);
        expect(result).toEqual(msgs);
    });

    it('does nothing when messageIdx is out of bounds', () => {
        const msgs = [makeMsg()];
        const tool = { id: 'tc1', name: 'x' };
        const result = handleToolCallPayload({ type: 'tool_call', tool }, msgs, 5);
        expect(result[0].tool_calls).toHaveLength(0);
    });
});

// ── handleReasoningPayload ────────────────────────────────────────────────────

describe('handleReasoningPayload', () => {
    it('appends reasoning text and creates content part', () => {
        const msgs = [makeMsg()];
        const result = handleReasoningPayload({ type: 'reasoning', delta: 'Thinking...' }, msgs, 0);
        const parts = result[0].content_parts ?? [];
        expect(parts.some((p: any) => p.type === 'reasoning')).toBe(true);
        expect(result[0].reasoning_steps).toEqual(['Thinking...']);
    });

    it('appends to existing reasoning part', () => {
        const msgs = [makeMsg({
            content_parts: [{ type: 'reasoning', reasoning: 'Step 1 ' }],
            reasoning_steps: ['Step 1 '],
        })];
        const result = handleReasoningPayload({ type: 'reasoning', delta: 'Step 2' }, msgs, 0);
        const part = (result[0].content_parts ?? []).find((p: any) => p.type === 'reasoning') as any;
        expect(part.reasoning).toBe('Step 1 Step 2');
    });

    it('skips duplicate stream index', () => {
        const msgs = [makeMsg({ _stream_ix: 10 })];
        const result = handleReasoningPayload({ type: 'reasoning', delta: 'x', ix: 5 }, msgs, 0);
        expect(result).toBe(msgs);
    });

    it('returns unchanged array when text is empty', () => {
        const msgs = [makeMsg()];
        const result = handleReasoningPayload({ type: 'reasoning', delta: '' }, msgs, 0);
        expect(result).toEqual(msgs);
    });
});

// ── handleClientActionPayload ─────────────────────────────────────────────────

describe('handleClientActionPayload', () => {
    it('appends a tool_call part for the client action', () => {
        const msgs = [makeMsg()];
        const result = handleClientActionPayload(
            { type: 'client_action', tool: 'gmail', method: 'send', params: { to: 'a@b.com' } },
            msgs, 0
        );
        const parts = result[0].content_parts ?? [];
        const part = parts.find((p: any) => p.type === 'tool_call') as any;
        expect(part?.tool_call.name).toBe('gmail:send');
        expect(part?.tool_call.result).toBe('Executed on client');
    });

    it('does nothing when messageIdx is out of bounds', () => {
        const msgs = [makeMsg()];
        const result = handleClientActionPayload(
            { type: 'client_action', tool: 'x', method: 'y', params: {} }, msgs, 5
        );
        expect(result[0].content_parts).toHaveLength(0);
    });
});

// ── handleMemberResponsePayload ───────────────────────────────────────────────

describe('handleMemberResponsePayload', () => {
    it('creates a new member_response part', () => {
        const msgs = [makeMsg()];
        const result = handleMemberResponsePayload(
            { type: 'member_response', delta: 'Hi', agent_name: 'Mailer' }, msgs, 0
        );
        const parts = result[0].content_parts ?? [];
        const part = parts.find((p: any) => p.type === 'member_response') as any;
        expect(part?.agent_name).toBe('Mailer');
        expect(part?.text).toBe('Hi');
    });

    it('appends to existing member response from same agent', () => {
        const existing = { type: 'member_response', agent_name: 'Mailer', text: 'He' } as any;
        const msgs = [makeMsg({ content_parts: [existing] })];
        const result = handleMemberResponsePayload(
            { type: 'member_response', delta: 'llo', agent_name: 'Mailer' }, msgs, 0
        );
        const parts = result[0].content_parts ?? [];
        const part = parts.find((p: any) => p.type === 'member_response') as any;
        expect(part?.text).toBe('Hello');
    });

    it('creates a new part when agent name changes', () => {
        const existing = { type: 'member_response', agent_name: 'Mailer', text: 'Hi' } as any;
        const msgs = [makeMsg({ content_parts: [existing] })];
        const result = handleMemberResponsePayload(
            { type: 'member_response', delta: 'Hey', agent_name: 'Scheduler' }, msgs, 0
        );
        const parts = result[0].content_parts ?? [];
        expect(parts).toHaveLength(2);
    });

    it('returns unchanged array when text is empty', () => {
        const msgs = [makeMsg()];
        const result = handleMemberResponsePayload(
            { type: 'member_response', delta: '' }, msgs, 0
        );
        expect(result[0].content_parts).toHaveLength(0);
    });
});

// ── handleActionsPayload ──────────────────────────────────────────────────────

describe('handleActionsPayload', () => {
    it('sets actions on the message', () => {
        const msgs = [makeMsg()];
        const actions = [{ label: 'Retry', command: 'retry' }];
        const result = handleActionsPayload(
            { type: 'actions', actions, message_id: 'm1' }, msgs, 0
        );
        expect(result[0].actions).toHaveLength(1);
        expect(result[0].actions![0].message_id).toBe('m1');
    });

    it('returns unchanged when actions array is empty', () => {
        const msgs = [makeMsg()];
        const result = handleActionsPayload({ type: 'actions', actions: [] }, msgs, 0);
        expect(result[0].actions).toBeUndefined();
    });
});

// ── handleUsagePayload ────────────────────────────────────────────────────────

describe('handleUsagePayload', () => {
    it('sets metadata.usage on the message', () => {
        const msgs = [makeMsg()];
        const result = handleUsagePayload(
            { type: 'usage', prompt_tokens: 10, completion_tokens: 20, elapsed_ms: 500 },
            msgs, 0
        );
        expect(result[0].metadata?.usage).toEqual({
            prompt_tokens: 10, completion_tokens: 20, elapsed_ms: 500,
        });
    });

    it('merges with existing metadata', () => {
        const msgs = [makeMsg({ metadata: { model: 'gpt-4' } })];
        const result = handleUsagePayload(
            { type: 'usage', prompt_tokens: 5, completion_tokens: 10, elapsed_ms: 200 },
            msgs, 0
        );
        expect(result[0].metadata?.model).toBe('gpt-4');
        expect(result[0].metadata?.usage.prompt_tokens).toBe(5);
    });
});

// ── dispatchPayload ───────────────────────────────────────────────────────────

describe('dispatchPayload', () => {
    it('routes "text" type to text handler', () => {
        const msgs = [makeMsg()];
        const result = dispatchPayload({ type: 'text', message: 'Hello' }, msgs, 0);
        expect(result[0].text).toBe('Hello');
    });

    it('routes "tool_call" type to tool call handler', () => {
        const msgs = [makeMsg()];
        const tool = { id: 't1', name: 'search' };
        const result = dispatchPayload({ type: 'tool_call', tool }, msgs, 0);
        expect(result[0].tool_calls).toHaveLength(1);
    });

    it('routes "reasoning" type to reasoning handler', () => {
        const msgs = [makeMsg()];
        const result = dispatchPayload({ type: 'reasoning', delta: 'hmm' }, msgs, 0);
        expect(result[0].reasoning_steps).toEqual(['hmm']);
    });

    it('routes "actions" type to actions handler', () => {
        const msgs = [makeMsg()];
        const result = dispatchPayload(
            { type: 'actions', actions: [{ label: 'Go', command: 'go' }], message_id: 'm1' },
            msgs, 0
        );
        expect(result[0].actions).toHaveLength(1);
    });

    it('infers "text" type when type is missing but message exists', () => {
        const msgs = [makeMsg()];
        const result = dispatchPayload({ message: 'implied text' }, msgs, 0);
        expect(result[0].text).toBe('implied text');
    });

    it('returns prevMessages unchanged for unknown type', () => {
        const msgs = [makeMsg()];
        const result = dispatchPayload({ type: 'unknown_xyz' }, msgs, 0);
        expect(result).toBe(msgs);
    });

    it('returns prevMessages unchanged when type and message/delta are absent', () => {
        const msgs = [makeMsg()];
        const result = dispatchPayload({}, msgs, 0);
        expect(result).toBe(msgs);
    });
});
