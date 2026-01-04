import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity } from 'react-native';
import { Card } from '../../../components/Card';
import { useConnectors } from '../../settings/connectors/context';
import { gmailClient } from '../../../services/integrations/clients/GmailClient';
import { calendarClient } from '../../../services/integrations/clients/CalendarClient';
import { githubClient } from '../../../services/integrations/clients/GitHubClient';
import { julesClient } from '../../../services/integrations/clients/JulesClient';
import { briefingApi } from '../../../apiClient';

interface BriefingItem {
  id: string;
  type: string;
  priority: 'CRITICAL' | 'INFO';
  title: string;
  description: string;
  context?: string;
  source_link?: string;
}

interface BriefingData {
  headline: string;
  summary: string;
  items: BriefingItem[];
}

export const BriefingCard: React.FC = () => {
  const { integrations } = useConnectors();
  const [data, setData] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBriefing = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Collect Data locally
      const integrationData: any = {};

      const enabledIntegrations = integrations.filter(i => i.connected || i.enabled); // Handle both models

      // Parallel fetch
      const promises = enabledIntegrations.map(async (integration) => {
        const provider = integration.provider || integration.id; // fallback
        try {
          if (provider === 'gmail') {
            const emails = await gmailClient.getRecentEmails(integration.id, 10);
            if (!integrationData.emails) integrationData.emails = [];
            integrationData.emails.push(...emails);
          } else if (provider === 'calendar') {
            const events = await calendarClient.getUpcomingEvents(integration.id, 10);
            if (!integrationData.events) integrationData.events = [];
            integrationData.events.push(...events);
          } else if (provider === 'github') {
            const issues = await githubClient.getAssignedIssues(integration.id);
            if (!integrationData.issues) integrationData.issues = [];
            integrationData.issues.push(...issues);
          } else if (provider === 'jules') {
            const tasks = await julesClient.getTasks(integration.id);
            if (!integrationData.tasks) integrationData.tasks = [];
            integrationData.tasks.push(...tasks);
          }
        } catch (e) {
          console.warn(`Failed to fetch data for ${provider}`, e);
        }
      });

      await Promise.all(promises);

      // 2. Send to Backend
      const response = await briefingApi.getBriefing({
        integration_data: integrationData
      });

      setData(response.data);

    } catch (e) {
      console.error("Failed to load briefing:", e);
      setError("Failed to generate briefing. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBriefing();
  }, []); // Run once on mount

  if (loading) {
    return (
      <Card style={styles.container}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text style={styles.loadingText}>Generating your daily briefing...</Text>
      </Card>
    );
  }

  if (error) {
    return (
      <Card style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={loadBriefing} style={styles.retryButton}>
          <Text>Retry</Text>
        </TouchableOpacity>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card style={styles.container}>
      <Text style={styles.headline}>{data.headline}</Text>
      <Text style={styles.summary}>{data.summary}</Text>

      <ScrollView style={styles.list}>
        {data.items.map(item => (
          <View key={item.id} style={[styles.item, item.priority === 'CRITICAL' && styles.criticalItem]}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              {item.priority === 'CRITICAL' && <Text style={styles.badge}>!</Text>}
            </View>
            <Text style={styles.itemDesc}>{item.description}</Text>
            {item.context && (
              <Text style={styles.context}>💡 {item.context}</Text>
            )}
          </View>
        ))}
      </ScrollView>
    </Card>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxHeight: 400,
  },
  loadingText: {
    marginTop: 10,
    textAlign: 'center',
  },
  headline: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  summary: {
    fontSize: 16,
    marginBottom: 16,
    color: '#444',
  },
  list: {
    maxHeight: 300,
  },
  item: {
    padding: 12,
    backgroundColor: '#f5f5f5',
    marginBottom: 8,
    borderRadius: 8,
  },
  criticalItem: {
    borderLeftWidth: 4,
    borderLeftColor: 'red',
    backgroundColor: '#fff0f0',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemTitle: {
    fontWeight: '600',
    fontSize: 15,
  },
  badge: {
    color: 'red',
    fontWeight: 'bold',
  },
  itemDesc: {
    fontSize: 14,
    color: '#333',
  },
  context: {
    fontSize: 12,
    color: '#666',
    marginTop: 6,
    fontStyle: 'italic',
  },
  errorText: {
    color: 'red',
    marginBottom: 10,
  },
  retryButton: {
    padding: 10,
    backgroundColor: '#ddd',
    alignItems: 'center',
    borderRadius: 8,
  }
});
