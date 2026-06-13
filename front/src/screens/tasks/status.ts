import type { AgentTaskStatus } from '../main/models';

type StatusTheme = {
    accent: string;
    textSecondary: string;
    attention?: string;
    error?: string;
    success?: string;
};

// Maps a task status to a representative color, using theme tokens with sane
// fallbacks for slots a theme may not define.
export function statusColor(
    status: AgentTaskStatus,
    theme: StatusTheme,
): string {
    switch (status) {
        case 'done':
            return theme.success ?? '#3BA55D';
        case 'failed':
            return theme.attention ?? theme.error ?? '#E5484D';
        case 'running':
        case 'planning':
        case 'waiting_input':
            return theme.accent;
        case 'paused':
        case 'cancelled':
        default:
            return theme.textSecondary;
    }
}

const LABELS: Record<AgentTaskStatus, string> = {
    planning: 'Planning',
    running: 'Running',
    waiting_input: 'Waiting for input',
    paused: 'Paused',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
};

export function statusLabel(status: AgentTaskStatus): string {
    return LABELS[status] ?? status;
}
