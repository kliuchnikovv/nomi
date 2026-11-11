/**
 * IMAP Email client plugin: executes IMAP/SMTP tool actions.
 */

import type { ClientPluginHandler } from '@nomi/front/plugins/clientRegistry';
import { imapEmailClient } from '@nomi/front/services/integrations/clients/IMAPEmailClient';

export const imapEmailPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const client = imapEmailClient;

        switch (method) {
            case 'test_connection': {
                const integrationId = params.integration_id;
                const credentials = await client['getCredentials'](integrationId);
                const result = await client.testConnection(credentials);
                if (result.success) {
                    return `Connection successful: ${result.message}`;
                }
                return `Connection failed: ${result.message}`;
            }

            case 'list_mailboxes': {
                const integrationId = params.integration_id;
                const mailboxes = await client.listMailboxes(integrationId);
                if (mailboxes.length === 0) {
                    return 'No mailboxes found.';
                }
                let result = `Found ${mailboxes.length} mailboxes:\n\n`;
                mailboxes.forEach(m => {
                    result += `- ${m.name}\n`;
                });
                return result;
            }

            case 'get_recent_emails': {
                const integrationId = params.integration_id;
                const mailbox = params.mailbox || 'INBOX';
                const limit = params.limit || 20;

                const emails = await client.fetchEmails(integrationId, mailbox, limit);
                if (emails.length === 0) {
                    return 'No emails found. Try syncing first with sync_emails.';
                }

                let result = `Found ${emails.length} recent emails in ${mailbox}:\n\n`;
                emails.slice(0, 10).forEach(email => {
                    result += `• [${email.uid}] ${email.from}: ${email.subject}\n`;
                });

                if (emails.length > 10) {
                    result += `\n...and ${emails.length - 10} more emails.`;
                }
                return result;
            }

            case 'sync_emails': {
                const integrationId = params.integration_id;
                const mailbox = params.mailbox || 'INBOX';
                const limit = params.limit || 100;

                const emails = await client.syncEmails(integrationId, mailbox, limit);
                if (emails.length === 0) {
                    return `No new emails to sync in ${mailbox}.`;
                }

                let result = `Synced ${emails.length} emails from ${mailbox}:\n\n`;
                emails.slice(0, 10).forEach(email => {
                    const flags = email.flags.length > 0 ? ` [${email.flags.join(', ')}]` : '';
                    result += `• [${email.uid}]${flags} ${email.from}: ${email.subject}\n`;
                });

                if (emails.length > 10) {
                    result += `\n...and ${emails.length - 10} more emails.`;
                }
                return result;
            }

            case 'get_email_body': {
                const integrationId = params.integration_id;
                const uid = params.uid;
                const mailbox = params.mailbox || 'INBOX';

                const body = await client.fetchEmailBody(integrationId, uid, mailbox);
                const truncated = body.length > 2000 ? body.substring(0, 2000) + '\n\n[truncated...]' : body;
                return `Email body (UID ${uid}):\n\n${truncated}`;
            }

            case 'send_email': {
                const integrationId = params.integration_id;
                const to = params.to;
                const subject = params.subject;
                const body = params.body;
                const from = params.from;

                const result = await client.sendEmail(integrationId, to, subject, body, { from });
                if (result.success) {
                    return `Email sent successfully to ${to}: ${result.message}`;
                }
                return `Failed to send email: ${result.message}`;
            }

            case 'reply_email': {
                const integrationId = params.integration_id;
                const uid = params.uid;
                const mailbox = params.mailbox || 'INBOX';
                const body = params.body;

                const result = await client.replyToEmail(integrationId, uid, mailbox, body);
                if (result.success) {
                    return `Reply sent successfully: ${result.message}`;
                }
                return `Failed to send reply: ${result.message}`;
            }

            case 'move_email': {
                const integrationId = params.integration_id;
                const uid = params.uid;
                const mailbox = params.mailbox;
                const destinationMailbox = params.destination_mailbox;

                const result = await client.moveEmail(integrationId, mailbox, uid, destinationMailbox);
                if (result.success) {
                    return `Moved email ${uid} from ${mailbox} to ${destinationMailbox}`;
                }
                return `Failed to move email: ${JSON.stringify(result)}`;
            }

            case 'archive_email': {
                const integrationId = params.integration_id;
                const uid = params.uid;
                const mailbox = params.mailbox;

                const result = await client.archiveEmail(integrationId, mailbox, uid);
                if (result.success) {
                    return `Archived email ${uid} from ${mailbox}`;
                }
                return `Failed to archive email`;
            }

            case 'delete_email': {
                const integrationId = params.integration_id;
                const uid = params.uid;
                const mailbox = params.mailbox;

                const result = await client.deleteEmail(integrationId, mailbox, uid);
                if (result.success) {
                    return `Deleted email ${uid} from ${mailbox}`;
                }
                return `Failed to delete email`;
            }

            case 'mark_email': {
                const integrationId = params.integration_id;
                const uid = params.uid;
                const mailbox = params.mailbox;
                const flag = params.flag;
                const remove = params.remove || false;

                const action = remove ? 'removed' : 'added';
                const result = await client.setFlag(integrationId, mailbox, uid, flag, remove);
                if (result.success) {
                    return `Successfully ${action} flag ${flag} to email ${uid}`;
                }
                return `Failed to set flag`;
            }

            case 'search_emails': {
                const query = params.query;
                const integrationId = params.integration_id;

                const results = await client.searchEmailsSemantic(query, integrationId);
                if (results.length === 0) {
                    return `No emails found matching "${query}"`;
                }

                let response = `Found ${results.length} emails matching "${query}":\n\n`;
                results.forEach((r: any) => {
                    const meta = r.metadata || {};
                    response += `• [UID ${meta.uid || '?'}] ${meta.from || 'Unknown'}: ${meta.subject || 'No subject'}\n`;
                });
                return response;
            }

            case 'search_emails_server': {
                const integrationId = params.integration_id;
                const criteria = params.criteria;
                const mailbox = params.mailbox || 'INBOX';
                const limit = params.limit || 50;

                const emails = await client.searchImapServer(integrationId, criteria, mailbox, limit);
                if (emails.length === 0) {
                    return `No emails found on server matching criteria: ${criteria}`;
                }

                let response = `Found ${emails.length} emails on server:\n\n`;
                emails.slice(0, 10).forEach(email => {
                    const flags = email.flags.length > 0 ? ` [${email.flags.join(', ')}]` : '';
                    response += `• [${email.uid}]${flags} ${email.from}: ${email.subject}\n`;
                });

                if (emails.length > 10) {
                    response += `\n...and ${emails.length - 10} more emails.`;
                }
                return response;
            }

            default:
                throw new Error(`Unknown IMAP Email method: ${method}`);
        }
    },
};
