/**
 * Gmail email importance analyzer.
 * Determines whether an email warrants creating an iOS Reminder.
 *
 * Strategy:
 * 1. Try Apple Intelligence (on-device, private) for nuanced understanding.
 * 2. Fall back to keyword matching if AI is unavailable or fails.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Email } from '@genie/front/services/integrations/IntegrationStorage';
import { AppleIntelligence } from '@genie/front/services/ai/AppleIntelligence';
import { emailApi } from '@genie/front/apiClient';

export const EMAIL_ANALYSIS_MODE_KEY = '@genie_email_analysis_mode';
export type EmailAnalysisMode = 'device' | 'server';

export interface EmailAnalysis {
    isImportant: boolean;
    urgent: boolean;
    dueDateISO: string;
    priority: number;   // 1 = urgent, 2 = high, 3 = medium, 4 = low
    actionHint: string; // short description of what user needs to do
}

export interface EmailAnalysisWithLog extends EmailAnalysis {
    matchedKeywords: string[];
    hasGmailImportant: boolean;
    analyzedByAI: boolean;
}

// ── Promotional label filter ─────────────────────────────────────────────────

const PROMOTIONAL_LABELS = [
    'CATEGORY_PROMOTIONS',
    'CATEGORY_UPDATES',
    'CATEGORY_SOCIAL',
    'CATEGORY_FORUMS',
];

/**
 * Returns true if Gmail has categorized this email as promotional/social/updates.
 * These should never create reminders, regardless of content.
 */
export function isPromotionalEmail(email: Email): boolean {
    const labels = email.labels ?? [];
    return PROMOTIONAL_LABELS.some(l => labels.includes(l));
}

// ── Keyword fallback ────────────────────────────────────────────────────────

const URGENT_KEYWORDS = [
    'срочно', 'urgent', 'immediately', 'expires', 'overdue', 'deadline', 'last chance',
];

const IMPORTANT_KEYWORDS = [
    'subscription', 'подписка', 'invoice', 'счёт', 'счет', 'payment', 'оплата',
    'billing', 'renewal', 'renewing', 'confirm', 'verify', 'receipt',
    'due date', 'auto-renew', 'автопродление',
];

const ACTION_HINTS: { keywords: string[]; hint: string }[] = [
    { keywords: ['срочно', 'urgent', 'immediately', 'deadline', 'last chance'], hint: 'Требует срочного внимания' },
    { keywords: ['expires', 'overdue'], hint: 'Истекает срок' },
    { keywords: ['invoice', 'счёт', 'счет', 'payment', 'оплата', 'billing', 'due date'], hint: 'Требует оплаты' },
    { keywords: ['subscription', 'подписка', 'renewal', 'renewing', 'auto-renew', 'автопродление'], hint: 'Проверить подписку' },
    { keywords: ['confirm', 'verify'], hint: 'Требует подтверждения' },
    { keywords: ['receipt'], hint: 'Получен чек' },
];

function getActionHint(matchedKeywords: string[], hasGmailImportant: boolean): string {
    for (const { keywords, hint } of ACTION_HINTS) {
        if (matchedKeywords.some(k => keywords.includes(k))) {
            return hint;
        }
    }
    return hasGmailImportant ? 'Отмечено как важное' : 'Требует внимания';
}

function keywordAnalysis(email: Email): Omit<EmailAnalysisWithLog, 'analyzedByAI'> {
    const text = `${email.subject ?? ''} ${email.snippet ?? ''}`.toLowerCase();
    const hasGmailImportant = (email.labels ?? []).includes('IMPORTANT');

    const matchedUrgentKeywords = URGENT_KEYWORDS.filter(k => text.includes(k));
    const matchedImportantKeywords = IMPORTANT_KEYWORDS.filter(k => text.includes(k));
    const matchedKeywords = [...matchedUrgentKeywords, ...matchedImportantKeywords];

    const urgent = matchedUrgentKeywords.length > 0;
    const isImportant = urgent || matchedImportantKeywords.length > 0;

    const dueDate = new Date();
    if (urgent) {
        dueDate.setHours(dueDate.getHours() + 4);
    } else {
        dueDate.setDate(dueDate.getDate() + 1);
        dueDate.setHours(9, 0, 0, 0);
    }

    let priority: number;
    if (urgent) priority = 1;
    else if (hasGmailImportant && matchedImportantKeywords.length > 0) priority = 2;
    else if (matchedImportantKeywords.length > 0) priority = 4;
    else priority = 5;

    return {
        isImportant,
        urgent,
        dueDateISO: dueDate.toISOString(),
        priority,
        actionHint: getActionHint(matchedKeywords, hasGmailImportant),
        matchedKeywords,
        hasGmailImportant,
    };
}

