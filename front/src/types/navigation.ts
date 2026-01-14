/**
 * Navigation types for React Navigation
 */

export type RootDrawerParamList = {
    Main: undefined;
    Auth: undefined;
    Chat: { chatId?: string };
    Settings: undefined;
};