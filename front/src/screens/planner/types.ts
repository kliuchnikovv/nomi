export interface PlanTask {
    id: string;
    title: string;
    location?: string;
    duration_min?: number;
    notes?: string;
}

export type PlanBlockType = 'task' | 'travel' | 'buffer' | 'break';

export interface PlanBlock {
    id: string;
    title: string;
    start: string; // "HH:MM"
    end: string;   // "HH:MM"
    duration_min: number;
    location?: string;
    travel_before_min: number;
    type: PlanBlockType;
    task_id?: string;
    notes?: string;
}

export type PlanStatus = 'gathering' | 'building' | 'review' | 'committed' | 'replanning';

export interface DayPlan {
    id: string;
    chat_id: string;
    planning_date: string; // "YYYY-MM-DD"
    tasks: PlanTask[];
    blocks: PlanBlock[];
    reminders_ids: string[];
    status: PlanStatus;
}
