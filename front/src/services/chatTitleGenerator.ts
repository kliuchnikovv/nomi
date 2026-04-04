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
const LOG_TAG = '[ChatTitleGenerator]';

export async function generateChatTitle(firstMessage: string): Promise<string> {
  if (Platform.OS !== 'ios') {
    console.log(LOG_TAG, 'Skipping (not iOS), backend will set title');
    return ''; // Backend will set title from first message
  }

  const trimmed = firstMessage.trim();
  if (!trimmed) return '';

  // Skip AI generation for very short messages — no meaningful topic to extract
  if (trimmed.length < 10) {
    return fallbackTitle(firstMessage);
  }

  try {
    console.log(LOG_TAG, 'Loading Apple FM and generating title...');
    const { apple } = require('@react-native-ai/apple');
    const { generateText } = require('ai');

    const prompt = `Create a concise title (3–5 words) for a chat based on this first message. Capture the core topic or goal.

Rules:
- Noun phrase, not a question or full sentence
- Do NOT start with: I, Can, How, What, Please, Help, Write, Make
- No punctuation at the end
- Use the same language as the message
- Reply with only the title, nothing else

Examples:
Message: "Can you help me write a Python script to parse CSV files?"
Title: CSV File Parser in Python

Message: "What are quantum computers and how do they work?"
Title: Quantum Computing

Message: "I need to plan a birthday party for my 5-year-old daughter"
Title: Children's Birthday Party Planning

Message: ${trimmed.slice(0, 500)}
Title:`;

    const resultPromise = generateText({
      model: apple(),
      prompt,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Title generation timeout')), GENERATION_TIMEOUT_MS)
    );

    const result = await Promise.race([resultPromise, timeoutPromise]);
    const raw = (result as { text?: string })?.text?.trim() ?? '';
    // Strip accidental "Title:" prefix if model echoes the prompt format
    const title = raw.replace(/^title:\s*/i, '').trim();
    // Reject titles that are clearly prompt artifacts
    const PROMPT_ARTIFACTS = ['title generator', 'chat title'];
    const isArtifact = PROMPT_ARTIFACTS.some(a => title.toLowerCase().includes(a));
    if (title && title.length > 0 && !isArtifact) {
      const truncated =
        title.length > TITLE_MAX_LENGTH
          ? title.slice(0, TITLE_MAX_LENGTH) + '...'
          : title;
      console.log(LOG_TAG, 'Generated title:', truncated);
      return truncated;
    }
    console.log(LOG_TAG, 'Empty result from Apple FM, using fallback');
  } catch (e) {
    console.warn(LOG_TAG, 'Apple FM unavailable or error, using fallback:', e);
  }

  const fallback = fallbackTitle(firstMessage);
  console.log(LOG_TAG, 'Returning fallback title:', fallback || '(empty)');
  return fallback;
}
