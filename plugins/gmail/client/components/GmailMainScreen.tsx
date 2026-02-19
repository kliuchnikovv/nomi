import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Alert,
} from "react-native";
import { useTheme } from "@genie/front/context/ThemeContext";
import { gmailClient } from "@genie/front/services/integrations/clients/GmailClient";
import { Email } from "@genie/front/services/integrations/IntegrationStorage";
import { PluginMainScreenProps } from "@genie/front/plugins/types";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { XmarkCircle } from "iconoir-react-native";
import { integrationStorage } from "@genie/front/services/integrations/IntegrationStorage";
import { ContextItem } from "@genie/front/screens/chat/components/ContextItemCard";
import { contextStore } from "@genie/front/services/ContextStore";

export function GmailMainScreen({
  integrationId: integrationIdProp,
  onClose,
}: PluginMainScreenProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
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
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + 10, borderBottomColor: theme.border },
          ]}
        >
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {displayName}
          </Text>
        </View>
        <View style={styles.center}>
          <Text style={{ color: theme.textSecondary }}>
            No integration configured
          </Text>
        </View>
      </View>
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
      // Force sync
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
      // Close the plugin screen after adding to context
      onClose?.();
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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 10, borderBottomColor: theme.border },
        ]}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text style={[styles.headerTitle, { color: theme.text }]}>
            {displayName}
          </Text>
          {onClose && (
            <Pressable onPress={onClose} hitSlop={12}>
              <XmarkCircle width={24} height={24} color={theme.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

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
        <FlatList
          data={emails}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={{ color: theme.textSecondary }}>
                No emails found
              </Text>
            </View>
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
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
