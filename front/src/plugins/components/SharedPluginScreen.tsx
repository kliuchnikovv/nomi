import React from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'iconoir-react-native';
import { useTheme } from '@genie/front/context/ThemeContext';

interface SharedPluginScreenProps {
    title: string;
    onClose?: (closeSidebar?: boolean) => void;
    children: React.ReactNode;
}

export function SharedPluginScreen({
    title,
    onClose,
    children,
}: SharedPluginScreenProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View
                style={[
                    styles.header,
                    { paddingTop: insets.top + 10, borderBottomColor: theme.border },
                ]}
            >
                <View style={styles.headerRow}>
                    <Pressable
                        onPress={onClose}
                        hitSlop={12}
                        style={styles.backButton}
                        disabled={!onClose}
                    >
                        {onClose && (
                            <ArrowLeft width={24} height={24} color={theme.text} />
                        )}
                    </Pressable>
                    <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                        {title}
                    </Text>
                    <View style={styles.backButton} />
                </View>
            </View>

            <View style={styles.content}>
                {children}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    backButton: {
        width: 36,
        alignItems: 'flex-start',
    },
    title: {
        flex: 1,
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
    },
    content: {
        flex: 1,
    },
});
