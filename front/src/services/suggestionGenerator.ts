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

const SUGGESTION_TIMEOUT_MS = 5_000;
const MAX_INPUT_LENGTH = 1_500;
const MAX_SUGGESTIONS = 4;
const MAX_SUGGESTION_LENGTH = 60;
const LOG_TAG = '[SuggestionGenerator]';

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

    const resultPromise = generateText({ model: apple(), prompt });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('Suggestion generation timeout')),
        SUGGESTION_TIMEOUT_MS,
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

    const suggestions = parsed
      .filter((s): s is string => typeof s === 'string')
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length <= MAX_SUGGESTION_LENGTH)
      .slice(0, MAX_SUGGESTIONS);

    if (__DEV__) {
      console.log(LOG_TAG, `Generated ${suggestions.length} suggestion(s)`);
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
  const reply = assistantText.trim().slice(0, MAX_INPUT_LENGTH);
  if (!reply) {
    return [];
  }
  const lastUser = userText?.trim().slice(0, MAX_INPUT_LENGTH);

  const prompt = `You suggest what the USER might say next in a chat with an AI assistant.

${lastUser ? `User's last message:\n${lastUser}\n\n` : ''}Assistant's reply:
${reply}

Propose 2 to 4 very short follow-up messages the user could send next — quick replies, clarifying questions, or natural next steps. Write them in the user's voice (first person), each 40 characters or less.

Return ONLY a JSON array of strings, e.g. ["Tell me more", "Show an example"].
If nothing useful applies, return an empty array: [].
Do NOT return any explanation, markdown, or text outside the JSON array.`;

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

Return ONLY a JSON array of strings, e.g. ["Plan my week", "Summarize my emails"].
If there is no useful context, return an empty array: [].
Do NOT return any explanation, markdown, or text outside the JSON array.`;

  return runStringSuggestions(prompt);
}
