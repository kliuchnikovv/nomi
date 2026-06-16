/**
 * AFM Suggestion Generator — produces topic-aware chat suggestions on-device.
 * On iOS: uses Apple Foundation Models (on-device) to generate short suggestion strings.
 * On Android or on error: returns [] immediately — never throws.
 *
 * Two flavors:
 *  - generateFollowUps: next messages the USER might send after an assistant reply.
 *  - generateStarterChips: opening prompts based on the user's recent topics.
 *
 * Output is a list of plain strings (these are next user messages, not action
 * buttons — so no command/url like actionExtractor).
 */

import { Platform } from 'react-native';
import { runAfm } from './ai/afmQueue';

// On-device generation is slow (~2-5s) and serialized; give it room.
const SUGGESTION_TIMEOUT_MS = 12_000;
const MAX_INPUT_LENGTH = 1_500;
// Follow-ups: keep prompts small so on-device latency stays under the timeout.
const FOLLOWUP_REPLY_LENGTH = 700;
const FOLLOWUP_USER_LENGTH = 300;
const MAX_SUGGESTIONS = 4;
const MAX_SUGGESTION_LENGTH = 80;
const LOG_TAG = '[SuggestionGenerator]';

/**
 * Best-effort parse of a model's text into a JSON array. Handles markdown code
 * fences and surrounding prose by extracting the first bracketed array substring.
 */
function parseJsonArray(raw: string): unknown[] | null {
    // Strip ```json / ``` fences if present.
    let text = raw.replace(/```(?:json)?/gi, '').trim();

    try {
        const direct = JSON.parse(text);
        if (Array.isArray(direct)) return direct;
    } catch {
        // fall through to substring extraction
    }

    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end > start) {
        try {
            const sliced = JSON.parse(text.slice(start, end + 1));
            if (Array.isArray(sliced)) return sliced;
        } catch {
            // give up
        }
    }
    return null;
}

/**
 * Accepts either a plain string item or an object with a text-ish field
 * (some models return [{label/text/message: "..."}] despite the prompt).
 */
function coerceToString(item: unknown): string {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const candidate = obj.text ?? obj.label ?? obj.message ?? obj.prompt;
        if (typeof candidate === 'string') return candidate;
    }
    return '';
}

/**
 * Fallback for when the model ignores the JSON instruction and just lists items.
 * Splits into lines and strips bullets, numbering, and surrounding quotes/commas.
 */
function looseLines(raw: string): string[] {
    return raw
        .split('\n')
        .map(line =>
            line
                .replace(/```(?:json)?/gi, '')
                .replace(/^\s*[-*•]\s*/, '') // bullets
                .replace(/^\s*\d+[.)]\s*/, '') // numbering
                .replace(/^["'\s,[\]]+|["'\s,[\]]+$/g, '') // wrapping quotes/brackets/commas
                .trim(),
        )
        .filter(line => line.length > 0);
}

/**
 * Runs a one-shot AFM prompt and parses the result as a JSON array of short strings.
 * Returns [] on Android, on timeout, or on any error.
 */
async function runStringSuggestions(prompt: string): Promise<string[]> {
    if (Platform.OS !== 'ios') {
        return [];
    }

    try {
        const { apple } = require('@react-native-ai/apple');
        const { generateText } = require('ai');

        // Serialize through the shared AFM queue so this doesn't contend with
        // action extraction / title generation (Apple FM runs one at a time).
        const result = await runAfm<{ text?: string }>(
            () => generateText({ model: apple(), prompt }),
            SUGGESTION_TIMEOUT_MS,
        );
        const raw = (result as { text?: string })?.text?.trim() ?? '';
        if (!raw) {
            return [];
        }

        // Prefer a JSON array. Fall back to newline-separated lines for weak models,
        // but only when there are >= 2 short lines (a real list) — this keeps stray
        // prose ("Here are some ideas:") from becoming a bogus single suggestion.
        const parsed = parseJsonArray(raw);
        let items: string[];
        if (parsed) {
            items = parsed.map(coerceToString);
        } else {
            const lines = looseLines(raw).filter(
                s => s.length <= MAX_SUGGESTION_LENGTH,
            );
            items = lines.length >= 2 ? lines : [];
            if (__DEV__ && items.length === 0) {
                console.log(
                    LOG_TAG,
                    'Unparseable AFM output:',
                    raw.slice(0, 200),
                );
            }
        }

        const suggestions = items
            .map(s => s.trim())
            .filter(s => s.length > 0 && s.length <= MAX_SUGGESTION_LENGTH)
            .slice(0, MAX_SUGGESTIONS);

        if (__DEV__) {
            console.log(
                LOG_TAG,
                `Generated ${suggestions.length} suggestion(s)`,
            );
        }
        return suggestions;
    } catch (e) {
        console.warn(LOG_TAG, 'AFM unavailable or error:', e);
        return [];
    }
}

/**
 * Suggest 2–4 short follow-up messages the user might send next, given the
 * assistant's latest reply (and optionally the user's last message).
 */
export async function generateFollowUps(
    assistantText: string,
    userText?: string,
): Promise<string[]> {
    // Use the TAIL of the reply: the actionable "what next" (questions, options)
    // lives at the end, and a shorter prompt keeps on-device latency well under
    // the timeout on long, code-heavy replies.
    const trimmedReply = assistantText.trim();
    const reply = trimmedReply.slice(-FOLLOWUP_REPLY_LENGTH);
    if (!reply) {
        return [];
    }
    const lastUser = userText?.trim().slice(0, FOLLOWUP_USER_LENGTH);

    const prompt = `You suggest what the USER might say next in a chat with an AI assistant.

${lastUser ? `User's last message:\n${lastUser}\n\n` : ''}Assistant's reply:
${reply}

Propose 2 to 4 very short follow-up messages the user could send next — quick replies, clarifying questions, or natural next steps. Write them in the user's voice (first person), each 40 characters or less.

Output ONLY the suggestions, one per line, with no numbering, bullets, quotes, or any other text. Example:
Tell me more
Show an example
If nothing useful applies, output nothing.`;

    return runStringSuggestions(prompt);
}

/**
 * Suggest 3–4 short opening prompts based on the user's recent topics/activity.
 * `context` is free-form text (e.g. recent chat titles). Empty context → [].
 */
export async function generateStarterChips(context: string): Promise<string[]> {
    const ctx = context.trim().slice(0, MAX_INPUT_LENGTH);
    if (!ctx) {
        return [];
    }

    const prompt = `You suggest opening prompts for a user starting a new chat with an AI assistant.

The user's recent topics/activity:
${ctx}

Propose 3 to 4 short prompts the user might want to start with, relevant to their recent topics. Write them in the user's voice (first person), each 40 characters or less.

Output ONLY the prompts, one per line, with no numbering, bullets, quotes, or any other text. Example:
Plan my week
Summarize my emails
If there is no useful context, output nothing.`;

    return runStringSuggestions(prompt);
}
