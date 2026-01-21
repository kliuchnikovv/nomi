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
    //             { type: 'rag', model: 'gemini-2.0-flash-exp' },
    //             { type: 'web_search', model: 'gemini-2.0-flash-exp' },
    //         ],
    //     }
    // },
    {
        id: 'development_team',
        name: 'Development',
        description: 'Analyst, Architect, Developer, and Reviewer to solve coding tasks.',
        command: {
            type: 'development_team',
            name: 'Development Team',
            model: 'gemini-2.0-flash-exp', // Prefer a strong model for coding
        }
    },
    // Individual Development Team Agents (for direct 1:1 chat)
    // {
    //     id: 'analyst',
    //     name: '🔍 Analyst',
    //     description: 'Requirements analysis, acceptance criteria, and RAG-powered codebase understanding.',
    //     isAgent: true,
    //     command: {
    //         type: 'analyst',
    //         name: 'Analyst',
    //         model: 'gemini-2.5-flash',
    //     }
    // },
    // {
    //     id: 'architect',
    //     name: '🏗️ Architect',
    //     description: 'System design, ADRs, implementation plans, and architecture decisions.',
    //     isAgent: true,
    //     command: {
    //         type: 'architect',
    //         name: 'Architect',
    //         model: 'gemini-2.5-flash',
    //     }
    // },
    // {
    //     id: 'developer',
    //     name: '💻 Developer',
    //     description: 'Code implementation, debugging, and development tasks.',
    //     isAgent: true,
    //     command: {
    //         type: 'developer',
    //         name: 'Developer',
    //         model: 'gemini-2.5-flash',
    //     }
    // },
    // {
    //     id: 'worker',
    //     name: '⚙️ Worker',
    //     description: 'Automated execution via Jules API for implementation plans.',
    //     isAgent: true,
    //     command: {
    //         type: 'worker',
    //         name: 'Worker',
    //         model: 'gemini-2.5-flash',
    //     }
    // },
    // {
    //     id: 'reviewer',
    //     name: '✅ Reviewer',
    //     description: 'Code review, quality validation, and security checks.',
    //     isAgent: true,
    //     command: {
    //         type: 'reviewer',
    //         name: 'Reviewer',
    //         model: 'gemini-2.5-flash',
    //     }
    // },
    {
        id: 'dnd_team',
        name: 'D&D',
        description: 'Immersive 5e campaigns with a DM, Rules Lawyer, and Party management.',
        command: {
            type: 'dnd_team',
            name: 'D&D Team',
            model: 'gemini-2.0-flash-exp',
        }
    }
];
