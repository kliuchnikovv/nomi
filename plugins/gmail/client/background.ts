/**
 * Gmail client plugin: background sync task.
 *
 * On each wake:
 * 1. Syncs new unread emails and creates in-app plugin chats (via GmailClient.onWake).
 * 2. Analyzes returned emails for importance (subscriptions, payments, urgency).
 * 3. Creates iOS Reminders for important emails that haven't been processed yet.
 * 4. Appends a structured run log so results are visible in the Gmail plugin screen.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { gmailClient } from '@genie/front/services/integrations/clients/GmailClient';
import { IOSRemindersClient } from '@genie/front/services/integrations/clients/IOSRemindersClient';
import { analyzeEmailWithLog } from './emailAnalyzer';
import { backgroundLogger, type EmailLogEntry } from './backgroundLogger';

const seenKey = (integrationId: string) => `gmail_bg_seen_${integrationId}`;

async function getSeenIds(integrationId: string): Promise<Set<string>> {
    const raw = await AsyncStorage.getItem(seenKey(integrationId));
    return new Set(raw ? JSON.parse(raw) : []);
}

async function markSeen(integrationId: string, ids: string[]): Promise<void> {
    const existing = await getSeenIds(integrationId);
    ids.forEach(id => existing.add(id));
    const trimmed = [...existing].slice(-1000);
    await AsyncStorage.setItem(seenKey(integrationId), JSON.stringify(trimmed));
}

export async function backgroundTask(integrationId: string): Promise<void> {
    const startTime = Date.now();
    console.log(`🔔 [Gmail background] =========================================`);
    console.log(`🔔 [Gmail background] START: Background task triggered for ${integrationId}`);
    console.log(`🔔 [Gmail background] Time: ${new Date().toISOString()}`);

    // 1. Sync emails and create in-app plugin chats
    console.log(`🔔 [Gmail background] Step 1: Calling gmailClient.onWake()...`);
    const emails = await gmailClient.onWake(integrationId);
    const entries: EmailLogEntry[] = [];
    console.log(`🔔 [Gmail background] Step 1 COMPLETE: Received ${emails.length} emails from onWake() in ${Date.now() - startTime}ms`);

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

    const seen = await getSeenIds(integrationId);
    const processedIds: string[] = [];

    for (const email of emails) {
        const subject = email.subject || '(No subject)';
        const from = email.fromEmail || '';
        const startTime = Date.now();

        if (seen.has(email.gmailId)) {
            entries.push({
                gmailId: email.gmailId,
                subject,
                from,
                date: email.date?.toISOString() || new Date().toISOString(),
                snippet: email.snippet || '',
                labels: email.labels || [],
                action: 'already_seen',
                durationMs: Date.now() - startTime,
            });
            continue;
        }

        processedIds.push(email.gmailId);
        const analysis = await analyzeEmailWithLog(email);

        if (!analysis.isImportant) {
            entries.push({
                gmailId: email.gmailId,
                subject,
                from,
                date: email.date?.toISOString() || new Date().toISOString(),
                snippet: email.snippet || '',
                labels: email.labels || [],
                action: 'not_important',
                analysis: {
                    urgent: analysis.urgent,
                    importantKeywords: analysis.matchedKeywords,
                    hasGmailImportant: analysis.hasGmailImportant,
                    analyzedByAI: analysis.analyzedByAI,
                    actionHint: analysis.actionHint,
                },
                durationMs: Date.now() - startTime,
            });
            continue;
        }

        if (permission !== 'authorized') {
            entries.push({
                gmailId: email.gmailId,
                subject,
                from,
                date: email.date?.toISOString() || new Date().toISOString(),
                snippet: email.snippet || '',
                labels: email.labels || [],
                action: 'skipped_no_permission',
                analysis: {
                    urgent: analysis.urgent,
                    importantKeywords: analysis.matchedKeywords,
                    hasGmailImportant: analysis.hasGmailImportant,
                    analyzedByAI: analysis.analyzedByAI,
                    actionHint: analysis.actionHint,
                },
                durationMs: Date.now() - startTime,
            });
            continue;
        }

        try {
            const emailUrl = email.threadId
                ? `https://mail.google.com/mail/u/0/#all/${email.threadId}`
                : `https://mail.google.com/mail/u/0/#inbox/${email.gmailId}`;

            const senderLabel = email.fromName ? `${email.fromName} <${from}>` : from;
            const notes = [
                analysis.actionHint,
                `От: ${senderLabel}`,
                email.snippet,
            ].filter(Boolean).join('\n');

            const reminderResult = await remindersClient.createReminder(
                `📧 ${subject}`,
                {
                    notes,
                    dueDate: analysis.dueDateISO,
                    priority: analysis.priority,
                    url: emailUrl,
                }
            );
            entries.push({
                gmailId: email.gmailId,
                subject,
                from,
                date: email.date?.toISOString() || new Date().toISOString(),
                snippet: email.snippet || '',
                labels: email.labels || [],
                action: 'reminder_created',
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
                durationMs: Date.now() - startTime,
            });
            console.log(`[Gmail background] Created reminder for: ${subject} (due: ${analysis.dueDateISO}, priority: ${analysis.priority}, hint: ${analysis.actionHint})`);
        } catch (e) {
            entries.push({
                gmailId: email.gmailId,
                subject,
                from,
                date: email.date?.toISOString() || new Date().toISOString(),
                snippet: email.snippet || '',
                labels: email.labels || [],
                action: 'reminder_failed',
                analysis: {
                    urgent: analysis.urgent,
                    importantKeywords: analysis.matchedKeywords,
                    hasGmailImportant: analysis.hasGmailImportant,
                    analyzedByAI: analysis.analyzedByAI,
                    actionHint: analysis.actionHint,
                },
                error: e instanceof Error ? e.message : String(e),
                durationMs: Date.now() - startTime,
            });
            console.warn(`[Gmail background] Failed to create reminder for ${email.gmailId}:`, e);
        }
    }

    await markSeen(integrationId, processedIds);
    await backgroundLogger.append(integrationId, {
        timestamp: new Date().toISOString(),
        totalFound: emails.length,
        entries,
    });

    const created = entries.filter(e => e.action === 'reminder_created').length;
    const failed = entries.filter(e => e.action === 'reminder_failed').length;
    const skipped = entries.filter(e => e.action === 'skipped_no_permission').length;
    const notImportant = entries.filter(e => e.action === 'not_important').length;
    const alreadySeen = entries.filter(e => e.action === 'already_seen').length;
    const totalDuration = Date.now() - startTime;

    console.log(`🔔 [Gmail background] =========================================`);
    console.log(`🔔 [Gmail background] SUMMARY:`);
    console.log(`🔔 [Gmail background]   Total emails: ${emails.length}`);
    console.log(`🔔 [Gmail background]   Created reminders: ${created}`);
    console.log(`🔔 [Gmail background]   Failed reminders: ${failed}`);
    console.log(`🔔 [Gmail background]   No permission: ${skipped}`);
    console.log(`🔔 [Gmail background]   Not important: ${notImportant}`);
    console.log(`🔔 [Gmail background]   Already seen: ${alreadySeen}`);
    console.log(`🔔 [Gmail background]   Total duration: ${totalDuration}ms`);
    console.log(`🔔 [Gmail background] END: Background task completed`);
    console.log(`🔔 [Gmail background] =========================================`);
}
