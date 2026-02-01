import { Message } from '../../screens/main/models';

export type MessageHandler = (
    payload: any,
    prevMessages: Message[],
    messageIdx: number
) => Message[];
