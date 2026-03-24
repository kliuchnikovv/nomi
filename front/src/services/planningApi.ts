import { apiClient } from '../apiClient';
import { getApiUrl } from '../config';
import { DayPlan, PlanTask } from '../screens/planner/types';

/**
 * Creates a new planning chat session.
 * POST /chats with type="planning"
 * Returns chat_id
 */
export async function createPlanningSession(date: string, tasks: PlanTask[]): Promise<string> {
    const created = await apiClient.post<{ id: string }>(
        `${getApiUrl()}/chats`,
        {
            title: `Day Plan — ${date}`,
            model: 'gpt-5-nano',
            mode: 'agent',
            team_id: 'planning',
        },
    );
    if (!created?.id) {
        throw new Error('Failed to create planning session: no id returned');
    }
    return created.id;
}

/**
 * Gets current plan state for a planning chat session.
 * GET /planning/session/{chatId}
 */
export async function getPlanningState(chatId: string): Promise<DayPlan | null> {
    try {
        const result = await apiClient.get<DayPlan>(`${getApiUrl()}/planning/session/${chatId}`);
        return result ?? null;
    } catch {
        return null;
    }
}
