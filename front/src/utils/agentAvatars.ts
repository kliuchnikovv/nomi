export const AGENT_ICONS: Record<string, string> = {
    'Analyst': '🔍',
    'Architect': '🏗️',
    'Developer': '💻',
    'Worker': '⚙️',
    'Reviewer': '✅',
    'Verifier': '🔬',
    'Narrator': '📖',
    'Secretary': '📋',
    'RulesLawyer': '⚖️',
    'NPCAgent': '🎭',
    'PartyAgent': '🗡️',
};

export function getAgentIcon(agentId: string): string {
    return AGENT_ICONS[agentId] || '🤖';
}
