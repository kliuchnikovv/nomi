import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/context';
import { getApiUrl } from '../apiClient';
import { ChatSocket } from '../../socket';
import { Frame } from '../screens/main/models';

type TaskStatus = 'BACKLOG' | 'ANALYSIS' | 'PLANNING' | 'CODING' | 'REVIEW' | 'VERIFY' | 'DONE' | 'CANCELLED';

export interface ActiveTask {
    id: string;
    title: string;
    projectId: string;
    projectName: string;
    status: TaskStatus;
    updatedAt: string;
}

interface NotificationContextType {
    activeTasks: ActiveTask[];
    markTaskAsSeen: (taskId: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function useNotifications() {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const { token, refreshToken } = useAuth();
    const socketRef = useRef<ChatSocket | null>(null);
    const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);

    useEffect(() => {
        if (!token) {
            socketRef.current?.close();
            socketRef.current = null;
            return;
        }

        if (!socketRef.current) {
            console.log('[NotificationContext] Connecting to User Channel...');
            // Initialize socket connecting to user channel
            // We pass 'user' as context which makes ChatSocket append source=user (not what we want)
            // But ChatSocket is flexible. We need to pass source as 'user' or modify ChatSocket?
            // Wait, I updated backend to look for `channel=user`.
            // ChatSocket doesn't natively support custom query params easily except via constructor getters.
            // Let's check ChatSocket implementation I read earlier.
            // It appends `source` from `getContext()`.
            // But backend looks for `channel` query param.
            // ChatSocket doesn't seem to support adding arbitrary query params.
            // BUT, looking at ChatSocket.open():
            // `if (context) qs.append('source', context);`
            // `if (chatId) qs.append('chat_id', chatId);`

            // If I pass `channel=user` via one of the existing fields? No, that's hacky.
            // However, the backend implementation I wrote:
            // `channel := c.Query("channel")`
            // If I can't change ChatSocket easily (it's in a shared file), I might need to subclass it or modify it.
            // Wait, I can modify `ChatSocket` in `front/src/socket/index.ts`.
            // But `activeTasks` feature depends on it.
            // Let's look at `ChatSocket` again.

            // Actually, I can use `getContext` to pass "user_channel" and update backend to also check "source" or update ChatSocket to support "channel".
            // Updating ChatSocket is cleaner.

            // Let's assume I will update ChatSocket to support `getChannel`.
            // For now, I will use a work-around or update `ChatSocket` in the next step if needed.
            // Actually, I can pass `channel=user` by appending it to the rootUrl?
            // `const httpUrl = ${this.rootUrl}/chat/ws?${qs.toString()}`;`
            // If I pass `rootUrl` as `https://api.genie.com?channel=user`, `qs.toString()` will be appended with `&` or `?`?
            // `URLSearchParams` handles it? No, string concatenation.
            // If `rootUrl` has query params, `${rootUrl}/chat/ws` might be weird.

            // Best way: Update ChatSocket to accept `extraParams` or specific `channel` getter.

            // Let's write this provider assuming `ChatSocket` supports `getChannel` or I will add it.
            // I'll add `getChannel` to the constructor options in this file, and then update `ChatSocket` file.

            const socket = new ChatSocket(
                getApiUrl(),
                () => token,
                () => 'user', // chatId - passing 'user' just in case, but backend ignores if channel=user
                () => null, // messageId
                () => null, // model
                () => 'user_channel', // context (source)
                () => 'agent',
                () => null
            );

            // Monkey-patching or extending ChatSocket to send channel=user
            // Since I can't easily modify ChatSocket class instance behavior without changing the class,
            // I will modify `front/src/socket.ts` in a moment to support `channel`.
            // For now, let's proceed with logic.

            socket.setHandlers({
                onMessage: (frame: Frame) => {
                    // We expect 'signal' frames for task updates
                    if (frame.op === 'signal' && frame.payload.type === 'task_updated') {
                        const command = frame.payload.command as any;
                        if (command) {
                            handleTaskUpdate(command);
                        }
                    }
                },
                onUnauthorized: async () => {
                    return await refreshToken();
                },
                onError: (err) => {
                    console.warn('[NotificationContext] Socket error:', err);
                }
            });

            socketRef.current = socket;
            socket.open();
        }

        return () => {
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [token, refreshToken]);

    const handleTaskUpdate = (data: any) => {
        console.log('[NotificationContext] Task Update:', data);
        const task: ActiveTask = {
            id: data.task_id,
            title: data.task_title,
            projectId: data.project_id,
            projectName: data.project_name,
            status: data.new_status,
            updatedAt: data.updated_at
        };

        setActiveTasks(prev => {
            // Remove existing if present
            const filtered = prev.filter(t => t.id !== task.id);
            // Add to top
            return [task, ...filtered];
        });
    };

    const markTaskAsSeen = (taskId: string) => {
        setActiveTasks(prev => prev.filter(t => t.id !== taskId));
    };

    return (
        <NotificationContext.Provider value={{ activeTasks, markTaskAsSeen }}>
            {children}
        </NotificationContext.Provider>
    );
}
