/**
 * Extracts user facts from message text for personalization (stored on backend).
 * Runs asynchronously after send — does not block the chat.
 *
 * Placeholder: returns [] until Apple Foundation Models (or other on-device)
 * extraction is integrated. When available, call on-device model with a prompt
 * like "Extract 0-5 user facts/preferences/constraints from this message (one per line)."
 */
export async function extractUserFacts(text: string): Promise<string[]> {
  if (!text?.trim()) return [];
  // TODO: When Apple FM (react-native-ai) is available: run on-device extraction
  // and return parsed facts. For now, no-op so the sendStoreFacts flow is in place.
  return [];
}
