import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { briefingApi } from '../../../apiClient';
import { integrationStorage } from '../../../services/integrations/IntegrationStorage';

interface BriefingItem {
  id: string;
  type: 'meeting' | 'email' | 'task' | 'alert';
  priority: 'CRITICAL' | 'INFO';
  title: string;
  description: string;
  context?: string;
  action_required: boolean;
  source_link?: string;
}

interface BriefingData {
  headline: string;
  summary: string;
  items: BriefingItem[];
}

const getIntegrationDetails = (type: string) => {
  switch (type) {
    case 'meeting':
      return { icon: 'calendar', title: 'Calendar', color: '#4285F4' }; // Google Blue
    case 'email':
      return { icon: 'mail', title: 'Gmail', color: '#EA4335' }; // Google Red
    case 'task':
      return { icon: 'git-pull-request', title: 'GitHub', color: '#333333' }; // GitHub Black (adaptable)
    case 'alert':
      return { icon: 'alert-circle', title: 'Alerts', color: '#F4B400' }; // Google Yellow
    default:
      return { icon: 'apps', title: 'Other', color: '#888888' };
  }
};

export const BriefingCard = () => {
  const { theme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BriefingData | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadBriefing();
  }, []);

  const loadBriefing = async () => {
    setLoading(true);
    try {
      // Fetch local context (emails)
      const integrations = await integrationStorage.getIntegrations();
      const gmailIntegrations = integrations.filter(i => i.provider === 'gmail' && i.enabled);

      let emailContext: any[] = [];
      for (const integ of gmailIntegrations) {
        const emails = await integrationStorage.getCachedEmails(integ.id, 20); // Top 20 recent
        emailContext = [...emailContext, ...emails.map(e => ({
          id: e.id,
          subject: e.subject,
          snippet: e.snippet,
          from: e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail,
          date: e.date,
          body: e.bodyText?.slice(0, 500) // Truncate body for context
        }))];
      }

      const context = {
        emails: emailContext
      };

      const result = await briefingApi.getBriefing(context);
      if (result && !result.error) {
        setData(result);
      } else {
        console.error("Briefing error:", result?.error);
      }
    } catch (e) {
      console.error("Failed to load briefing:", e);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  if (!data && !loading) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <TouchableOpacity onPress={loadBriefing} style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <Ionicons name="sunny" size={24} color={theme.primary} />
            <Text style={[styles.headerTitle, { color: theme.text }]}>Morning Briefing</Text>
          </View>
          <Text style={[styles.actionText, { color: theme.primary }]}>Prepare</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading && !data) {
    return (
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <ActivityIndicator size="small" color={theme.primary} />
            <Text style={[styles.headerTitle, { color: theme.text, marginLeft: 8 }]}>Preparing your briefing...</Text>
          </View>
        </View>
      </View>
    )
  }

  const groupedItems = data?.items.reduce((acc, item) => {
    const key = item.type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {} as Record<string, BriefingItem[]>) || {};

  return (
    <View>
      {/* Overall Card */}
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.header}>
          <View style={styles.headerTitleContainer}>
            <Ionicons name="sunny" size={24} color={theme.primary} />
            <Text style={[styles.headerTitle, { color: theme.text }]}>Overview</Text>
          </View>
        </View>
        <View style={styles.content}>
          <Text style={[styles.headline, { color: theme.text }]}>{data.headline}</Text>
          <Text style={[styles.summary, { color: theme.textSecondary }]}>{data.summary}</Text>
        </View>
      </View>

      {/* Integration Cards */}
      {Object.entries(groupedItems).map(([type, items]) => {
        const details = getIntegrationDetails(type);
        const isCollapsed = collapsedSections[type];

        return (
          <View key={type} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TouchableOpacity
              style={styles.header}
              onPress={() => toggleSection(type)}
              activeOpacity={0.7}
            >
              <View style={styles.headerTitleContainer}>
                <Ionicons name={details.icon as any} size={22} color={theme.text} />
                <Text style={[styles.headerTitle, { color: theme.text }]}>{details.title}</Text>
                <View style={[styles.badge, { backgroundColor: theme.background }]}>
                  <Text style={[styles.badgeText, { color: theme.textSecondary }]}>{items.length}</Text>
                </View>
              </View>
              <Ionicons
                name={isCollapsed ? "chevron-down" : "chevron-up"}
                size={20}
                color={theme.textSecondary}
              />
            </TouchableOpacity>

            {!isCollapsed && (
              <View style={styles.content}>
                {items.map((item, index) => (
                  <View key={item.id} style={[
                    styles.itemContainer,
                    {
                      borderLeftColor: item.priority === 'CRITICAL' ? theme.error : theme.info,
                      marginBottom: index === items.length - 1 ? 0 : 12
                    }
                  ]}>
                    <View style={styles.itemHeader}>
                      <Text style={[styles.itemTitle, { color: theme.text }]}>{item.title}</Text>
                      {item.source_link && (
                        <TouchableOpacity onPress={() => Linking.openURL(item.source_link!)}>
                          <Ionicons name="link" size={16} color={theme.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={[styles.itemDescription, { color: theme.textSecondary }]}>{item.description}</Text>
                    {item.context && (
                      <View style={[styles.contextContainer, { backgroundColor: theme.background }]}>
                        <Text style={[styles.contextText, { color: theme.textSecondary }]}>
                          <Ionicons name="bulb-outline" size={14} /> {item.context}
                        </Text>
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
    // paddingBottom: 12, // Adjusted for cleaner look when collapsed
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
  },
  itemContainer: {
    paddingLeft: 12,
    borderLeftWidth: 3,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  itemDescription: {
    fontSize: 14,
    marginBottom: 6,
    lineHeight: 18,
  },
  contextContainer: {
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  contextText: {
    fontSize: 12,
    fontStyle: 'italic',
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
