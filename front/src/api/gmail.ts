import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { getIntegration } from '../store/db';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

export class GmailClient {
    private async getAccessToken() {
        const integration = getIntegration('gmail');
        if (!integration || !integration.enabled) return null;

        const creds = JSON.parse(integration.credentials);
        // Note: In a real app, you would handle token refresh here if the access token is expired
        // utilizing the refresh_token stored in creds.
        // For now, we assume the token from GoogleSignin (or refreshed via it) is valid.

        // Actually, with GoogleSignin, we might need to rely on the library to get tokens
        const currentUser = GoogleSignin.getCurrentUser();
        if (currentUser) {
           const tokens = await GoogleSignin.getTokens();
           return tokens.accessToken;
        }
        return creds.access_token;
    }

    async listMessages(maxResults = 10) {
        const token = await this.getAccessToken();
        if (!token) throw new Error('Not authenticated');

        const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Failed to fetch messages');

        const data = await response.json();
        if (!data.messages) return [];

        // Fetch details for each message
        const messages = await Promise.all(data.messages.map(async (msg: any) => {
            const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return detailRes.json();
        }));

        return messages.map((m: any) => ({
            id: m.id,
            snippet: m.snippet,
            from: m.payload.headers.find((h: any) => h.name === 'From')?.value,
            subject: m.payload.headers.find((h: any) => h.name === 'Subject')?.value,
            date: m.payload.headers.find((h: any) => h.name === 'Date')?.value,
        }));
    }
}
