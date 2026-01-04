import { tokenRefreshService } from '../TokenRefreshService';

export interface Email {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: Date;
  link: string;
}

export class GmailClient {
  async getRecentEmails(integrationId: string, maxResults = 10): Promise<Email[]> {
    const accessToken = await tokenRefreshService.refreshIfNeeded(integrationId);

    // Filter: last 24 hours (roughly).
    // Gmail query `newer_than:1d` is perfect for this.
    const query = 'newer_than:1d';

    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        throw new Error(`Gmail API error: ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.messages) return [];

    // Fetch details for each message
    const emails: Email[] = [];
    for (const msg of data.messages) {
      const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const detail = await detailRes.json();

      const headers = detail.payload.headers;
      const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(No Subject)';
      const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
      const dateStr = headers.find((h: any) => h.name === 'Date')?.value;

      emails.push({
        id: detail.id,
        snippet: detail.snippet,
        subject,
        from,
        date: dateStr ? new Date(dateStr) : new Date(),
        link: `https://mail.google.com/mail/u/0/#inbox/${detail.id}`
      });
    }

    return emails;
  }
}

export const gmailClient = new GmailClient();
