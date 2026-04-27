/**
 * ProjectClassifier
 *
 * Classifies a chat message against the user's projects.
 *
 * Strategy (in priority order):
 *  1. Native Foundation Models (iOS 26+) — most accurate, on-device LLM.
 *  2. JS keyword fallback — checks if the message contains a project's name or
 *     significant words from its description. Used when the native module is
 *     unavailable or returns null.
 *
 * Both paths return the matching project's ID, or null if no match.
 */

import { NativeModules, Platform } from 'react-native';
import type { Project } from '../../screens/main/models';

interface ProjectClassifierNative {
    classify(
        messageText: string,
        projects: Array<{ id: string; name: string; description: string }>,
    ): Promise<string | null>;
}

const native: ProjectClassifierNative | null =
    Platform.OS === 'ios' ? (NativeModules.ProjectClassifier ?? null) : null;

// ---------------------------------------------------------------------------
// JS keyword fallback
// ---------------------------------------------------------------------------

/** Minimum word length to treat as a meaningful keyword. */
const MIN_KEYWORD_LENGTH = 3;

/**
 * Returns the project whose name or description keywords appear in the message,
 * or null if none match.
 *
 * Scoring: +2 for a name token hit, +1 per description token hit.
 * The project with the highest score (> 0) wins.
 */
function classifyByKeywords(
    messageText: string,
    projects: Project[],
): string | null {
    const msgLower = messageText.toLowerCase();

    let bestId: string | null = null;
    let bestScore = 0;

    for (const project of projects) {
        let score = 0;

        // Tokenise name — each word is a weighted signal
        const nameTokens = project.name
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length >= MIN_KEYWORD_LENGTH);
        for (const token of nameTokens) {
            if (msgLower.includes(token)) score += 2;
        }

        // Tokenise description — lower weight
        const descTokens = project.description
            .toLowerCase()
            .split(/\s+/)
            .filter((t) => t.length >= MIN_KEYWORD_LENGTH);
        for (const token of descTokens) {
            if (msgLower.includes(token)) score += 1;
        }

        if (score > bestScore) {
            bestScore = score;
            bestId = project.id;
        }
    }

    return bestId;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify `messageText` against `projects`.
 *
 * @returns The matching project's id, or null if no match / unavailable.
 */
export async function classifyMessageForProject(
    messageText: string,
    projects: Project[],
): Promise<string | null> {
    if (projects.length === 0) return null;

    // 1. Try native Foundation Models (iOS 26+)
    if (native) {
        try {
            const projectPayload = projects.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
            }));
            const result = await native.classify(messageText, projectPayload);
            console.log('[ProjectClassifier] native result:', result);
            if (result) return result;
        } catch (e) {
            console.warn('[ProjectClassifier] Native classification failed:', e);
        }
    } else {
        console.log('[ProjectClassifier] native module not available, using keyword fallback');
    }

    // 2. JS keyword fallback
    const keywordResult = classifyByKeywords(messageText, projects);
    console.log('[ProjectClassifier] keyword result:', keywordResult,
        'projects:', projects.map(p => p.name),
        'msg tokens:', messageText.toLowerCase().split(/\s+/).filter(t => t.length >= MIN_KEYWORD_LENGTH),
    );
    return keywordResult;
}
