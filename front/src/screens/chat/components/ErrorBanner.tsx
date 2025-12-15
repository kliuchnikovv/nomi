import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { XmarkCircle, RefreshDouble } from 'iconoir-react-native';

interface ErrorBannerProps {
    error: string | null;
    onRetry: () => void;
    onDismiss: () => void;
    theme: any;
}

export function ErrorBanner({ error, onRetry, onDismiss, theme }: ErrorBannerProps) {
    if (!error) return null;

    return (
        <View style={[styles.container, { backgroundColor: theme.errorBackground }]}>
            <View style={styles.content}>
                <Text style={[styles.errorText, { color: theme.errorText }]} numberOfLines={2}>
                    {error}
                </Text>
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[styles.button, styles.retryButton, { backgroundColor: theme.errorButtonBackground }]}
                        onPress={onRetry}
                        activeOpacity={0.7}
                    >
                        <RefreshDouble width={16} height={16} color={theme.errorButtonText} />
                        <Text style={[styles.buttonText, { color: theme.errorButtonText }]}>
                            Повторить
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.dismissButton}
                        onPress={onDismiss}
                        activeOpacity={0.7}
                    >
                        <XmarkCircle width={20} height={20} color={theme.errorText} />
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.1)',
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    errorText: {
        flex: 1,
        fontSize: 14,
        lineHeight: 20,
        marginRight: 12,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
    },
    retryButton: {
        // Additional retry button styles
    },
    buttonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    dismissButton: {
        padding: 4,
    },
});
