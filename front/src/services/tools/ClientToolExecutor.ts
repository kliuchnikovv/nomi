import { gmailClient } from '../integrations/clients/GmailClient';
import { calendarClient } from '../integrations/clients/CalendarClient';

export interface ClientToolAction {
    tool: string;
    method: string;
    params: Record<string, any>;
}

export class ClientToolExecutor {
    /**
     * Execute a client-side tool action
     */
    async execute(action: ClientToolAction): Promise<string> {
        console.log(`[ClientToolExecutor] Executing ${action.tool}.${action.method}`, action.params);

        try {
            switch (action.tool) {
                case 'gmail':
                    return await this.executeGmailAction(action.method, action.params);
                case 'calendar':
                    return await this.executeCalendarAction(action.method, action.params);
                default:
                    throw new Error(`Unknown tool: ${action.tool}`);
            }
        } catch (error: any) {
            console.error(`[ClientToolExecutor] Execution failed:`, error);
            return `Error executing default.${action.tool}.${action.method}: ${error.message || String(error)}`;
        }
    }

    private async executeGmailAction(method: string, params: Record<string, any>): Promise<string> {
        // We assume integrationId is 'gmail-default' for now, or passed in params if we support multiple accounts
        // Ideally the backend should pass the integrationId needed, or we infer it.
        // For this architecture, let's assume a single main account per provider for simplicity or lookup.
        // But wait, the backend doesn't know the integrationId local ID.
        // However, the *client* knows the user's integrations.
        // For now, let's default to the first available Gmail integration or a fixed ID if we only support one.
        // IMPORTANT: The backend 'client_side.py' doesn't send integrationId currently.
        // We will need to look it up.

        // Dynamic import to avoid circular depends if necessary, although here it's fine.
        const { integrationStorage } = await import('../integrations/IntegrationStorage');
        const integrations = await integrationStorage.getIntegrations();
        const gmailInteg = integrations.find(i => i.provider === 'gmail' && i.enabled);

        if (!gmailInteg) {
            throw new Error('No active Gmail integration found on device');
        }

        const integrationId = gmailInteg.id;

        switch (method) {
            case 'send_email':
                await gmailClient.sendEmail(integrationId, params.to, params.subject, params.body);
                return `Email sent to ${params.to}`;

            case 'get_recent_emails':
                const emails = await gmailClient.getRecentEmails(integrationId, params.limit || 5);
                return JSON.stringify(emails.map(e => ({
                    id: e.gmailId,
                    from: e.fromEmail,
                    subject: e.subject,
                    date: e.date,
                    snippet: e.snippet
                })));

            case 'search_emails':
                const searchResults = await gmailClient.searchEmails(integrationId, params.query, params.max_results || 5);
                return JSON.stringify(searchResults.map(e => ({
                    id: e.gmailId,
                    from: e.fromEmail,
                    subject: e.subject,
                    date: e.date,
                    snippet: e.snippet,
                    body: e.bodyText?.substring(0, 200) // Truncate body for RAG context
                })));

            case 'get_email':
                const email = await gmailClient.fetchEmail(integrationId, params.message_id);
                if (!email) return "Email not found";
                return JSON.stringify({
                    id: email.gmailId,
                    from: email.fromEmail,
                    subject: email.subject,
                    date: email.date,
                    body: email.bodyText || email.bodyHtml
                });

            case 'reply_email':
                await gmailClient.replyToEmail(integrationId, params.message_id, params.body);
                return `Replied to email ${params.message_id}`;

            case 'create_draft':
                await gmailClient.createDraft(integrationId, params.to, params.subject, params.body);
                return `Draft created for ${params.to}`;

            default:
                throw new Error(`Unknown Gmail method: ${method}`);
        }
    }

    private async executeCalendarAction(method: string, params: Record<string, any>): Promise<string> {
        const { integrationStorage } = await import('../integrations/IntegrationStorage');
        const integrations = await integrationStorage.getIntegrations();
        const calInteg = integrations.find(i => i.provider === 'calendar' && i.enabled);

        if (!calInteg) {
            throw new Error('No active Calendar integration found on device');
        }

        const integrationId = calInteg.id;

        switch (method) {
            case 'create_event':
                await calendarClient.createEvent(integrationId, {
                    summary: params.title,
                    start: { dateTime: params.start },
                    end: { dateTime: params.end },
                    description: params.description,
                    attendees: params.attendees?.map((email: string) => ({ email }))
                });
                return `Event '${params.title}' created`;
            default:
                throw new Error(`Unknown Calendar method: ${method}`);
        }
    }
}

export const clientToolExecutor = new ClientToolExecutor();
