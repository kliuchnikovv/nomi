import { MessageHandler } from './types';

export const handleClientActionPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/store/handlers/clientAction.ts:3',message:'handleClientActionPayload called',data:{payload,messageIdx},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const newMessages = [...prevMessages];
    const { tool, method, params } = payload;

    if (newMessages[messageIdx]) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        const updatedParts = [...existingParts];

        updatedParts.push({
            type: 'tool_call',
            tool_call: {
                name: `${tool}:${method}`,
                arguments: params,
                result: "Executed on client"
            }
        });
        
        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            content_parts: updatedParts
        };
    }
    
    return newMessages;
};
