import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../screens/auth/context';
import { getApiUrl } from '../config';
import { ChatSocket } from '../socket';
import { Frame } from '../screens/main/models';
import { projectTasksApi } from '../apiClient';

type TaskStatus = 'BACKLOG' | 'ANALYSIS' | 'PLANNING' | 'CODING' | 'REVIEW' | 'VERIFY' | 'DONE' | 'CANCELLED';

export interface ActiveTask {
    id: string;
    title: string;
    projectId: string;
    projectName: string;
    status: TaskStatus;
    updatedAt: string;
    artifacts?: any;
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
            // Dedicated socket for user notifications (channel=user)
            const socket = new ChatSocket();
            socket.setToken(token);
            socket.setChannel('user');
            socket.setChatId(null);

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
            socket.connect();
        }

        return () => {
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [token, refreshToken]);

    useEffect(() => {
        if (token) {
            loadInitialTasks();
        } else {
            setActiveTasks([]);
        }
    }, [token]);

    const loadInitialTasks = async () => {
        try {
            const tasks = await projectTasksApi.getActiveTasks();
            if (tasks) {
                setActiveTasks(tasks.map(t => ({
                    id: t.id,
                    title: t.title,
                    projectId: t.project_id,
                    projectName: t.project_name,
                    status: t.status,
                    updatedAt: t.updated_at,
                    artifacts: (t as any).artifacts
                })));
            }
        } catch (err) {
            console.warn('[NotificationContext] Failed to load initial tasks:', err);
        }
    };

    const handleTaskUpdate = (data: any) => {
        console.log('[NotificationContext] Task Update:', data);
        const task: ActiveTask = {
            id: data.task_id,
            title: data.task_title,
            projectId: data.project_id,
            projectName: data.project_name,
            status: data.new_status,
            updatedAt: data.updated_at,
            artifacts: data.artifacts
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
