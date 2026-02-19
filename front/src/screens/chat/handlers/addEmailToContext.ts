/**
 * Add Email to Context Handler
 *
 * Handles adding Gmail emails to chat context.
 * When user taps on an email, it's added as a ContextItem instead of creating a message.
 *
 * The context item is displayed in the chat footer and provides context for AI responses.
 */

import { eventEmitter, RAG_EVENTS } from '@genie/front/services/events';
import type { Email } from '@genie/front/services/integrations/IntegrationStorage';

/**
 * Add an email to the current chat context
 *
 * @param email The email to add to context
 * @returns void
 */
export async function addEmailToContext(email: Email): Promise<void> {
    console.log(`[addEmailToContext] Adding email ${email.gmailId} to context`);

    // Generate preview text showing sender and subject
    const from = email.fromName || email.fromEmail || 'Unknown sender';
    const previewText = `From: ${from}${email.fromName && email.fromEmail ? ` <${email.fromEmail}>` : ''}`;

    // Emit RAG event to trigger context item addition
    eventEmitter.emit(RAG_EVENTS.DOCUMENT_ADDED, {
        id: email.gmailId,
        sourceType: 'email',
        title: email.subject || '(No subject)',
        preview: previewText,
        metadata: {
            gmailId: email.gmailId,
            id: email.id,
            integrationId: email.integrationId,
            threadId: email.threadId,
            subject: email.subject,
            snippet: email.snippet,
            from: email.fromEmail,
            fromName: email.fromName,
            toEmails: email.toEmails,
            date: email.date?.toISOString(),
            labels: email.labels,
        },
    });

    console.log(`[addEmailToContext] Email ${email.gmailId} added to context successfully`);
}
