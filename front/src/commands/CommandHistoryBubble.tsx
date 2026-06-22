import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { NavArrowDown } from 'iconoir-react-native';
import { useTheme } from '../context/ThemeContext';
import { CommandRegistry } from './CommandRegistry';

interface CommandHistoryBubbleProps {
    meta?: {
        command_call?: boolean;
        name?: string;
        args?: Record<string, any>;
    };
}

function withAlpha(hex: string, alpha: number): string {
    if (!hex || hex[0] !== '#') return hex;
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
        .toString(16)
        .padStart(2, '0');
    if (hex.length === 7) return hex + a;
    if (hex.length === 4) {
        const r = hex[1];
        const g = hex[2];
        const b = hex[3];
        return `#${r}${r}${g}${g}${b}${b}${a}`;
    }
    return hex;
}

function renderArgValue(value: unknown): string {
    if (value === null || value === undefined) return '∅';
    if (typeof value === 'string') {
        return value.length > 200 ? value.slice(0, 197) + '…' : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        const json = JSON.stringify(value, null, 2);
        return json.length > 400 ? json.slice(0, 397) + '…' : json;
    } catch {
        return String(value);
    }
}

export const CommandHistoryBubble: React.FC<CommandHistoryBubbleProps> = ({
    meta,
}) => {
    const { theme, palette } = useTheme() as any;
    const [expanded, setExpanded] = useState(false);
    const [, force] = useState(0);

    const commandName = meta?.name || 'command';
    const spec = CommandRegistry.get(commandName);
    const title = spec?.title || commandName;

    // Lazy-load the registry if the cache is cold so the title becomes
    // human-readable as soon as the API responds.
    useEffect(() => {
        if (spec) return;
        let cancelled = false;
        CommandRegistry.load()
            .then(() => {
                if (!cancelled) force(x => x + 1);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [spec, commandName]);

    const accent = palette?.orange || '#f5a623';
    const styles = useMemo(
        () =>
            StyleSheet.create({
                container: {
                    marginVertical: 6,
                    backgroundColor: withAlpha(accent, 0.08),
                    borderRadius: 8,
                    overflow: 'hidden',
                },
                header: {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                },
                headerLeft: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    flexShrink: 1,
                },
                title: {
                    color: accent,
                    fontSize: 12,
                    fontWeight: '600',
                    marginLeft: 6,
                    flexShrink: 1,
                },
                content: {
                    paddingHorizontal: 10,
                    paddingBottom: 8,
                    paddingTop: 2,
                },
                argRow: {
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    marginTop: 4,
                },
                argKey: {
                    color: theme.textSecondary,
                    fontSize: 12,
                    fontWeight: '600',
                    marginRight: 6,
                },
                argValue: {
                    color: theme.textPrimary || theme.text,
                    fontSize: 12,
                    lineHeight: 16,
                    flexShrink: 1,
                },
                empty: {
                    color: theme.textSecondary,
                    fontSize: 12,
                    fontStyle: 'italic',
                },
            }),
        [accent, theme],
    );

    const args = meta?.args ?? {};
    const argEntries = Object.entries(args);

    return (
        <View style={styles.container}>
            <Pressable
                onPress={() => setExpanded(e => !e)}
                style={({ pressed }) => [
                    styles.header,
                    pressed && { opacity: 0.7 },
                ]}
            >
                <View style={styles.headerLeft}>
                    <MaterialCommunityIcons
                        name="slash-forward"
                        size={14}
                        color={accent}
                    />
                    <Text style={styles.title} numberOfLines={1}>
                        {title}
                    </Text>
                </View>
                <NavArrowDown
                    width={12}
                    height={12}
                    color={theme.textSecondary}
                    style={{
                        transform: [{ rotate: expanded ? '0deg' : '-90deg' }],
                    }}
                />
            </Pressable>
            {expanded && (
                <View style={styles.content}>
                    {argEntries.length === 0 ? (
                        <Text style={styles.empty}>(no arguments)</Text>
                    ) : (
                        argEntries.map(([key, value]) => (
                            <View key={key} style={styles.argRow}>
                                <Text style={styles.argKey}>{key}:</Text>
                                <Text style={styles.argValue}>
                                    {renderArgValue(value)}
                                </Text>
                            </View>
                        ))
                    )}
                </View>
            )}
        </View>
    );
};
