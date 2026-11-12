import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { XmarkCircle, RefreshDouble } from 'iconoir-react-native';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';

interface ErrorBannerProps {
    error: string | null;
    onRetry: () => void;
    onDismiss: () => void;
    theme: any;
    onChangeModel?: () => void;
}

export function ErrorBanner({
    error,
    onRetry,
    onDismiss,
    theme,
    onChangeModel,
}: ErrorBannerProps) {
    const { effects, descriptor } = useTheme();
    if (!error) return null;

    const glassButton = {
        backgroundColor:
            effects?.glassBackground ?? 'rgba(255, 255, 255, 0.06)',
        borderColor: effects?.glassBorderColor ?? 'rgba(255, 255, 255, 0.10)',
        ...(effects?.buttonShadowRaised ?? {}),
    };

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor:
                        effects?.glassBackground ?? 'rgba(255, 255, 255, 0.06)',
                    borderTopColor:
                        effects?.glassBorderColor ??
                        'rgba(255, 255, 255, 0.10)',
                    borderLeftColor: theme.errorText,
                },
            ]}
        >
            <View style={styles.content}>
                <Text
                    theme={descriptor}
                    variant="body"
                    style={[styles.errorText, { color: theme.errorText }]}
                    numberOfLines={2}
                >
                    {error}
                </Text>
                <View style={styles.actions}>
                    <TouchableOpacity
                        style={[styles.button, glassButton]}
                        onPress={onRetry}
                        activeOpacity={0.7}
                    >
                        <RefreshDouble
                            width={16}
                            height={16}
                            color={theme.errorText}
                        />
                        <Text
                            theme={descriptor}
                            variant="body"
                            weight="600"
                            style={[
                                styles.buttonText,
                                { color: theme.errorText },
                            ]}
                        >
                            Retry
                        </Text>
                    </TouchableOpacity>
                    {onChangeModel && (
                        <TouchableOpacity
                            style={[styles.button, glassButton]}
                            onPress={onChangeModel}
                            activeOpacity={0.7}
                        >
                            <Text
                                theme={descriptor}
                                variant="body"
                                weight="600"
                                style={[
                                    styles.buttonText,
                                    { color: theme.textPrimary },
                                ]}
                            >
                                Change model
                            </Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity
                        style={styles.dismissButton}
                        onPress={onDismiss}
                        activeOpacity={0.7}
                    >
                        <XmarkCircle
                            width={20}
                            height={20}
                            color={theme.textSecondary}
                        />
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
        borderLeftWidth: 3,
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
        borderRadius: 12,
        borderWidth: 1,
    },
    buttonText: {
        fontSize: 14,
        fontWeight: '600',
    },
    dismissButton: {
        padding: 4,
    },
});
