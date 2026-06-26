import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CommandRegistry } from './CommandRegistry';
import type { CommandSpec } from './types';
import { useTheme } from '../context/ThemeContext';

export interface CommandAutocompleteProps {
  /** The text after the leading slash, e.g. "" or "plan" */
  query: string;
  onPick: (spec: CommandSpec) => void;
}

export function CommandAutocomplete({ query, onPick }: CommandAutocompleteProps) {
  const { theme } = useTheme();
  const [all, setAll] = useState<CommandSpec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    CommandRegistry.load()
      .then((specs) => {
        if (!cancelled) setAll(specs);
      })
      .catch(() => {
        if (!cancelled) setAll([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = all.filter((s) => {
    if (s.surface === 'background') return false;
    if (!query) return true;
    return (
      s.name.toLowerCase().includes(query.toLowerCase()) ||
      s.title.toLowerCase().includes(query.toLowerCase())
    );
  });

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ActivityIndicator size="small" color={theme.accent} style={styles.loader} />
      </View>
    );
  }

  if (filtered.length === 0) return null;

  return (
    <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.name}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const disabled = item.missing.length > 0;
          return (
            <Pressable
              onPress={() => { if (!disabled) onPick(item); }}
              style={({ pressed }) => [
                styles.item,
                pressed && !disabled && { backgroundColor: theme.background },
              ]}
              accessibilityRole="button"
              accessibilityLabel={item.title}
              accessibilityState={{ disabled }}
            >
              <View style={styles.itemRow}>
                <Text
                  style={[
                    styles.name,
                    { color: disabled ? theme.textSecondary : theme.text },
                  ]}
                >
                  /{item.name}
                </Text>
                {item.usage ? (
                  <Text
                    style={[styles.usage, { color: theme.textSecondary }]}
                    numberOfLines={1}
                  >
                    {item.usage}
                  </Text>
                ) : null}
                {disabled && (
                  <View style={[styles.missingBadge, { backgroundColor: theme.border }]}>
                    <Text style={[styles.missingText, { color: theme.textSecondary }]}>
                      needs {item.missing.join(', ')}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.description,
                  { color: disabled ? theme.textSecondary : theme.textSecondary },
                ]}
                numberOfLines={1}
              >
                {item.description}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 8,
    marginBottom: 4,
    maxHeight: 220,
    overflow: 'hidden',
  },
  loader: {
    margin: 12,
  },
  item: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
  },
  usage: {
    fontSize: 12,
    flexShrink: 1,
  },
  description: {
    fontSize: 12,
    marginTop: 2,
  },
  missingBadge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  missingText: {
    fontSize: 11,
  },
});
