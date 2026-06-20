import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { CommandRegistry } from './CommandRegistry';

interface CommandHistoryBubbleProps {
  meta?: {
    command_call?: boolean;
    name?: string;
    args?: Record<string, any>;
  };
}

/**
 * Summarizes command arguments into a single-line preview.
 * Returns first scalar value truncated to ~80 chars, or empty if no args.
 */
function summarizeArgs(args?: Record<string, any>): string {
  if (!args || typeof args !== 'object') return '';

  // Find first scalar value
  for (const [, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      return value.length > 80 ? value.substring(0, 77) + '...' : value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
  }
  return '';
}

export const CommandHistoryBubble: React.FC<CommandHistoryBubbleProps> = ({
  meta,
}) => {
  const { theme } = useTheme();

  const { title, summary } = useMemo(() => {
    const commandName = meta?.name || 'Unknown';
    const commandSpec = CommandRegistry.get(commandName);
    const commandTitle = commandSpec?.title || commandName;
    const commandSummary = summarizeArgs(meta?.args);

    return {
      title: commandTitle,
      summary: commandSummary,
    };
  }, [meta?.name, meta?.args]);

  const styles = StyleSheet.create({
    container: {
      backgroundColor: theme.surface || '#f0f0f0',
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginVertical: 4,
      marginHorizontal: 8,
      borderLeftWidth: 3,
      borderLeftColor: theme.accent || '#007AFF',
      maxWidth: '90%',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    emoji: {
      fontSize: 16,
      marginRight: 6,
    },
    title: {
      color: theme.text || '#000',
      fontSize: 14,
      fontWeight: '600',
      flex: 1,
    },
    summary: {
      color: theme.textSecondary || '#666',
      fontSize: 12,
      marginTop: 4,
      lineHeight: 16,
    },
  });

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.emoji}>🛠</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      {summary ? <Text style={styles.summary}>{summary}</Text> : null}
    </View>
  );
};
