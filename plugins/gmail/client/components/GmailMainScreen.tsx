import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from "react-native";
import { useTheme } from "@genie/front/context/ThemeContext";
import { gmailClient } from "../GmailClient";
import { Email } from "@genie/front/services/integrations/IntegrationStorage";
import { PluginMainScreenProps } from "@genie/front/plugins/types";
import { integrationStorage } from "@genie/front/services/integrations/IntegrationStorage";
import { ContextItem } from "@genie/front/screens/chat/components/ContextItemCard";
import { contextStore } from "@genie/front/services/ContextStore";
import { SharedPluginScreen } from "@genie/front/plugins/components/SharedPluginScreen";

export function GmailMainScreen({
  integrationId: integrationIdProp,
  onClose,
}: PluginMainScreenProps) {
  const { theme } = useTheme();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrationName, setIntegrationName] = useState<string>("Gmail");

  useEffect(() => {
    const loadIntegrationName = async () => {
      if (!integrationIdProp) return;
      try {
        const integrations = await integrationStorage.getIntegrations();
        const gmailIntegration = integrations.find(
          (i) => i.id === integrationIdProp
        );
        if (gmailIntegration) {
          setIntegrationName(gmailIntegration.name || "Gmail");
        }
      } catch (error) {
        console.error("Failed to load integration name:", error);
        setIntegrationName("Gmail");
      }
    };
    loadIntegrationName();
  }, [integrationIdProp]);

  const truncateText = (text: string, maxLength: number = 20): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const displayName =
    integrationName === "Gmail"
      ? integrationName
      : truncateText(integrationName);

  if (!integrationIdProp) {
    console.error("[GmailMainScreen] No integrationId provided");
    return (
      <SharedPluginScreen title={displayName} onClose={onClose}>
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary }}>
            No integration configured
          </Text>
        </View>
      </SharedPluginScreen>
    );
  }

  const integrationId = integrationIdProp;

  const loadEmails = async () => {
    try {
      const data = await gmailClient.getCachedEmails(integrationId);
      setEmails(data);
      setError(null);
    } catch (error) {
      console.error("Failed to load emails:", error);
      setError(
        error instanceof Error ? error.message : "Failed to load emails"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await gmailClient.syncEmails(integrationId);
      await loadEmails();
    } catch (error) {
      console.error("Failed to refresh emails:", error);
      setError(
        error instanceof Error ? error.message : "Failed to refresh emails"
      );
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadEmails();
  }, []);

  const handleEmailPress = async (email: Email) => {
    await handleEmailLongPress(email);
  };

  const handleEmailLongPress = async (email: Email) => {
    console.log(
      "[GmailMainScreen] Adding email to context:",
      email.id,
      email.subject
    );
    try {
      const item: ContextItem = {
        id: email.id,
        sourceType: "email",
        title: email.subject || "(no subject)",
        preview: email.snippet || email.fromEmail || "",
        metadata: {
          subject: email.subject,
          from: email.fromEmail,
          fromName: email.fromName,
          body: email.bodyText || email.snippet || "",
          date: email.date,
        },
        addedAt: Date.now(),
      };

      console.log("[GmailMainScreen] Adding to contextStore:", item);
      contextStore.add(item);
      onClose?.(true);
    } catch (error) {
      console.error("[GmailMainScreen] Failed to add email to context:", error);
    }
  };

  const renderItem = ({ item }: { item: Email }) => (
    <Pressable
      onPress={() => handleEmailPress(item)}
      style={({ pressed }) => [
        styles.emailItem,
        { backgroundColor: theme.card, borderColor: theme.border },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.emailHeader}>
        <Text style={[styles.sender, { color: theme.text }]} numberOfLines={1}>
          {item.fromName || item.fromEmail}
        </Text>
        <Text style={[styles.date, { color: theme.textSecondary }]}>
          {item.date ? new Date(item.date).toLocaleDateString() : ""}
        </Text>
      </View>
      <Text style={[styles.subject, { color: theme.text }]} numberOfLines={1}>
        {item.subject}
      </Text>
      <Text
        style={[styles.snippet, { color: theme.textSecondary }]}
        numberOfLines={2}
      >
        {item.snippet}
      </Text>
    </Pressable>
  );

  return (
    <SharedPluginScreen title={displayName} onClose={onClose}>
      {error && !loading && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: theme.error || "#ef4444" }]}>
            {error}
          </Text>
          <Pressable onPress={handleRefresh} style={styles.retryButton}>
            <Text style={[styles.retryButtonText, { color: theme.accent }]}>
              Retry
            </Text>
          </Pressable>
        </View>
      )}

      {loading && !error ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      ) : !error ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={emails.length === 0 ? styles.emptyScrollContent : styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.accent}
            />
          }
          alwaysBounceVertical={true}
        >
          {emails.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ color: theme.textSecondary }}>
                No emails found
              </Text>
            </View>
          ) : (
            <FlatList
              data={emails}
              renderItem={renderItem}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
            />
          )}
        </ScrollView>
      ) : null}
    </SharedPluginScreen>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  emptyScrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#e0f2fe",
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  listContent: {
    padding: 16,
  },
  emailItem: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
  },
  emailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  sender: {
    fontWeight: "600",
    fontSize: 15,
    flex: 1,
    marginRight: 8,
  },
  date: {
    fontSize: 12,
  },
  subject: {
    fontSize: 15,
    fontWeight: "500",
    marginBottom: 4,
  },
  snippet: {
    fontSize: 14,
  },
});
