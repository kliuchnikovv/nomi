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
  if (typeof a !== 'object' || a === null) return false;
  const obj = a as Record<string, unknown>;
  const urlOk = !('url' in obj) || obj.url === null || typeof obj.url === 'string';
  return typeof obj.command === 'string' && typeof obj.label === 'string' && urlOk;
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
    if (__DEV__) {
      console.log(LOG_TAG, `Extracted ${actions.length} action(s)`);
    }
    return actions;
  } catch (e) {
    console.warn(LOG_TAG, 'AFM unavailable or error:', e);
    return [];
  }
}
