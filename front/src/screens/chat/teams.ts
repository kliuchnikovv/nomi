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
    // {
    //     id: 'travel_planning',
    //     name: 'Travel Planning',
    //     description: 'Plan your perfect trip with Google Maps and Web Search support.',
    //     command: {
    //         type: 'travel_planning',
    //         name: 'Travel Planning Team',
    //     },
    // },
    // {
    //     id: 'genie',
    //     name: 'Genie Team',
    //     description: 'General purpose assistant with search and maps capability.',
    //     command: {
    //         type: 'genie',
    //         name: 'Genie Team',
    //     },
    // },
    // {
    //     id: 'research_team',
    //     name: 'Research Team (Dynamic)',
    //     description: 'A dynamic team for deep research.',
    //     command: {
    //         type: 'dynamic', // Fallback to dynamic if backend handles it
    //         name: 'Research Team',
    //         participants: [
    //             { type: 'rag', model: 'gemini-2.0-flash' },
    //             { type: 'web_search', model: 'gemini-2.0-flash' },
    //         ],
    //     }
    // },
    // {
    //     id: 'dnd_team',
    //     name: 'D&D',
    //     description: 'Immersive 5e campaigns with a DM, Rules Lawyer, and Party management.',
    //     command: {
    //         type: 'dnd_team',
    //         name: 'D&D Team',
    //         model: 'gemini-2.5-pro',
    //     }
    // }
];
