import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { useAnimatedStyle, withRepeat, withSequence, withTiming, useSharedValue, withDelay } from 'react-native-reanimated';
import { useTheme } from '../../context/ThemeContext';
import { ActiveTask } from '../../context/NotificationContext';
import { Check, Code, DesignNib, Eye, Glasses, StatsReport } from 'iconoir-react-native';

interface Props {
    task: ActiveTask;
    onDismiss: (id: string) => void;
}

export function ActiveTaskCard({ task, onDismiss }: Props) {
    const { theme, palette } = useTheme();
    const isDone = task.status === 'DONE';

    // Animation for pulse effect
    const opacity = useSharedValue(1);

    useEffect(() => {
        if (!isDone) {
            opacity.value = withRepeat(
                withSequence(
                    withTiming(0.6, { duration: 1000 }),
                    withTiming(1, { duration: 1000 })
                ),
                -1,
                true
            );
        } else {
            opacity.value = 1;
            // Auto dismiss after 5 seconds if done
            const timer = setTimeout(() => {
                onDismiss(task.id);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [isDone, opacity, task.id, onDismiss]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value
    }));

    const getStatusConfig = () => {
        switch (task.status) {
            case 'ANALYSIS':
                return { label: 'Analyzing Requirements...', icon: StatsReport, color: palette.blue };
            case 'PLANNING':
                return { label: 'Designing Architecture...', icon: DesignNib, color: palette.purple };
            case 'CODING':
                return { label: 'Jules is Coding...', icon: Code, color: palette.orange };
            case 'REVIEW':
                return { label: 'Security Review...', icon: Eye, color: palette.yellow };
            case 'VERIFY':
                return { label: 'Final Verification...', icon: Check, color: palette.green };
            case 'DONE':
                return { label: 'Ready to Merge', icon: Check, color: palette.green };
            default:
                return { label: 'Pending...', icon: StatsReport, color: theme.textSecondary };
        }
    };

    const config = getStatusConfig();
    const Icon = config.icon;

    // Parse Implementation Steps if available
    const steps = task.artifacts?.ArchitectPlan?.steps || [];

    const getStepIcon = (status?: string) => {
        switch (status) {
            case 'completed': return '🟢';
            case 'failed': return '🔴';
            case 'in_progress': return '🟡';
            default: return '⚪'; // pending
        }
    };

    return (
        <Animated.View style={[styles.container, { backgroundColor: theme.card, borderColor: isDone ? palette.green : theme.border }, animatedStyle]}>
            <View>
                <View style={styles.header}>
                    <Text style={[styles.projectName, { color: theme.textSecondary }]}>{task.projectName}</Text>
                    {isDone && <Check width={16} height={16} color={palette.green} />}
                </View>
                <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>{task.title}</Text>
            </View>

            {steps.length > 0 && (
                <View style={styles.stepsContainer}>
                    {steps.map((step: any, index: number) => (
                        <View key={index} style={styles.stepRow}>
                            <Text style={styles.stepIcon}>{getStepIcon(step.status)}</Text>
                            <Text style={[styles.stepText, { color: theme.textSecondary }]} numberOfLines={1}>
                                {step.description || step.file_path}
                            </Text>
                        </View>
                    ))}
                </View>
            )}

            <View style={[styles.statusContainer, { backgroundColor: `${config.color}15` }]}>
                <Icon width={14} height={14} color={config.color} style={{ marginRight: 6 }} />
                <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 200,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        marginRight: 12,
        justifyContent: 'space-between',
        minHeight: 120
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4
    },
    projectName: {
        fontSize: 10,
        fontWeight: '600',
        textTransform: 'uppercase'
    },
    title: {
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 8
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 6,
        alignSelf: 'flex-start'
    },
    statusText: {
        fontSize: 11,
        fontWeight: '600'
    },
    stepsContainer: {
        marginVertical: 8,
        flex: 1
    },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4
    },
    stepIcon: {
        fontSize: 10,
        marginRight: 6
    },
    stepText: {
        fontSize: 10,
        flex: 1
    }
});
