/**
 * Gmail client plugin: background sync task.
 *
 * On each wake:
 * 1. Syncs new unread emails and creates in-app plugin chats (via GmailClient.onWake).
 * 2. Analyzes returned emails for importance (subscriptions, payments, urgency).
 * 3. Creates iOS Reminders for important emails that haven't been processed yet.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { gmailClient } from '@genie/front/services/integrations/clients/GmailClient';
import { IOSRemindersClient } from '@genie/front/services/integrations/clients/IOSRemindersClient';
import { analyzeEmail } from './emailAnalyzer';

const seenKey = (integrationId: string) => `gmail_bg_seen_${integrationId}`;

async function getSeenIds(integrationId: string): Promise<Set<string>> {
    const raw = await AsyncStorage.getItem(seenKey(integrationId));
    return new Set(raw ? JSON.parse(raw) : []);
}

async function markSeen(integrationId: string, ids: string[]): Promise<void> {
    const existing = await getSeenIds(integrationId);
    ids.forEach(id => existing.add(id));
    // Cap to avoid unbounded growth over time
    const trimmed = [...existing].slice(-1000);
    await AsyncStorage.setItem(seenKey(integrationId), JSON.stringify(trimmed));
}

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[Gmail background] triggered for ${integrationId}`);

    // 1. Sync emails and create in-app plugin chats
    const emails = await gmailClient.onWake(integrationId);
    if (!emails.length) return;

    // 2. Skip emails already processed for reminders
    const seen = await getSeenIds(integrationId);
    const fresh = emails.filter(e => !seen.has(e.gmailId));

    if (!fresh.length) {
        console.log('[Gmail background] All emails already processed, skipping reminders');
        return;
    }

    // 3. Analyze importance
    const toRemind = fresh.filter(e => analyzeEmail(e).isImportant);
    if (!toRemind.length) {
        console.log('[Gmail background] No important emails found');
        await markSeen(integrationId, fresh.map(e => e.gmailId));
        return;
    }

    // 4. Create iOS Reminders (only if permission already granted — cannot prompt in background)
    const remindersClient = new IOSRemindersClient();
    const permission = await remindersClient.checkPermissionStatus();
    if (permission !== 'authorized') {
        console.log('[Gmail background] Reminders permission not granted, skipping reminder creation');
        await markSeen(integrationId, fresh.map(e => e.gmailId));
        return;
    }

    for (const email of toRemind) {
        const analysis = analyzeEmail(email);
        try {
            await remindersClient.createReminder(
                `📧 ${email.subject || '(No subject)'}`,
                {
                    notes: `From: ${email.fromEmail}\n${email.snippet ?? ''}`,
                    dueDate: analysis.dueDateISO,
                    priority: analysis.urgent ? 1 : 5,
                }
            );
            console.log(`[Gmail background] Created reminder for: ${email.subject}`);
        } catch (e) {
            console.warn(`[Gmail background] Failed to create reminder for ${email.gmailId}:`, e);
        }
    }

    await markSeen(integrationId, fresh.map(e => e.gmailId));
}
