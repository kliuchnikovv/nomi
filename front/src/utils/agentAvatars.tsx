import React from 'react';
import { Laptop, OpenBook, ClipboardCheck, MaskSquare, ShieldCheck, Spark } from 'iconoir-react-native';

const ICON_SIZE = 14;

export const AGENT_ICONS: Record<string, React.FC<{ width?: number; height?: number; color?: string }>> = {
    'Developer': Laptop,
    'Narrator': OpenBook,
    'Secretary': ClipboardCheck,
    'RulesLawyer': ShieldCheck,
    'NPCAgent': MaskSquare,
    'PartyAgent': Spark,
};

export function getAgentIcon(agentId: string, color?: string): React.ReactNode {
    const IconComponent = AGENT_ICONS[agentId] || Spark;
    return <IconComponent width={ICON_SIZE} height={ICON_SIZE} color={color} />;
}
