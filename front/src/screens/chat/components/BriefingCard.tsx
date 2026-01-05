import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { briefingGenerator } from '../../../services/briefing/BriefingGenerator';
import {
  integrationStorage,
  Briefing,
  BriefingItem,
  SuggestedAction
} from '../../../services/integrations/IntegrationStorage';

const getSourceDetails = (sourceType: string) => {
  switch (sourceType) {
    case 'event':
      return { icon: 'calendar', title: 'Календарь', color: '#4285F4' };
    case 'email':
      return { icon: 'mail', title: 'Почта', color: '#EA4335' };
    case 'task':
      return { icon: 'checkmark-circle', title: 'Задачи', color: '#34A853' };
    default:
      return { icon: 'apps', title: 'Другое', color: '#888888' };
  }
};

const getPriorityColor = (priority: string, theme: any) => {
  switch (priority) {
    case 'asap':
      return theme.error || '#FF3B30';
    case 'high':
      return theme.warning || '#FF9500';
    case 'normal':
      return theme.info || '#007AFF';
    case 'low':
      return theme.textSecondary || '#8E8E93';
    default:
      return theme.textSecondary;
  }
};

const getActionIcon = (actionType: string): keyof typeof Ionicons.glyphMap => {
  switch (actionType) {
    case 'reply':
      return 'arrow-undo';
    case 'forward':
      return 'arrow-redo';
    case 'schedule':
      return 'calendar-outline';
    case 'delegate':
      return 'people-outline';
    case 'archive':
      return 'archive-outline';
    case 'followup':
      return 'time-outline';
    default:
      return 'ellipsis-horizontal';
  }
};

interface BriefingCardData {
  briefing: Briefing | null;
  items: BriefingItem[];
  progress: { total: number; completed: number };
}

