import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { getIntegration } from '../store/db';

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

export class CalendarClient {
    private async getAccessToken() {
        const integration = getIntegration('calendar');
        if (!integration || !integration.enabled) return null;

        const creds = JSON.parse(integration.credentials);

        const currentUser = GoogleSignin.getCurrentUser();
        if (currentUser) {
           const tokens = await GoogleSignin.getTokens();
           return tokens.accessToken;
        }
        return creds.access_token;
    }

    async listEvents(maxResults = 10) {
        const token = await this.getAccessToken();
        if (!token) throw new Error('Not authenticated');

        const now = new Date().toISOString();
        const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=${maxResults}&timeMin=${now}&singleEvents=true&orderBy=startTime`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Failed to fetch events');

        const data = await response.json();
        return data.items.map((item: any) => ({
            id: item.id,
            summary: item.summary,
            start: item.start.dateTime || item.start.date,
            end: item.end.dateTime || item.end.date,
            location: item.location,
            link: item.htmlLink
        }));
    }
}
