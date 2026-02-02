export interface TeamDetails {
    id: string;
    name: string;
    description: string;
    isAgent?: boolean; // true for individual agents (use mode: 'agent'), false/undefined for teams
    // The command payload structure expected by the backend
    command: {
        type: string;
        name?: string;
        participants?: any[];
        model?: string; // Optional override
    };
}

export const AVAILABLE_TEAMS: TeamDetails[] = [
];
