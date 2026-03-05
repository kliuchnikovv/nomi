/**
 * Gmail email importance analyzer.
 * Determines whether an email warrants creating an iOS Reminder.
 */

import type { Email } from '@genie/front/services/integrations/IntegrationStorage';

export interface EmailAnalysis {
    isImportant: boolean;
    urgent: boolean;
    dueDateISO: string;
}

export interface EmailAnalysisWithLog extends EmailAnalysis {
    matchedKeywords: string[];
    hasGmailImportant: boolean;
}

const URGENT_KEYWORDS = [
    'срочно', 'urgent', 'immediately', 'expires', 'overdue', 'deadline', 'last chance',
];

const IMPORTANT_KEYWORDS = [
    'subscription', 'подписка', 'invoice', 'счёт', 'счет', 'payment', 'оплата',
    'billing', 'renewal', 'renewing', 'confirm', 'verify', 'receipt', 'invoice',
    'due date', 'auto-renew', 'автопродление',
];

export function analyzeEmail(email: Email): EmailAnalysis {
    const text = `${email.subject ?? ''} ${email.snippet ?? ''}`.toLowerCase();
    const hasGmailImportant = (email.labels ?? []).includes('IMPORTANT');

    const urgent = URGENT_KEYWORDS.some(k => text.includes(k));
    const isImportant =
        urgent ||
        hasGmailImportant ||
        IMPORTANT_KEYWORDS.some(k => text.includes(k));

    const dueDate = new Date();
    if (urgent) {
        dueDate.setHours(dueDate.getHours() + 4);
    } else {
        dueDate.setDate(dueDate.getDate() + 1);
        dueDate.setHours(9, 0, 0, 0);
    }

    return { isImportant, urgent, dueDateISO: dueDate.toISOString() };
}

export function analyzeEmailWithLog(email: Email): EmailAnalysisWithLog {
    const text = `${email.subject ?? ''} ${email.snippet ?? ''}`.toLowerCase();
    const hasGmailImportant = (email.labels ?? []).includes('IMPORTANT');

    const matchedUrgentKeywords = URGENT_KEYWORDS.filter(k => text.includes(k));
    const matchedImportantKeywords = IMPORTANT_KEYWORDS.filter(k => text.includes(k));
    const matchedKeywords = [...matchedUrgentKeywords, ...matchedImportantKeywords];

    const urgent = matchedUrgentKeywords.length > 0;
    const isImportant = urgent || hasGmailImportant || matchedImportantKeywords.length > 0;

    const dueDate = new Date();
    if (urgent) {
        dueDate.setHours(dueDate.getHours() + 4);
    } else {
        dueDate.setDate(dueDate.getDate() + 1);
        dueDate.setHours(9, 0, 0, 0);
    }

    return {
        isImportant,
        urgent,
        dueDateISO: dueDate.toISOString(),
        matchedKeywords,
        hasGmailImportant,
    };
}
