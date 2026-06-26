import { Platform } from 'react-native';
import { runAfm } from './ai/afmQueue';
import type { Message } from '../screens/main/models';

const LOG_TAG = '[RecapGenerator]';
const RECAP_TIMEOUT_MS = 15_000;
// Keep the on-device prompt SMALL and recent. Apple FM rejects inputs whose
// detected language isn't supported, and the more (Russian/etc.) text we feed,
// the more confidently it trips that guardrail — the suggestion generator only
// works because it sends a ~1KB recent tail. So we summarize the recent window,
// not the whole history. (Server mode still recaps the full session.)
const MAX_CHARS = 1_500;

function buildTranscript(messages: Message[]): string {
    const lines: string[] = [];
    for (const m of messages) {
        const text = (m.text ?? '').trim();
        if (!text) continue;
        const role = (m.role ?? '').toLowerCase();
        const speaker =
            role === 'user' || role === 'human' ? 'USER' : 'ASSISTANT';
        lines.push(`${speaker}: ${text}`);
    }
    let body = lines.join('\n');
    if (body.length > MAX_CHARS) {
        body = '[…earlier turns truncated…]\n' + body.slice(-MAX_CHARS);
    }
    return body;
}

/**
 * Generate a chat recap on-device via Apple Foundation Models.
 *
 * iOS-only. Returns '' on Android, empty transcript, AFM unavailability, or an
 * unsupported language (AFM rejects e.g. Russian/Ukrainian) — callers treat ''
 * as "no recap" and simply hide the banner. Serialized through the shared AFM
 * queue so it doesn't contend with suggestion/title generation.
 */
export async function generateRecapOnDevice(
    messages: Message[],
): Promise<string> {
    if (Platform.OS !== 'ios') return '';

    const body = buildTranscript(messages);
    if (!body) return '';

    try {
        const { apple } = require('@react-native-ai/apple');
        const { generateText } = require('ai');

        const prompt =
            'Summarize the conversation below in 1-2 short paragraphs. ' +
            'Preserve concrete facts, names, decisions, and open questions. ' +
            'Omit pleasantries. Always write the summary in English, ' +
            'regardless of the language of the conversation. ' +
            'Do not address the user — write a neutral third-person recap.\n\n' +
            `--- CONVERSATION ---\n${body}\n--- END ---\n\nSummary:`;

        const result = await runAfm<{ text?: string }>(
            () => generateText({ model: apple(), prompt }),
            RECAP_TIMEOUT_MS,
        );
        return (result as { text?: string })?.text?.trim() ?? '';
    } catch (e) {
        console.warn(LOG_TAG, 'AFM unavailable or error:', e);
        return '';
    }
}
