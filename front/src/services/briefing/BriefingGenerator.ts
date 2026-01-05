/**
 * Briefing Generator Service
 * Generates daily briefings from analyzed emails, events, and tasks
 */

import { getApiUrl } from '../../config';
import {
    integrationStorage,
    Briefing,
    BriefingItem,
    AnalyzedEmail,
    Email,
    ExtractedEvent,
    ExtractedTask
} from '../integrations/IntegrationStorage';
import { calendarClient } from '../integrations/clients/CalendarClient';

// Helper to get API base URL (without /api suffix for /api/analyze-email endpoint)
function getBackendUrl(): string {
    const apiUrl = getApiUrl(); // e.g., 'https://...railway.app/api'
    // Remove trailing /api if present to get base URL
    return apiUrl.replace(/\/api\/?$/, '');
}

interface EmailAnalysisResult {
    email_id: string;
    urgency: 'asap' | 'high' | 'normal' | 'low';
    connections: string[];
    time_frame?: string;
    suggested_actions: Array<{
        action_type: string;
        label: string;
        params?: Record<string, any>;
    }>;
}

class BriefingGenerator {
    /**
     * Analyze a single email using the backend API
     */
    async analyzeEmail(email: Email): Promise<EmailAnalysisResult | null> {
        try {
            const response = await fetch(`${getBackendUrl()}/api/analyze-email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email_id: email.id,
                    subject: email.subject,
                    from_email: email.fromEmail,
                    from_name: email.fromName,
                    body: email.bodyText || email.snippet || '',
                    date: email.date?.toISOString(),
                }),
            });

            if (!response.ok) {
                console.error('[BriefingGenerator] Email analysis failed:', response.status);
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error('[BriefingGenerator] Failed to analyze email:', error);
            return null;
        }
    }

    /**
     * Analyze all unanalyzed emails and save results
     */
    async analyzeUnanalyzedEmails(limit: number = 10): Promise<number> {
        const emails = await integrationStorage.getUnanalyzedEmails(limit);
        let analyzed = 0;

        for (const email of emails) {
            const result = await this.analyzeEmail(email);
            if (result) {
                await integrationStorage.saveEmailAnalysis(email.id, {
                    urgency: result.urgency,
                    connections: result.connections,
                    timeFrame: result.time_frame,
                });
                await integrationStorage.markAnalyzed(email.id);
                analyzed++;
            }
        }

        console.log(`[BriefingGenerator] Analyzed ${analyzed}/${emails.length} emails`);
        return analyzed;
    }

    /**
     * Generate daily briefing from analyzed data
     */
    async generateDailyBriefing(date: Date = new Date()): Promise<Briefing | null> {
        const dateStr = this.formatDate(date);

        // Check if briefing already exists
        let briefing = await integrationStorage.getBriefingForDate(dateStr);

        // Helper to track completion status of existing items
        const completionMap = new Map<string, boolean>();

        if (!briefing) {
            briefing = await integrationStorage.createBriefing(
                dateStr,
                'Your daily briefing',
                'Generating...'
            );
        } else {
            // Save existing completion status
            const existingItems = await integrationStorage.getBriefingItems(briefing.id);
            existingItems.forEach(item => {
                if (item.sourceId) {
                    completionMap.set(item.sourceId, item.isCompleted);
                }
            });

            // Clear existing items to prevent duplicates on refresh
            await integrationStorage.clearBriefingItems(briefing.id);
        }

        // Get analyzed emails from the last 24 hours with high/asap urgency
        const asapEmails = await integrationStorage.getAsapEmails();

        // Sync calendar events
        try {
            const integrations = await integrationStorage.getIntegrations();
            const calendarIntegrations = integrations.filter(i => i.provider === 'calendar' && i.enabled);

            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);

            await Promise.all(calendarIntegrations.map(integration =>
                calendarClient.syncEvents(integration.id, startOfDay, endOfDay)
                    .catch(err => console.error(`[BriefingGenerator] Failed to sync calendar ${integration.id}:`, err))
            ));
        } catch (error) {
            console.error('[BriefingGenerator] Failed to sync calendars:', error);
        }

        // Get today's events
        const events = await integrationStorage.getEventsForDate(date);

        // Get pending tasks
        const tasks = await integrationStorage.getPendingTasks();

        let order = 0;

        // Add ASAP/high urgency emails
        for (const analyzed of asapEmails) {
            const email = await integrationStorage.getEmail(analyzed.emailId);
            if (!email) continue;

            const analysis = await this.analyzeEmail(email);
            if (!analysis) continue;

            const isCompleted = completionMap.get(analyzed.emailId) ?? false;

            const item = await integrationStorage.addBriefingItem(briefing.id, {
                sourceType: 'email',
                sourceId: analyzed.emailId,
                title: email.subject || 'No subject',
                description: email.snippet,
                priority: analyzed.urgency,
                displayOrder: order++,
                isCompleted,
            });

            // Add suggested actions
            for (let i = 0; i < analysis.suggested_actions.length; i++) {
                const action = analysis.suggested_actions[i];
                await integrationStorage.addSuggestedAction(item.id, {
                    actionType: action.action_type as any,
                    label: action.label,
                    params: action.params,
                    displayOrder: i,
                });
            }
        }

        // Add today's events
        for (const event of events) {
            const isCompleted = completionMap.get(event.sourceId) ?? false;
            await integrationStorage.addBriefingItem(briefing.id, {
                sourceType: 'event',
                sourceId: event.id,
                title: event.title,
                description: event.location || `Starts: ${event.startDate.toLocaleTimeString()}`,
                priority: 'normal',
                displayOrder: order++,
            });
        }

        // Add high priority tasks
        const highPriorityTasks = tasks.filter(t =>
            t.priority === 'critical' || t.priority === 'high'
        ).slice(0, 5);

        for (const task of highPriorityTasks) {
            const isCompleted = completionMap.get(task.id) ?? false;
            await integrationStorage.addBriefingItem(briefing.id, {
                sourceType: 'task',
                sourceId: task.id,
                title: task.title,
                description: task.dueDate ? `Due: ${task.dueDate.toLocaleDateString()}` : undefined,
                priority: task.priority === 'critical' ? 'asap' : 'high',
                displayOrder: order++,
                isCompleted,
            });
        }

        // Update briefing with summary
        const itemCount = order;
        const asapCount = asapEmails.length;

        let headline = 'Quiet day';
        if (asapCount > 0) {
            headline = `${asapCount} urgent items need attention`;
        } else if (itemCount > 0) {
            headline = `${itemCount} items for today`;
        }

        await integrationStorage.updateBriefing(briefing.id, {
            headline,
            summary: `Emails: ${asapEmails.length}, Events: ${events.length}, Tasks: ${highPriorityTasks.length}`
        });

        console.log(`[BriefingGenerator] Generated briefing for ${dateStr} with ${itemCount} items`);
        return briefing;
    }

    /**
     * Handle incoming ASAP email - inject into today's briefing if needed
     */
    async handleAsapEmail(emailId: string): Promise<boolean> {
        const analysis = await integrationStorage.getEmailAnalysis(emailId);

        if (!analysis || analysis.urgency !== 'asap') {
            return false;
        }

        const today = this.formatDate(new Date());
        let briefing = await integrationStorage.getBriefingForDate(today);

        if (!briefing) {
            // No briefing for today yet, just generate one
            await this.generateDailyBriefing();
            return true;
        }

        // Add to existing briefing
        const email = await integrationStorage.getEmail(emailId);
        if (!email) return false;

        const items = await integrationStorage.getBriefingItems(briefing.id);
        const existingItem = items.find(i => i.sourceId === emailId);

        if (existingItem) {
            // Already in briefing
            return false;
        }

        // Analyze to get actions
        const emailAnalysis = await this.analyzeEmail(email);

        const item = await integrationStorage.addBriefingItem(briefing.id, {
            sourceType: 'email',
            sourceId: emailId,
            title: `🔴 URGENT: ${email.subject || 'No subject'}`,
            description: email.snippet,
            priority: 'asap',
            displayOrder: 0, // Put at top
        });

        // Add actions if available
        if (emailAnalysis?.suggested_actions) {
            for (let i = 0; i < emailAnalysis.suggested_actions.length; i++) {
                const action = emailAnalysis.suggested_actions[i];
                await integrationStorage.addSuggestedAction(item.id, {
                    actionType: action.action_type as any,
                    label: action.label,
                    params: action.params,
                    displayOrder: i,
                });
            }
        }

        // Update briefing headline
        const progress = await integrationStorage.getBriefingProgress(briefing.id);
        await integrationStorage.updateBriefing(briefing.id, {
            headline: `🔴 New urgent message! ${progress.total} items for today`,
        });

        console.log(`[BriefingGenerator] Injected ASAP email into today's briefing: ${emailId}`);
        return true;
    }

    /**
     * Check if briefing needs regeneration
     * Returns true if last briefing is older than 12 hours or doesn't exist
     */
    async shouldRegenerateBriefing(): Promise<boolean> {
        const today = this.formatDate(new Date());
        const briefing = await integrationStorage.getBriefingForDate(today);

        if (!briefing) {
            return true;
        }

        const ageMs = Date.now() - briefing.createdAt.getTime();
        const twelveHours = 12 * 60 * 60 * 1000;

        return ageMs > twelveHours;
    }

    /**
     * Get current briefing with full items and progress
     */
    async getCurrentBriefing(): Promise<{
        briefing: Briefing | null;
        items: BriefingItem[];
        progress: { total: number; completed: number };
    }> {
        const today = this.formatDate(new Date());
        const briefing = await integrationStorage.getBriefingForDate(today);

        if (!briefing) {
            return { briefing: null, items: [], progress: { total: 0, completed: 0 } };
        }

        const items = await integrationStorage.getBriefingItems(briefing.id);
        const progress = await integrationStorage.getBriefingProgress(briefing.id);

        return { briefing, items, progress };
    }

    /**
     * Format date as YYYY-MM-DD
     */
    private formatDate(date: Date): string {
        return date.toISOString().split('T')[0];
    }
}

export const briefingGenerator = new BriefingGenerator();
