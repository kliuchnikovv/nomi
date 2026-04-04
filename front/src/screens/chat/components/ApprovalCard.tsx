import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { apiClient } from '../../../apiClient';
import { ThemeColors, ThemePalette } from '../../../themes';
import { CheckCircle, Undo } from 'iconoir-react-native';

type Props = {
    taskId: string;
    nextStatus: string;
    onApprove?: () => void;
    onReject?: () => void;
};

const withAlpha = (hex: string, alpha: number) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export default function ApprovalCard({ taskId, nextStatus, onApprove, onReject }: Props) {
    const { theme, palette } = useTheme();
    const [loading, setLoading] = useState(false);
    const [actionTaken, setActionTaken] = useState<'approved' | 'rejected' | null>(null);

    const styles = useMemo(() => createStyles(theme, palette), [theme, palette]);

    const handleApprove = async () => {
        setLoading(true);
        try {
            await apiClient.patch(`/api/project-tasks/${taskId}/status`, { status: nextStatus });
            setActionTaken('approved');
            onApprove?.();
        } catch (error) {
            Alert.alert('Error', 'Failed to approve task. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleReject = async () => {
        setLoading(true);
        try {
            await apiClient.patch(`/api/project-tasks/${taskId}/status`, { status: 'ANALYSIS' });
            setActionTaken('rejected');
            onReject?.();
        } catch (error) {
            Alert.alert('Error', 'Failed to reject task. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (actionTaken === 'approved') {
        return (
            <View style={[styles.container, styles.approvedContainer]}>
                <Text style={styles.statusText}>Approved <CheckCircle width={16} height={16} color={theme.textPrimary} /></Text>
            </View>
        );
    }

    if (actionTaken === 'rejected') {
        return (
            <View style={[styles.container, styles.rejectedContainer]}>
                <Text style={styles.statusText}>Changes Requested <Undo width={16} height={16} color={theme.textPrimary} /></Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Text style={styles.headerText}>Approval Required</Text>
            <View style={styles.buttonContainer}>
                <Pressable
                    style={({ pressed }) => [
                        styles.button,
                        styles.rejectButton,
                        pressed && { opacity: 0.8 },
                    ]}
                    onPress={handleReject}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color={theme.textPrimary} size="small" />
                    ) : (
                        <Text style={styles.buttonText}>Change</Text>
                    )}
                </Pressable>
                <Pressable
                    style={({ pressed }) => [
                        styles.button,
                        styles.approveButton,
                        pressed && { opacity: 0.8 },
                    ]}
                    onPress={handleApprove}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color={theme.textPrimary} size="small" />
                    ) : (
                        <Text style={[styles.buttonText, { color: '#fff' }]}>Approve</Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

const createStyles = (theme: ThemeColors, palette: ThemePalette) => StyleSheet.create({
    container: {
        marginTop: 12,
        padding: 12,
        borderRadius: 12,
        backgroundColor: withAlpha(theme.surfaceHighlight, 0.5),
        borderWidth: 1,
        borderColor: withAlpha(palette.bg, 0.2),
    },
    approvedContainer: {
        backgroundColor: withAlpha(palette.green, 0.1),
        borderColor: withAlpha(palette.green, 0.3),
        alignItems: 'center',
    },
    rejectedContainer: {
        backgroundColor: withAlpha(palette.orange, 0.1),
        borderColor: withAlpha(palette.orange, 0.3),
        alignItems: 'center',
    },
    statusText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.textPrimary,
    },
    headerText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.textSecondary,
        marginBottom: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: 12,
    },
    button: {
        flex: 1,
        height: 40,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    approveButton: {
        backgroundColor: palette.green,
    },
    rejectButton: {
        backgroundColor: withAlpha(palette.bg, 0.5),
        borderWidth: 1,
        borderColor: withAlpha(theme.textSecondary, 0.2),
    },
    buttonText: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.textPrimary,
    },
});
