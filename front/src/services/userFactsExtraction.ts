/**
 * Extracts user facts from message text for personalization (stored on backend).
 * Runs asynchronously after send — does not block the chat.
 *
 * Uses Apple Foundation Models (on-device) to extract facts about user preferences,
 * habits, constraints, and context from their messages.
 */
export async function extractUserFacts(text: string): Promise<string[]> {
  if (!text?.trim()) {
    console.log('[User Facts Extraction] Empty text, skipping');
    return [];
  }

  console.log('[User Facts Extraction] Starting extraction for message:', text.substring(0, 100));

  try {
    // Use require() like ChatTitleGenerator (dynamic import doesn't work with native modules)
    const { apple } = require('@react-native-ai/apple');
    const { generateText } = require('ai');

    if (!apple || !generateText) {
      console.log('[User Facts Extraction] Apple Intelligence module not loaded (not iOS or not linked)');
      return [];
    }

    console.log('[User Facts Extraction] Apple Intelligence available, extracting facts...');

    // Prompt for on-device fact extraction
    const prompt = `Analyze this user message and extract 0-5 important facts about the user (preferences, habits, constraints, context).
Return ONLY the facts, one per line. If no facts, return empty.

Examples of facts to extract:
- "User prefers meetings after 11 AM"
- "User is working on Genie project"
- "User loves coffee in the morning"
- "User doesn't speak Spanish"
- "User is going with their spouse"

Message:
${text}

Facts (one per line):`;

    const startTime = Date.now();
    const result = await generateText({
      model: apple(),
      prompt,
    });
    const extractionTime = Date.now() - startTime;

    if (!result?.text) {
      console.log('[User Facts Extraction] No response from Apple Intelligence');
      return [];
    }

    // Parse facts: split by newlines, filter empty lines
    const facts = result.text
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));

    console.log(
      `[User Facts Extraction] ✓ Extracted ${facts.length} fact(s) in ${extractionTime}ms:`
    );
    facts.forEach((fact: string, idx: number) => {
      console.log(`[User Facts Extraction]   ${idx + 1}. ${fact}`);
    });

    return facts.slice(0, 5); // Limit to 5 facts max
  } catch (error) {
    console.error('[User Facts Extraction] ✗ Extraction failed:', error);
    return [];
  }
}
