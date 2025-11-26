import React, { createContext, useContext, useEffect, useState } from 'react';
import { inboxApi } from '../../apiClient';
import { InboxAction, InboxMessage, InboxPaginatedResponse } from './models';

interface InboxContextType {
    messages: InboxMessage[];
    loading: boolean;
    error: string | null;
    page: number;
    totalPages: number;
    totalCount: number;
    loadInbox: () => Promise<void>;
    markAsRead: (id: string) => Promise<void>;
    executeAction: (messageId: string, action: InboxAction) => Promise<void>;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;
}

const InboxContext = createContext<InboxContextType | undefined>(undefined);

export const useInbox = () => {
    const context = useContext(InboxContext);
    if (!context) {
        throw new Error('useInbox must be used within InboxProvider');
    }
    return context;
};

export const InboxProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [messages, setMessages] = useState<InboxMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    const loadInbox = async (pageNum: number = 1) => {
        try {
            setLoading(true);
            setError(null);
            const response = await inboxApi.getInbox(pageNum, 20);

            if (response) {
                const data = response as InboxPaginatedResponse;
                if (pageNum === 1) {
                    setMessages(data.messages);
                } else {
                    setMessages(prev => [...prev, ...data.messages]);
                }
                setPage(data.page);
                setTotalPages(data.total_pages);
                setTotalCount(data.total_count);
            }
        } catch (err) {
            console.error('Failed to load inbox:', err);
            setError(err instanceof Error ? err.message : 'Failed to load inbox');
        } finally {
            setLoading(false);
        }
    };

    const markAsRead = async (id: string) => {
        try {
            await inboxApi.markAsRead(id);
            // Update local state to mark as read
            setMessages(prev =>
                prev.map(msg =>
                    msg.id === id ? { ...msg, status: 'read' } : msg
                )
            );
        } catch (err) {
            console.error('Failed to mark as read:', err);
            throw err;
        }
    };

    const executeAction = async (messageId: string, action: InboxAction) => {
        try {
            await inboxApi.executeAction(messageId, {
                command: action.command,
                agent: action.agent,
                url: action.url,
                prompt: action.prompt,
            });

            // Update local state based on action type
            if (action.command === 'mark_as_read') {
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === messageId ? { ...msg, status: 'read' } : msg
                    )
                );
            } else if (action.command === 'archive') {
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === messageId ? { ...msg, status: 'archived' } : msg
                    )
                );
            }
        } catch (err) {
            console.error('Failed to execute action:', err);
            throw err;
        }
    };

    const loadMore = async () => {
        if (page < totalPages && !loading) {
            await loadInbox(page + 1);
        }
    };

    const refresh = async () => {
        await loadInbox(1);
    };

    useEffect(() => {
        loadInbox(1);
    }, []);

    return (
        <InboxContext.Provider
            value={{
                messages,
                loading,
                error,
                page,
                totalPages,
                totalCount,
                loadInbox,
                markAsRead,
                executeAction,
                loadMore,
                refresh,
            }}
        >
            {children}
        </InboxContext.Provider>
    );
};
