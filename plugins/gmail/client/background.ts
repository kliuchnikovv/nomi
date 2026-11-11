/**
 * Gmail client plugin: background sync task.
 *
 * On each wake:
 * 1. Syncs new unread emails and creates in-app plugin chats (via GmailClient.onWake).
 * 2. Skips emails with Gmail promotional/social/updates category labels.
 * 3. Analyzes remaining emails for importance (subscriptions, payments, urgency).
 * 4. Creates iOS Reminders for important emails that haven't had one created yet.
 *    Deduplication is stored in SQLite (plugin chat data) so it survives app reinstalls.
 * 5. Appends a structured run log so results are visible in the Gmail plugin screen.
 */

import { gmailClient } from "./GmailClient";
import { IOSRemindersClient } from "@nomi/front/services/integrations/clients/IOSRemindersClient";
import { pluginChatStorage } from "@nomi/front/services/plugins/PluginChatStorage";
import { analyzeEmailWithLog, isPromotionalEmail } from "./emailAnalyzer";
import { backgroundLogger, type EmailLogEntry } from "./backgroundLogger";
import { eventsApi } from "@nomi/front/apiClient";

export async function backgroundTask(integrationId: string): Promise<void> {
  const startTime = Date.now();
  console.log(
    `🔔 [Gmail background] =========================================`
  );
  console.log(
    `🔔 [Gmail background] START: Background task triggered for ${integrationId}`
  );
  console.log(`🔔 [Gmail background] Time: ${new Date().toISOString()}`);

  // 1. Sync emails and create in-app plugin chats
  console.log(`🔔 [Gmail background] Step 1: Calling gmailClient.onWake()...`);
  const emails = await gmailClient.onWake(integrationId);
  const entries: EmailLogEntry[] = [];
  console.log(
    `🔔 [Gmail background] Step 1 COMPLETE: Received ${
      emails.length
    } emails from onWake() in ${Date.now() - startTime}ms`
  );

  if (!emails.length) {
    await backgroundLogger.append(integrationId, {
      timestamp: new Date().toISOString(),
      totalFound: 0,
      entries: [],
    });
    return;
  }

  // 2. Check Reminders permission once up front (can't prompt in background)
  const remindersClient = new IOSRemindersClient();
  const permission = await remindersClient.checkPermissionStatus();

  for (const email of emails) {
    const subject = email.subject || "(No subject)";
    const from = email.fromEmail || "";
    const emailStart = Date.now();

    // 3. Check SQLite deduplication: skip if a reminder was already created for this email
    const existingChat = await pluginChatStorage.getPluginChat(email.gmailId);
    const chatData = existingChat?.data ? JSON.parse(existingChat.data) : {};
    if (chatData.reminderCreated === true) {
      entries.push({
        gmailId: email.gmailId,
        subject,
        from,
        date: email.date?.toISOString() || new Date().toISOString(),
        snippet: email.snippet || "",
        labels: email.labels || [],
        action: "already_seen",
        durationMs: Date.now() - emailStart,
      });
      continue;
    }

    // 4. Pre-filter promotional/social/updates emails — no AI needed
    if (isPromotionalEmail(email)) {
      entries.push({
        gmailId: email.gmailId,
        subject,
        from,
        date: email.date?.toISOString() || new Date().toISOString(),
        snippet: email.snippet || "",
        labels: email.labels || [],
        action: "not_important",
        analysis: {
          urgent: false,
          importantKeywords: [],
          hasGmailImportant: false,
          analyzedByAI: false,
          actionHint: "Promotional/category email — skipped",
        },
        durationMs: Date.now() - emailStart,
      });
      continue;
    }

    // 4b. Emit a proactive event so the backend pipeline (rules → judge → agent)
    // can triage this email and surface it in the Updates chat. Deduped per email
    // via SQLite so we don't re-emit the same unread message on every 15-min wake.
    // Independent of the iOS Reminder path below (which is a separate local action).
    if (chatData.proactiveEmitted !== true) {
      try {
        const senderLabel = email.fromName
          ? `${email.fromName} <${from}>`
          : from;
        await eventsApi.ingest({
          source: "email",
          event_type: "email_new",
          payload: {
            message_id: email.gmailId,
            sender: senderLabel,
            sender_email: from.toLowerCase(),
            subject,
            snippet: (email.snippet || "").slice(0, 200),
            received_at: email.date?.toISOString() || new Date().toISOString(),
          },
        });
        await pluginChatStorage.updateChatData(email.gmailId, {
          proactiveEmitted: true,
        });
      } catch (e) {
        console.warn(
          `[Gmail background] Failed to emit proactive event for ${email.gmailId}:`,
          e
        );
        // Non-fatal — continue with the reminder logic below.
      }
    }

    const analysis = await analyzeEmailWithLog(email);

    if (!analysis.isImportant) {
      entries.push({
        gmailId: email.gmailId,
        subject,
        from,
        date: email.date?.toISOString() || new Date().toISOString(),
        snippet: email.snippet || "",
        labels: email.labels || [],
        action: "not_important",
        analysis: {
          urgent: analysis.urgent,
          importantKeywords: analysis.matchedKeywords,
          hasGmailImportant: analysis.hasGmailImportant,
          analyzedByAI: analysis.analyzedByAI,
          actionHint: analysis.actionHint,
        },
        durationMs: Date.now() - emailStart,
      });
      continue;
    }

    if (permission !== "authorized") {
      entries.push({
        gmailId: email.gmailId,
        subject,
        from,
        date: email.date?.toISOString() || new Date().toISOString(),
        snippet: email.snippet || "",
        labels: email.labels || [],
        action: "skipped_no_permission",
        analysis: {
          urgent: analysis.urgent,
          importantKeywords: analysis.matchedKeywords,
          hasGmailImportant: analysis.hasGmailImportant,
          analyzedByAI: analysis.analyzedByAI,
          actionHint: analysis.actionHint,
        },
        durationMs: Date.now() - emailStart,
      });
      continue;
    }

    try {
      const emailUrl = email.threadId
        ? `https://mail.google.com/mail/u/0/#all/${email.threadId}`
        : `https://mail.google.com/mail/u/0/#inbox/${email.gmailId}`;

      const senderLabel = email.fromName ? `${email.fromName} <${from}>` : from;
      const notes = [analysis.actionHint, `From: ${senderLabel}`, email.snippet]
        .filter(Boolean)
        .join("\n");

      const reminderResult = await remindersClient.createReminder(
        `📧 ${subject}`,
        {
          notes,
          dueDate: analysis.dueDateISO,
          priority: analysis.priority,
          url: emailUrl,
        }
      );

      // Mark reminder as created in SQLite so future runs skip this email
      await pluginChatStorage.updateChatData(email.gmailId, {
        reminderCreated: true,
      });

      entries.push({
        gmailId: email.gmailId,
        subject,
        from,
        date: email.date?.toISOString() || new Date().toISOString(),
        snippet: email.snippet || "",
        labels: email.labels || [],
        action: "reminder_created",
        analysis: {
          urgent: analysis.urgent,
          importantKeywords: analysis.matchedKeywords,
          hasGmailImportant: analysis.hasGmailImportant,
          analyzedByAI: analysis.analyzedByAI,
          actionHint: analysis.actionHint,
        },
        reminderDetails: {
          dueDate: analysis.dueDateISO,
          priority: analysis.priority,
          reminderId: reminderResult?.id,
        },
        durationMs: Date.now() - emailStart,
      });
      console.log(
        `[Gmail background] Created reminder for: ${subject} (due: ${analysis.dueDateISO}, priority: ${analysis.priority}, hint: ${analysis.actionHint})`
      );
    } catch (e) {
      entries.push({
        gmailId: email.gmailId,
        subject,
        from,
        date: email.date?.toISOString() || new Date().toISOString(),
        snippet: email.snippet || "",
        labels: email.labels || [],
        action: "reminder_failed",
        analysis: {
          urgent: analysis.urgent,
          importantKeywords: analysis.matchedKeywords,
          hasGmailImportant: analysis.hasGmailImportant,
          analyzedByAI: analysis.analyzedByAI,
          actionHint: analysis.actionHint,
        },
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - emailStart,
      });
      console.warn(
        `[Gmail background] Failed to create reminder for ${email.gmailId}:`,
        e
      );
    }
  }

  await backgroundLogger.append(integrationId, {
    timestamp: new Date().toISOString(),
    totalFound: emails.length,
    entries,
  });

  const created = entries.filter((e) => e.action === "reminder_created").length;
  const failed = entries.filter((e) => e.action === "reminder_failed").length;
  const skipped = entries.filter(
    (e) => e.action === "skipped_no_permission"
  ).length;
  const notImportant = entries.filter(
    (e) => e.action === "not_important"
  ).length;
  const alreadySeen = entries.filter((e) => e.action === "already_seen").length;
  const totalDuration = Date.now() - startTime;

  console.log(
    `🔔 [Gmail background] =========================================`
  );
  console.log(`🔔 [Gmail background] SUMMARY:`);
  console.log(`🔔 [Gmail background]   Total emails: ${emails.length}`);
  console.log(`🔔 [Gmail background]   Created reminders: ${created}`);
  console.log(`🔔 [Gmail background]   Failed reminders: ${failed}`);
  console.log(`🔔 [Gmail background]   No permission: ${skipped}`);
  console.log(`🔔 [Gmail background]   Not important: ${notImportant}`);
  console.log(`🔔 [Gmail background]   Already seen: ${alreadySeen}`);
  console.log(`🔔 [Gmail background]   Total duration: ${totalDuration}ms`);
  console.log(`🔔 [Gmail background] END: Background task completed`);
  console.log(
    `🔔 [Gmail background] =========================================`
  );
}
