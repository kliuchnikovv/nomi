/**
 * ProjectClassifier
 *
 * Wraps the native ProjectClassifier module (iOS 26+ Apple Foundation Models).
 * Given the first message text and the user's projects, returns the ID of the
 * best-matching project, or null if there is no good match (or the native
 * module is unavailable on the current platform/OS version).
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

/**
 * Classify `messageText` against `projects` using on-device Foundation Models.
 *
 * @returns The matching project's id, or null if no match / unavailable.
 */
export async function classifyMessageForProject(
    messageText: string,
    projects: Project[],
): Promise<string | null> {
    if (!native || projects.length === 0) return null;

    try {
        const projectPayload = projects.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
        }));
        const result = await native.classify(messageText, projectPayload);
        return result ?? null;
    } catch (e) {
        // Classification is non-fatal — always degrade gracefully.
        console.warn('[ProjectClassifier] Classification failed:', e);
        return null;
    }
}
