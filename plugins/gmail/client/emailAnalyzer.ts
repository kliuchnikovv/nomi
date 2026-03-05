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
