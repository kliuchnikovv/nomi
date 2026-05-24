import { MessageHandler } from './types';

export const handleMemberResponsePayload: MessageHandler = (
    payload,
    prevMessages,
    messageIdx,
) => {
    const newMessages = [...prevMessages];
    const memberText = payload.delta || payload.message || '';
    const agentName = payload.agent_name || 'Member';

    if (memberText && newMessages[messageIdx]) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        const updatedParts = [...existingParts];

        // Check if last part is from the same member agent
        const lastPart =
            updatedParts.length > 0
                ? updatedParts[updatedParts.length - 1]
                : null;
        if (
            lastPart &&
            (lastPart as any).type === 'member_response' &&
            (lastPart as any).agent_name === agentName
        ) {
            // Append to existing member response
            updatedParts[updatedParts.length - 1] = {
                type: 'member_response',
                agent_name: agentName,
                text: (lastPart as any).text + memberText,
            } as any;
        } else {
            // Create new member response part
            updatedParts.push({
                type: 'member_response',
                agent_name: agentName,
                text: memberText,
            } as any);
        }

        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            // Don't add memberText to main text - it goes to content_parts only
            content_parts: updatedParts,
        };
    }

    return newMessages;
};
