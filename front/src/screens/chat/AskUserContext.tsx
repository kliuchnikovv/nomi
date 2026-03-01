import React, { createContext, useContext, useState, ReactNode } from 'react';

interface AskUserDialogState {
  visible: boolean;
  question: string;
  options: string[];
  resolve: ((response: string) => void) | null;
}

interface AskUserContextType {
  showDialog: (question: string, options: string[]) => Promise<string>;
  dialogState: AskUserDialogState;
  submitResponse: (response: string) => void;
  cancelDialog: () => void;
}

const AskUserContext = createContext<AskUserContextType | undefined>(undefined);

export function AskUserProvider({ children }: { children: ReactNode }) {
  const [dialogState, setDialogState] = useState<AskUserDialogState>({
    visible: false,
    question: '',
    options: [],
    resolve: null,
  });

  const showDialog = (question: string, options: string[]): Promise<string> => {
    return new Promise((resolve) => {
      setDialogState({
        visible: true,
        question,
        options,
        resolve,
      });
    });
  };

  const submitResponse = (response: string) => {
    if (dialogState.resolve) {
      dialogState.resolve(response);
    }
    setDialogState((prev) => ({ ...prev, visible: false, resolve: null }));
  };

  const cancelDialog = () => {
    if (dialogState.resolve) {
      dialogState.resolve('User cancelled');
    }
    setDialogState((prev) => ({ ...prev, visible: false, resolve: null }));
  };

  return (
    <AskUserContext.Provider
      value={{ showDialog, dialogState, submitResponse, cancelDialog }}
    >
      {children}
    </AskUserContext.Provider>
  );
}

export function useAskUser() {
  const context = useContext(AskUserContext);
  if (!context) {
    throw new Error('useAskUser must be used within AskUserProvider');
  }
  return context;
}