export const BriefingCard = () => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BriefingCardData | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const loadBriefing = useCallback(async (force: boolean = false) => {
    setLoading(true);
    try {
      // Check if we need to regenerate
      if (force || await briefingGenerator.shouldRegenerateBriefing()) {
        // Analyze any new emails first
        await briefingGenerator.analyzeUnanalyzedEmails(10);
        // Generate briefing
        await briefingGenerator.generateDailyBriefing();
      }

      // Load current briefing data
      const briefingData = await briefingGenerator.getCurrentBriefing();
      setData(briefingData);
    } catch (error) {
      console.error('[BriefingCard] Failed to load briefing:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBriefing();
  }, [loadBriefing]);

  const handleToggleComplete = async (itemId: string, currentState: boolean) => {
    try {
      await integrationStorage.markBriefingItemComplete(itemId, !currentState);
      // Refresh data
      const briefingData = await briefingGenerator.getCurrentBriefing();
      setData(briefingData);
    } catch (error) {
      console.error('[BriefingCard] Failed to toggle complete:', error);
    }
  };

  const handleActionPress = (action: SuggestedAction) => {
    console.log('[BriefingCard] Action pressed:', action.actionType, action.params);
    // TODO: Implement action handlers (reply, forward, schedule, etc.)
  };

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const toggleItemExpanded = (itemId: string) => {
    setExpandedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  // No data state
  if (!data?.briefing && !loading) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TouchableOpacity onPress={() => loadBriefing(true)} style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <Ionicons name="sunny" size={24} color={theme.primary} />
            <Text style={[styles.headerTitle, { color: theme.text }]}>Утренний брифинг</Text>
          </View>
          <Text style={[styles.actionText, { color: theme.primary }]}>Сгенерировать</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Loading state
  if (loading && !data?.briefing) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={[styles.headerTitle, { color: theme.text, marginLeft: 8 }]}>Подготовка брифинга...</Text>
          </View>
        </View>
      </View>
    );
  }

  if (!data) return null;

  const { briefing, items, progress } = data;
  const progressPercent = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  // Group items by source type
  const groupedItems = items.reduce((acc, item) => {
    const key = item.sourceType;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, BriefingItem[]>);

  return (
    <View>
      {/* Overview Card with Progress */}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TouchableOpacity
          style={styles.header}
          onPress={() => toggleSection('overview')}
          activeOpacity={0.7}
        >
          <View style={styles.headerTitleContainer}>
            <Ionicons name="sunny" size={24} color={theme.primary} />
            <Text style={[styles.headerTitle, { color: theme.text }]}>Брифинг</Text>
            <View style={[styles.badge, { backgroundColor: theme.background }]}>
              <Text style={[styles.badgeText, { color: theme.textSecondary }]}>
                {progress.completed}/{progress.total}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={() => loadBriefing(true)}>
            <Ionicons name="refresh" size={20} color={theme.textSecondary} />
          </TouchableOpacity>
        </TouchableOpacity>

        {!collapsedSections['overview'] && (
          <View style={styles.content}>
            <Text style={[styles.headline, { color: theme.text }]}>{briefing?.headline}</Text>
            <Text style={[styles.summary, { color: theme.textSecondary }]}>{briefing?.summary}</Text>

            {/* Progress Bar */}
            <View style={[styles.progressContainer, { backgroundColor: theme.background }]}>
              <View
                style={[
                  styles.progressBar,
                  {
                    backgroundColor: progressPercent === 100 ? '#34A853' : theme.primary,
                    width: `${progressPercent}%`
                  }
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: theme.textSecondary }]}>
              {progress.completed} из {progress.total} выполнено
            </Text>
          </View>
        )}
      </View>

      {/* Grouped Items */}
      {Object.entries(groupedItems).map(([sourceType, groupItems]) => {
        const details = getSourceDetails(sourceType);
        const isCollapsed = collapsedSections[sourceType];

        return (
          <View key={sourceType} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TouchableOpacity
              style={styles.header}
              onPress={() => toggleSection(sourceType)}
              activeOpacity={0.7}
            >
              <View style={styles.headerTitleContainer}>
                <Ionicons name={details.icon as any} size={22} color={theme.text} />
                <Text style={[styles.headerTitle, { color: theme.text }]}>{details.title}</Text>
                <View style={[styles.badge, { backgroundColor: theme.background }]}>
                  <Text style={[styles.badgeText, { color: theme.textSecondary }]}>{groupItems.length}</Text>
                </View>
              </View>
              <Ionicons
                name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                size={20}
                color={theme.textSecondary}
              />
            </TouchableOpacity>

            {!isCollapsed && (
              <View style={styles.content}>
                {groupItems.map((item, index) => (
                  <View
                    key={item.id}
                    style={[
                      styles.itemContainer,
                      {
                        borderLeftColor: getPriorityColor(item.priority, theme),
                        marginBottom: index === groupItems.length - 1 ? 0 : 12,
                        opacity: item.isCompleted ? 0.6 : 1
                      }
                    ]}
                  >
                    {/* Item Header with Checkbox */}
                    <View style={styles.itemHeader}>
                      <TouchableOpacity
                        onPress={() => handleToggleComplete(item.id, item.isCompleted)}
                        style={styles.checkbox}
                      >
                        <Ionicons
                          name={item.isCompleted ? 'checkbox' : 'square-outline'}
                          size={22}
                          color={item.isCompleted ? '#34A853' : theme.textSecondary}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.itemTitleContainer}
                        onPress={() => toggleItemExpanded(item.id)}
                      >
                        <Text
                          style={[
                            styles.itemTitle,
                            {
                              color: theme.text,
                              textDecorationLine: item.isCompleted ? 'line-through' : 'none'
                            }
                          ]}
                          numberOfLines={2}
                        >
                          {item.title}
                        </Text>
                      </TouchableOpacity>
                      {item.suggestedActions && item.suggestedActions.length > 0 && (
                        <TouchableOpacity onPress={() => toggleItemExpanded(item.id)}>
                          <Ionicons
                            name={expandedItems.has(item.id) ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={theme.textSecondary}
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Description */}
                    {item.description && (
                      <Text style={[styles.itemDescription, { color: theme.textSecondary }]}>
                        {item.description}
                      </Text>
                    )}

                    {/* Suggested Actions */}
                    {expandedItems.has(item.id) && item.suggestedActions && item.suggestedActions.length > 0 && (
                      <View style={styles.actionsContainer}>
                        {item.suggestedActions.map((action) => (
                          <TouchableOpacity
                            key={action.id}
                            style={[styles.actionButton, { backgroundColor: theme.background }]}
                            onPress={() => handleActionPress(action)}
                          >
                            <Ionicons
                              name={getActionIcon(action.actionType)}
                              size={14}
                              color={theme.primary}
                            />
                            <Text style={[styles.actionLabel, { color: theme.primary }]}>
                              {action.label}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  headline: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    padding: 16,
    paddingTop: 0,
    paddingBottom: 16,
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  progressContainer: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 12,
    textAlign: 'center',
  },
  itemContainer: {
    paddingLeft: 12,
    borderLeftWidth: 3,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkbox: {
    marginRight: 8,
  },
  itemTitleContainer: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  itemDescription: {
    fontSize: 14,
    marginBottom: 6,
    marginLeft: 30,
    lineHeight: 18,
  },
  actionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    marginLeft: 30,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  }
});
