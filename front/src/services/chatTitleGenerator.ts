/**
 * Generates a short chat title from the first user message.
 * On iOS: uses Apple Foundation Models (on-device) when available.
 * On Android or on error: returns fallback (truncated message); backend will set title from first message.
 */

import { Platform } from 'react-native';

const TITLE_MAX_LENGTH = 50;
const GENERATION_TIMEOUT_MS = 5000;

function fallbackTitle(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return '';
  const runes = Array.from(trimmed);
  if (runes.length <= TITLE_MAX_LENGTH) return trimmed;
  return runes.slice(0, TITLE_MAX_LENGTH).join('') + '...';
}

/**
 * Generates a short chat title (3–6 words) from the first message.
 * Returns fallback (truncated message) on Android, on error, or on timeout.
 */
export async function generateChatTitle(firstMessage: string): Promise<string> {
  if (Platform.OS !== 'ios') {
    return ''; // Backend will set title from first message
  }

  const trimmed = firstMessage.trim();
  if (!trimmed) return '';

  try {
    const { apple } = require('@react-native-ai/apple');
    const { generateText } = require('ai');

    const prompt = `Generate a very short chat title (3 to 6 words) for this message. Reply with only the title, no quotes.

Message: ${trimmed.slice(0, 500)}`;

    const resultPromise = generateText({
      model: apple(),
      prompt,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Title generation timeout')), GENERATION_TIMEOUT_MS)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const title = (result as { text?: string })?.text?.trim();
    if (title && title.length > 0) {
      const truncated =
        title.length > TITLE_MAX_LENGTH
          ? title.slice(0, TITLE_MAX_LENGTH) + '...'
          : title;
      return truncated;
    }
  } catch (_) {
    // Apple FM unavailable, old iOS, or error — use fallback
  }

  return fallbackTitle(firstMessage);
}
