import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { PlanTask } from '../types';

interface TaskInputViewProps {
    tasks: PlanTask[];
    onTasksChange: (tasks: PlanTask[]) => void;
    onStartPlanning: () => void;
    date: Date;
    onDateChange: (date: Date) => void;
}

function formatDate(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

export function TaskInputView({
    tasks,
    onTasksChange,
    onStartPlanning,
    date,
    onDateChange,
}: TaskInputViewProps) {
    const { theme } = useTheme();
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskLocation, setNewTaskLocation] = useState('');
    const [newTaskDuration, setNewTaskDuration] = useState('');
    const [expandAddForm, setExpandAddForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');

    const handleAddTask = () => {
        const title = newTaskTitle.trim();
        if (!title) return;
        const task: PlanTask = {
            id: generateId(),
            title,
            location: newTaskLocation.trim() || undefined,
            duration_min: newTaskDuration ? parseInt(newTaskDuration, 10) : undefined,
        };
        onTasksChange([...tasks, task]);
        setNewTaskTitle('');
        setNewTaskLocation('');
        setNewTaskDuration('');
        setExpandAddForm(false);
    };

    const handleDeleteTask = (id: string) => {
        onTasksChange(tasks.filter(t => t.id !== id));
    };

    const handleStartEdit = (task: PlanTask) => {
        setEditingId(task.id);
        setEditTitle(task.title);
    };

    const handleSaveEdit = (id: string) => {
        const trimmed = editTitle.trim();
        if (!trimmed) return;
        onTasksChange(tasks.map(t => t.id === id ? { ...t, title: trimmed } : t));
        setEditingId(null);
        setEditTitle('');
    };

    const handleShiftDate = (delta: number) => {
        const next = new Date(date);
        next.setDate(next.getDate() + delta);
        onDateChange(next);
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Date selector */}
            <View style={[styles.dateRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <TouchableOpacity
                    onPress={() => handleShiftDate(-1)}
                    style={styles.dateArrow}
                    activeOpacity={0.7}
                >
                    <Ionicons name="chevron-back" size={20} color={theme.accent} />
                </TouchableOpacity>
                <Text style={[styles.dateText, { color: theme.textPrimary }]}>
                    {formatDate(date)}
                </Text>
                <TouchableOpacity
                    onPress={() => handleShiftDate(1)}
                    style={styles.dateArrow}
                    activeOpacity={0.7}
                >
                    <Ionicons name="chevron-forward" size={20} color={theme.accent} />
                </TouchableOpacity>
            </View>

            {/* Task list */}
            <ScrollView
                style={styles.taskList}
                contentContainerStyle={styles.taskListContent}
                keyboardShouldPersistTaps="handled"
            >
                {tasks.length === 0 && (
                    <Text style={[styles.emptyHint, { color: theme.textSecondary }]}>
                        Add tasks you want to accomplish today
                    </Text>
                )}
                {tasks.map((task) => (
                    <View
                        key={task.id}
                        style={[styles.taskCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    >
                        {editingId === task.id ? (
                            <View style={styles.taskEditRow}>
                                <TextInput
                                    style={[styles.taskEditInput, { color: theme.textPrimary, borderColor: theme.accent }]}
                                    value={editTitle}
                                    onChangeText={setEditTitle}
                                    autoFocus
                                    onSubmitEditing={() => handleSaveEdit(task.id)}
                                    returnKeyType="done"
                                />
                                <TouchableOpacity
                                    onPress={() => handleSaveEdit(task.id)}
                                    style={[styles.saveBtn, { backgroundColor: theme.accent }]}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="checkmark" size={16} color="#fff" />
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.taskRow}>
                                <TouchableOpacity
                                    style={styles.taskInfo}
                                    onPress={() => handleStartEdit(task)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.taskTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                                        {task.title}
                                    </Text>
                                    {(task.location || task.duration_min) && (
                                        <Text style={[styles.taskMeta, { color: theme.textSecondary }]}>
                                            {[
                                                task.location,
                                                task.duration_min ? `${task.duration_min} min` : undefined,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => handleDeleteTask(task.id)}
                                    style={styles.deleteBtn}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="trash-outline" size={18} color={theme.textSecondary} />
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                ))}
            </ScrollView>

            {/* Add task form */}
            <View style={[styles.addSection, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                <View style={styles.addTitleRow}>
                    <TextInput
                        style={[styles.addInput, { color: theme.textPrimary }]}
                        placeholder="Add a task..."
                        placeholderTextColor={theme.textSecondary}
                        value={newTaskTitle}
                        onChangeText={setNewTaskTitle}
                        onFocus={() => setExpandAddForm(true)}
                        returnKeyType="next"
                    />
                    <TouchableOpacity
                        onPress={() => setExpandAddForm(prev => !prev)}
                        activeOpacity={0.7}
                        style={styles.expandBtn}
                    >
                        <Ionicons
                            name={expandAddForm ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.textSecondary}
                        />
                    </TouchableOpacity>
                </View>
                {expandAddForm && (
                    <View style={styles.addExtras}>
                        <TextInput
                            style={[styles.addInputSmall, { color: theme.textPrimary, borderColor: theme.border }]}
                            placeholder="Location (optional)"
                            placeholderTextColor={theme.textSecondary}
                            value={newTaskLocation}
                            onChangeText={setNewTaskLocation}
                        />
                        <TextInput
                            style={[styles.addInputSmall, { color: theme.textPrimary, borderColor: theme.border }]}
                            placeholder="Duration in minutes (optional)"
                            placeholderTextColor={theme.textSecondary}
                            value={newTaskDuration}
                            onChangeText={setNewTaskDuration}
                            keyboardType="numeric"
                        />
                        <TouchableOpacity
                            onPress={handleAddTask}
                            style={[
                                styles.addBtn,
                                { backgroundColor: newTaskTitle.trim() ? theme.accent : theme.border },
                            ]}
                            disabled={!newTaskTitle.trim()}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="add" size={18} color="#fff" />
                            <Text style={styles.addBtnText}>Add Task</Text>
                        </TouchableOpacity>
                    </View>
                )}
                {!expandAddForm && newTaskTitle.trim() !== '' && (
                    <TouchableOpacity
                        onPress={handleAddTask}
                        style={[styles.quickAddBtn, { backgroundColor: theme.accent }]}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="add" size={16} color="#fff" />
                    </TouchableOpacity>
                )}
            </View>

            {/* Start Planning button */}
            <TouchableOpacity
                onPress={onStartPlanning}
                disabled={tasks.length === 0}
                activeOpacity={0.8}
                style={[
                    styles.startBtn,
                    {
                        backgroundColor: tasks.length > 0 ? theme.accent : theme.border,
                    },
                ]}
            >
                <Ionicons name="sparkles" size={18} color="#fff" />
                <Text style={styles.startBtnText}>Start Planning</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
        gap: 12,
    },
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderRadius: 12,
        borderWidth: 1,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    dateArrow: {
        padding: 4,
    },
    dateText: {
        fontSize: 16,
        fontWeight: '600',
    },
    taskList: {
        flex: 1,
    },
    taskListContent: {
        gap: 8,
        paddingBottom: 8,
    },
    emptyHint: {
        textAlign: 'center',
        fontSize: 14,
        paddingVertical: 24,
    },
    taskCard: {
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    taskRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    taskInfo: {
        flex: 1,
        gap: 2,
    },
    taskTitle: {
        fontSize: 15,
        fontWeight: '500',
    },
    taskMeta: {
        fontSize: 12,
    },
    deleteBtn: {
        padding: 4,
    },
    taskEditRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    taskEditInput: {
        flex: 1,
        fontSize: 15,
        borderBottomWidth: 1,
        paddingVertical: 4,
    },
    saveBtn: {
        width: 28,
        height: 28,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    addSection: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        gap: 8,
    },
    addTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    addInput: {
        flex: 1,
        fontSize: 15,
    },
    expandBtn: {
        padding: 4,
    },
    quickAddBtn: {
        width: 28,
        height: 28,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'flex-end',
    },
    addExtras: {
        gap: 8,
    },
    addInputSmall: {
        fontSize: 14,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: 10,
        paddingVertical: 10,
    },
    addBtnText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
    startBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 14,
        paddingVertical: 14,
    },
    startBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
});
