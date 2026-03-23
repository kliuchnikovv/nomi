import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../auth/context';
import { socket } from '../../socket';
import { getApiUrl } from '../../config';
import { apiClient } from '../../apiClient';
import { PlanTask, DayPlan } from './types';
import { TaskInputView } from './components/TaskInputView';
import { PlanTimelineView } from './components/PlanTimelineView';
import { createPlanningSession, getPlanningState } from '../../services/planningApi';

type Phase = 'input' | 'planning' | 'active';

export interface PlannerScreenProps {
    onClose?: (closeSidebar?: boolean) => void;
}

function generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatDateISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
}

export function PlannerScreen({ onClose }: PlannerScreenProps = {}) {
    const { theme } = useTheme();
    const { user, token } = useAuth();
    const insets = useSafeAreaInsets();

    const [phase, setPhase] = useState<Phase>('input');
    const [tasks, setTasks] = useState<PlanTask[]>([]);
    const [planDate, setPlanDate] = useState(new Date());
    const [chatId, setChatId] = useState<string | null>(null);
    const [plan, setPlan] = useState<DayPlan | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputText, setInputText] = useState('');
    const [isWorking, setIsWorking] = useState(false);
    const [timelineCollapsed, setTimelineCollapsed] = useState(true);
    const [sessionLoading, setSessionLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const messagesScrollRef = useRef<ScrollView>(null);
    const pendingMsgRef = useRef<string | null>(null);

    // ---- WebSocket frame handling ----
    const handleFrame = useCallback((frame: any) => {
        const { kind, op, payload } = frame;

        if (op === 'done') {
            setIsWorking(false);
            return;
        }

        if (kind === 'error') {
            setIsWorking(false);
            setError(payload?.message || 'Something went wrong');
            return;
        }

        if (!payload) return;

        // Accumulate text tokens into the latest assistant message
        if (payload.type === 'text' && payload.message) {
            setMessages(prev => {
                if (prev.length > 0 && prev[prev.length - 1].role === 'assistant') {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                        ...updated[updated.length - 1],
                        text: updated[updated.length - 1].text + payload.message,
                    };
                    return updated;
                }
                return [
                    ...prev,
                    { id: generateId(), role: 'assistant', text: payload.message },
                ];
            });
        }

        // Plan data embedded in a frame (custom type from backend)
        if (payload.type === 'plan_update' && payload.plan) {
            const incoming: DayPlan = payload.plan;
            setPlan(incoming);
            if (incoming.status === 'committed') {
                setPhase('active');
                setTimelineCollapsed(false);
            } else if (incoming.status === 'review') {
                setTimelineCollapsed(false);
            }
        }
    }, []);

    // ---- Connect socket when chatId is set ----
    useEffect(() => {
        if (!chatId || !token) return;

        socket.setChatId(chatId);
        socket.setChannel('chat');
        socket.setHandlers({
            onMessage: handleFrame,
            onDone: handleFrame,
            onError: (err) => {
                console.error('[PlannerScreen] socket error', err);
                setIsWorking(false);
                setError('Connection error');
            },
            onReconnect: () => {
                // Poll plan state on reconnect
                getPlanningState(chatId).then(p => {
                    if (p) setPlan(p);
                });
            },
        });
        socket.connect();

        return () => {
            socket.setHandlers({});
        };
    }, [chatId, token, handleFrame]);

    // ---- Poll plan state when in planning phase ----
    useEffect(() => {
        if (!chatId || phase !== 'planning') return;
        const timer = setInterval(async () => {
            const p = await getPlanningState(chatId);
            if (p) {
                setPlan(p);
                if (p.status === 'committed') {
                    setPhase('active');
                    setTimelineCollapsed(false);
                    clearInterval(timer);
                }
            }
        }, 4000);
        return () => clearInterval(timer);
    }, [chatId, phase]);

    // ---- Start planning session ----
    const handleStartPlanning = useCallback(async () => {
        if (tasks.length === 0) return;
        setSessionLoading(true);
        setError(null);
        try {
            const dateStr = formatDateISO(planDate);
            const id = await createPlanningSession(dateStr, tasks);
            setChatId(id);
            setPhase('planning');
            setMessages([]);
        } catch (e: any) {
            setError(e?.message || 'Failed to start planning session');
        } finally {
            setSessionLoading(false);
        }
    }, [tasks, planDate]);

    // ---- Send a message ----
    const handleSendMessage = useCallback(async (text: string) => {
        const trimmed = text.trim();
        if (!trimmed || !chatId || !user) return;

        setInputText('');
        setIsWorking(true);
        setError(null);

        const userMsg: ChatMessage = { id: generateId(), role: 'user', text: trimmed };
        setMessages(prev => [...prev, userMsg]);

        // Create message on server, then send over socket
        try {
            const created = await apiClient.post<{ id: string }>(
                `${getApiUrl()}/chats/${chatId}/messages`,
                {
                    chat_id: chatId,
                    role: 'user',
                    text: trimmed,
                    model: 'gpt-5-nano',
                },
            );
            const messageId = created?.id;
            const sessionId = `planner-${Date.now()}`;

            socket.sendMessage(
                trimmed,
                chatId,
                sessionId,
                messageId,
                undefined, // attachmentIDs
                undefined, // webSearch
                undefined, // thinking
                'user',
                undefined, // model
                undefined, // provider
                undefined, // tools
                user.id,
                undefined, // endpoint
                token ?? undefined,
            );
        } catch (e: any) {
            setIsWorking(false);
            setError(e?.message || 'Failed to send message');
        }
    }, [chatId, user, token]);

    // ---- Approve plan ----
    const handleApprove = useCallback(() => {
        handleSendMessage('Approve the plan and save to my reminders.');
    }, [handleSendMessage]);

    // ---- Report change ----
    const handleRequestChange = useCallback((change: string) => {
        handleSendMessage(change);
    }, [handleSendMessage]);

    // ---- Scroll to bottom on new messages ----
    useEffect(() => {
        if (messages.length > 0) {
            setTimeout(() => {
                messagesScrollRef.current?.scrollToEnd({ animated: true });
            }, 100);
        }
    }, [messages]);

    const styles = createStyles(theme);

    // ==================== PHASE: INPUT ====================
    if (phase === 'input') {
        return (
            <KeyboardAvoidingView
                style={{ flex: 1, backgroundColor: theme.background }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    {onClose && (
                        <TouchableOpacity onPress={() => onClose()} style={styles.backBtn} activeOpacity={0.7}>
                            <Ionicons name="chevron-back" size={22} color={theme.accent} />
                        </TouchableOpacity>
                    )}
                    <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Plan My Day</Text>
                </View>
                {error && (
                    <View style={[styles.errorBanner, { backgroundColor: theme.error ?? '#c0392b' }]}>
                        <Text style={styles.errorText}>{error}</Text>
                        <TouchableOpacity onPress={() => setError(null)}>
                            <Ionicons name="close" size={16} color="#fff" />
                        </TouchableOpacity>
                    </View>
                )}
                {sessionLoading ? (
                    <View style={styles.loadingCenter}>
                        <ActivityIndicator size="large" color={theme.accent} />
                        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
                            Creating planning session...
                        </Text>
                    </View>
                ) : (
                    <TaskInputView
                        tasks={tasks}
                        onTasksChange={setTasks}
                        onStartPlanning={handleStartPlanning}
                        date={planDate}
                        onDateChange={setPlanDate}
                    />
                )}
            </KeyboardAvoidingView>
        );
    }

    // ==================== PHASE: ACTIVE ====================
    if (phase === 'active' && plan) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.background, paddingBottom: insets.bottom }}>
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    {onClose && (
                        <TouchableOpacity onPress={() => onClose()} style={styles.backBtn} activeOpacity={0.7}>
                            <Ionicons name="chevron-back" size={22} color={theme.accent} />
                        </TouchableOpacity>
                    )}
                    <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Today's Plan</Text>
                </View>
                <PlanTimelineView
                    plan={plan}
                    onApprove={handleApprove}
                    onRequestChange={handleRequestChange}
                />
            </View>
        );
    }

    // ==================== PHASE: PLANNING ====================
    return (
        <KeyboardAvoidingView
            style={{ flex: 1, backgroundColor: theme.background }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={insets.top}
        >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: theme.border }]}>
                {onClose && (
                    <TouchableOpacity onPress={() => onClose()} style={styles.backBtn} activeOpacity={0.7}>
                        <Ionicons name="chevron-back" size={22} color={theme.accent} />
                    </TouchableOpacity>
                )}
                <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Planning...</Text>
                {isWorking && (
                    <ActivityIndicator size="small" color={theme.accent} style={{ marginLeft: 8 }} />
                )}
            </View>

            {/* Error banner */}
            {error && (
                <View style={[styles.errorBanner, { backgroundColor: theme.error ?? '#c0392b' }]}>
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity onPress={() => setError(null)}>
                        <Ionicons name="close" size={16} color="#fff" />
                    </TouchableOpacity>
                </View>
            )}

            {/* Chat messages */}
            <ScrollView
                ref={messagesScrollRef}
                style={styles.messageList}
                contentContainerStyle={styles.messageListContent}
                keyboardShouldPersistTaps="handled"
            >
                {messages.map((msg) => (
                    <View
                        key={msg.id}
                        style={[
                            styles.messageBubble,
                            msg.role === 'user' ? styles.userBubble : styles.assistantBubble,
                            {
                                backgroundColor:
                                    msg.role === 'user'
                                        ? theme.accent
                                        : theme.surface,
                                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.messageText,
                                {
                                    color: msg.role === 'user' ? '#fff' : theme.textPrimary,
                                },
                            ]}
                        >
                            {msg.text}
                        </Text>
                    </View>
                ))}
                {isWorking && messages.length === 0 && (
                    <View style={[styles.messageBubble, styles.assistantBubble, { backgroundColor: theme.surface, alignSelf: 'flex-start' }]}>
                        <ActivityIndicator size="small" color={theme.accent} />
                    </View>
                )}
            </ScrollView>

            {/* Collapsible timeline */}
            {plan && (
                <View style={[styles.timelinePanel, { borderTopColor: theme.border, backgroundColor: theme.background }]}>
                    <TouchableOpacity
                        style={[styles.timelineToggle, { borderBottomColor: theme.border }]}
                        onPress={() => setTimelineCollapsed(prev => !prev)}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="calendar-outline" size={16} color={theme.accent} />
                        <Text style={[styles.timelineToggleText, { color: theme.textPrimary }]}>
                            Day Plan
                        </Text>
                        <View style={[styles.statusBadge, { backgroundColor: theme.surface }]}>
                            <Text style={[styles.statusBadgeText, { color: theme.textSecondary }]}>
                                {plan.status}
                            </Text>
                        </View>
                        <Ionicons
                            name={timelineCollapsed ? 'chevron-up' : 'chevron-down'}
                            size={16}
                            color={theme.textSecondary}
                            style={{ marginLeft: 'auto' }}
                        />
                    </TouchableOpacity>

                    {!timelineCollapsed && (
                        <View style={styles.timelineContent}>
                            <PlanTimelineView
                                plan={plan}
                                onApprove={handleApprove}
                                onRequestChange={handleRequestChange}
                            />
                        </View>
                    )}
                </View>
            )}

            {/* Input bar */}
            <View style={[styles.inputBar, { borderTopColor: theme.border, backgroundColor: theme.surface, paddingBottom: insets.bottom || 8 }]}>
                <TextInput
                    style={[styles.textInput, { color: theme.textPrimary }]}
                    placeholder="Type a message..."
                    placeholderTextColor={theme.textSecondary}
                    value={inputText}
                    onChangeText={setInputText}
                    multiline
                    maxLength={2000}
                    returnKeyType="send"
                    onSubmitEditing={() => handleSendMessage(inputText)}
                />
                <TouchableOpacity
                    onPress={() => handleSendMessage(inputText)}
                    disabled={!inputText.trim() || isWorking}
                    activeOpacity={0.7}
                    style={[
                        styles.sendButton,
                        {
                            backgroundColor:
                                inputText.trim() && !isWorking ? theme.accent : theme.border,
                        },
                    ]}
                >
                    <Ionicons name="arrow-up" size={18} color="#fff" />
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

function createStyles(theme: any) {
    return StyleSheet.create({
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 14,
            borderBottomWidth: 1,
            gap: 8,
        },
        headerTitle: {
            fontSize: 18,
            fontWeight: '700',
            flex: 1,
        },
        backBtn: {
            padding: 2,
        },
        errorBanner: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingVertical: 10,
        },
        errorText: {
            color: '#fff',
            fontSize: 14,
            flex: 1,
        },
        loadingCenter: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            gap: 12,
        },
        loadingText: {
            fontSize: 14,
        },
        messageList: {
            flex: 1,
        },
        messageListContent: {
            padding: 16,
            gap: 8,
        },
        messageBubble: {
            maxWidth: '80%',
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 8,
        },
        userBubble: {
            borderBottomRightRadius: 4,
        },
        assistantBubble: {
            borderBottomLeftRadius: 4,
        },
        messageText: {
            fontSize: 15,
            lineHeight: 22,
        },
        timelinePanel: {
            borderTopWidth: 1,
            maxHeight: 380,
        },
        timelineToggle: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 8,
            borderBottomWidth: 1,
        },
        timelineToggleText: {
            fontSize: 14,
            fontWeight: '600',
        },
        statusBadge: {
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 2,
        },
        statusBadgeText: {
            fontSize: 11,
            fontWeight: '500',
        },
        timelineContent: {
            flex: 1,
        },
        inputBar: {
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingHorizontal: 12,
            paddingTop: 8,
            gap: 8,
            borderTopWidth: 1,
        },
        textInput: {
            flex: 1,
            fontSize: 15,
            maxHeight: 100,
            minHeight: 36,
        },
        sendButton: {
            width: 34,
            height: 34,
            borderRadius: 17,
            justifyContent: 'center',
            alignItems: 'center',
        },
    });
}