// ── AI analysis ─────────────────────────────────────────────────────────────

interface AIResult {
    requiresAction: boolean;
    actionHint: string;
    priority: number; // 1–4
}

async function analyzeWithAI(email: Email): Promise<AIResult | null> {
    const prompt = `Determine if this email requires action from the user.

From: ${email.fromEmail ?? ''}
Subject: ${email.subject ?? '(No subject)'}
Preview: ${email.snippet ?? ''}

Reply with JSON only, no other text:
{"requiresAction": boolean, "actionHint": "one short sentence in Russian of what to do, or null", "priority": 1 to 4}

requiresAction = true ONLY for: payment due, account verification needed, subscription/renewal deadline, request that needs a reply, access revoked.
requiresAction = false for: promotional ads ("recommended for you", "deals", "sale", "new listing"), newsletters, platform changelogs/digests, "new features" announcements, social media notifications, order shipping updates, receipts for completed payments.
priority: 1=urgent (hours), 2=important (days), 3=moderate, 4=low.`;

    try {
        const response = await AppleIntelligence.generate(prompt);
        const match = response.match(/\{[\s\S]*?\}/);
        if (!match) return null;
        const parsed = JSON.parse(match[0]) as Partial<AIResult>;
        if (typeof parsed.requiresAction !== 'boolean') return null;
        return {
            requiresAction: parsed.requiresAction,
            actionHint: parsed.actionHint ?? 'Требует внимания',
            priority: typeof parsed.priority === 'number'
                ? Math.min(4, Math.max(1, Math.round(parsed.priority)))
                : 4,
        };
    } catch {
        return null;
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

async function analyzeOnServer(email: Email): Promise<EmailAnalysisWithLog | null> {
    try {
        const result = await emailApi.analyze({
            subject: email.subject ?? '',
            snippet: email.snippet ?? '',
            from_email: email.fromEmail ?? '',
            from_name: email.fromName ?? '',
            labels: email.labels ?? [],
        });
        if (!result) return null;
        return {
            isImportant: result.is_important,
            urgent: result.urgent,
            dueDateISO: result.due_date_iso,
            priority: result.priority,
            actionHint: result.action_hint,
            matchedKeywords: [],
            hasGmailImportant: (email.labels ?? []).includes('IMPORTANT'),
            analyzedByAI: true,
        };
    } catch (e) {
        console.warn('[emailAnalyzer] Server analysis failed, falling back to device:', e);
        return null;
    }
}

export async function analyzeEmailWithLog(email: Email): Promise<EmailAnalysisWithLog> {
    const hasGmailImportant = (email.labels ?? []).includes('IMPORTANT');

    const mode = (await AsyncStorage.getItem(EMAIL_ANALYSIS_MODE_KEY)) as EmailAnalysisMode | null;

    if (mode === 'server') {
        const serverResult = await analyzeOnServer(email);
        if (serverResult) return serverResult;
        // Fallback to device on error
    }

    if (AppleIntelligence.isAvailable()) {
        const ai = await analyzeWithAI(email);
        if (ai) {
            const urgent = ai.priority === 1;
            const dueDate = new Date();
            if (urgent) {
                dueDate.setHours(dueDate.getHours() + 4);
            } else {
                dueDate.setDate(dueDate.getDate() + 1);
                dueDate.setHours(9, 0, 0, 0);
            }
            return {
                isImportant: ai.requiresAction,
                urgent,
                dueDateISO: dueDate.toISOString(),
                priority: ai.priority,
                actionHint: ai.actionHint,
                matchedKeywords: [],
                hasGmailImportant,
                analyzedByAI: true,
            };
        }
    }

    // Fallback: keyword matching
    return { ...keywordAnalysis(email), analyzedByAI: false };
}
