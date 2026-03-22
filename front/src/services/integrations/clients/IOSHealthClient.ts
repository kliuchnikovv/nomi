/**
 * iOS Health Client
 * Uses React Native module to access HealthKit health and fitness data
 */

import { NativeModules, Platform } from 'react-native';
import { ragApi } from '../../../apiClient';

const { IOSHealthManager } = NativeModules;

// Type Definitions
export type HealthCategory = 'activity' | 'heart' | 'sleep' | 'body' | 'nutrition' | 'workouts';
export type MetricType = 'weight' | 'height' | 'bmi' | 'bodyFat';
export type IntervalType = 'hour' | 'day' | 'week';

export interface PermissionStatus {
    available: boolean;
    authorized: string[];
}

export interface StepData {
    date: string;
    value: number;
    unit: string;
}

export interface ActivitySummary {
    steps: number;
    distance: number; // meters
    activeEnergy: number; // kcal
    exerciseMinutes: number;
    standHours: number;
    flightsClimbed: number;
}

export interface HeartRateMeasurement {
    date: string;
    value: number;
    unit: string; // "bpm"
}

export interface SleepAnalysis {
    date: string;
    inBedStart: string;
    inBedEnd: string;
    asleepStart?: string;
    asleepEnd?: string;
    duration: number; // hours
    stages?: Array<{ type: string; duration: number }>;
}

export interface BodyMetric {
    date: string;
    value: number;
    unit: string;
}

export interface NutritionSummary {
    calories: number;
    protein: number; // grams
    carbs: number; // grams
    fat: number; // grams
    water: number; // ml
}

export interface Workout {
    id: string;
    type: string;
    start: string;
    end: string;
    duration: number; // minutes
    calories: number;
    distance?: number; // meters
    metadata?: Record<string, any>;
}

export interface DailySummary {
    date: string;
    activity?: ActivitySummary;
    heart?: {
        avg: number;
        resting?: number;
        min: number;
        max: number;
    };
    sleep?: {
        duration: number;
        quality: string;
    };
    workouts?: Array<{
        type: string;
        duration: number;
        calories: number;
    }>;
}

export interface WeeklySummary {
    summaries: DailySummary[];
}

class IOSHealthClient {
    /**
     * Helper method to handle permission errors and auto-request permissions
     */
    private async handlePermissionError<T>(
        error: any,
        categories: HealthCategory[],
        retryFn: () => Promise<T>
    ): Promise<T> {
        if (error?.code === 'PERMISSION_DENIED') {
            console.log(`[IOSHealthClient] Permission denied, requesting permissions for: ${categories.join(', ')}`);
            const permissionResult = await this.requestPermission(categories);
            if (permissionResult.granted) {
                console.log('[IOSHealthClient] Permissions granted, retrying operation...');
                return await retryFn();
            }
            throw new Error(`HealthKit permission was denied by user. Please grant access in Settings → Privacy → Health → genie`);
        }
        throw error;
    }

    // #region agent log
    private ensureAvailable(): void {
        // Hypothesis B: Check if NativeModule is registered
        const hasModule = !!IOSHealthManager;
        const platformOS = Platform.OS;
        const nativeModulesKeys = Object.keys(NativeModules);
        const hasHealthModuleInRegistry = nativeModulesKeys.includes('IOSHealthManager');

        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/integrations/clients/IOSHealthClient.ts:103',message:'IOSHealthManager availability check',data:{hasModule,platformOS,hasHealthModuleInRegistry,nativeModulesKeys:nativeModulesKeys.slice(0,20)},timestamp:Date.now()})}).catch(()=>{});

        if (!IOSHealthManager) {
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/integrations/clients/IOSHealthClient.ts:103',message:'IOSHealthManager module NOT FOUND',data:{hasModule,platformOS,nativeModulesKeys:nativeModulesKeys.slice(0,20)},timestamp:Date.now()})}).catch(()=>{});
            throw new Error('IOSHealthManager is not available. Make sure iOS native module is properly linked.');
        }
        if (Platform.OS !== 'ios') {
            throw new Error('Apple Health is only available on iOS devices.');
        }
    }
    // #endregion

    // MARK: - Permission Management

    /**
     * Check HealthKit availability and authorization status
     */
    async checkPermissionStatus(): Promise<PermissionStatus> {
        this.ensureAvailable();
        try {
            const status: PermissionStatus = await IOSHealthManager.checkPermissionStatus();
            return status;
        } catch (error) {
            console.error('[IOSHealthClient] checkPermissionStatus error:', error);
            throw error;
        }
    }

    /**
     * Request HealthKit permissions for specified categories
     */
    async requestPermission(categories: HealthCategory[]): Promise<{ granted: boolean; categories: string[] }> {
        this.ensureAvailable();
        try {
            const result = await IOSHealthManager.requestPermission(categories);
            return result;
        } catch (error) {
            console.error('[IOSHealthClient] requestPermission error:', error);
            throw error;
        }
    }

    // MARK: - Activity Queries

    /**
     * Get step count for date range with optional interval grouping
     */
    async getSteps(startDate: string, endDate: string, interval: IntervalType = 'day'): Promise<StepData[]> {
        this.ensureAvailable();

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/integrations/clients/IOSHealthClient.ts:157',message:'getSteps called',data:{startDate,endDate,interval},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        try {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/integrations/clients/IOSHealthClient.ts:163',message:'Calling IOSHealthManager.getSteps',data:{startDate,endDate,interval},timestamp:Date.now()})}).catch(()=>{});
            // #endregion

            const steps: StepData[] = await IOSHealthManager.getSteps(startDate, endDate, interval);

            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/integrations/clients/IOSHealthClient.ts:169',message:'IOSHealthManager.getSteps returned',data:{stepsCount:steps?.length,steps:steps?.slice(0,2)},timestamp:Date.now()})}).catch(()=>{});
            // #endregion

            return steps;
        } catch (error: any) {
            console.error('[IOSHealthClient] getSteps error:', error);

            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/services/integrations/clients/IOSHealthClient.ts:176',message:'getSteps error',data:{error:String(error),errorMessage:error?.message},timestamp:Date.now()})}).catch(()=>{});
            // #endregion

            // If permission denied, request permission and retry
            return await this.handlePermissionError(error, ['activity'], () =>
                IOSHealthManager.getSteps(startDate, endDate, interval)
            );
        }
    }

    /**
     * Get comprehensive activity summary
     */
    async getActivitySummary(startDate: string, endDate: string): Promise<ActivitySummary> {
        this.ensureAvailable();
        try {
            const summary: ActivitySummary = await IOSHealthManager.getActivitySummary(startDate, endDate);
            return summary;
        } catch (error: any) {
            console.error('[IOSHealthClient] getActivitySummary error:', error);
            return await this.handlePermissionError(error, ['activity'], () =>
                IOSHealthManager.getActivitySummary(startDate, endDate)
            );
        }
    }

    // MARK: - Heart Queries

    /**
     * Get heart rate measurements
     */
    async getHeartRate(startDate: string, endDate: string, limit: number = 100): Promise<HeartRateMeasurement[]> {
        this.ensureAvailable();
        try {
            const heartRates: HeartRateMeasurement[] = await IOSHealthManager.getHeartRate(startDate, endDate, limit);
            return heartRates;
        } catch (error: any) {
            console.error('[IOSHealthClient] getHeartRate error:', error);
            return await this.handlePermissionError(error, ['heart'], () =>
                IOSHealthManager.getHeartRate(startDate, endDate, limit)
            );
        }
    }

    /**
     * Get resting heart rate data
     */
    async getRestingHeartRate(startDate: string, endDate: string): Promise<HeartRateMeasurement[]> {
        this.ensureAvailable();
        try {
            const restingHR: HeartRateMeasurement[] = await IOSHealthManager.getRestingHeartRate(startDate, endDate);
            return restingHR;
        } catch (error: any) {
            console.error('[IOSHealthClient] getRestingHeartRate error:', error);
            return await this.handlePermissionError(error, ['heart'], () =>
                IOSHealthManager.getRestingHeartRate(startDate, endDate)
            );
        }
    }

    // MARK: - Sleep Analysis

    /**
     * Get sleep analysis data
     */
    async getSleepAnalysis(startDate: string, endDate: string): Promise<SleepAnalysis[]> {
        this.ensureAvailable();
        try {
            const sleepData: SleepAnalysis[] = await IOSHealthManager.getSleepAnalysis(startDate, endDate);
            return sleepData;
        } catch (error: any) {
            console.error('[IOSHealthClient] getSleepAnalysis error:', error);
            return await this.handlePermissionError(error, ['sleep'], () =>
                IOSHealthManager.getSleepAnalysis(startDate, endDate)
            );
        }
    }

    // MARK: - Body Metrics

    /**
     * Get body measurements over time
     */
    async getBodyMetrics(metricType: MetricType, startDate: string, endDate: string): Promise<BodyMetric[]> {
        this.ensureAvailable();
        try {
            const metrics: BodyMetric[] = await IOSHealthManager.getBodyMetrics(metricType, startDate, endDate);
            return metrics;
        } catch (error: any) {
            console.error('[IOSHealthClient] getBodyMetrics error:', error);
            return await this.handlePermissionError(error, ['body'], () =>
                IOSHealthManager.getBodyMetrics(metricType, startDate, endDate)
            );
        }
    }

    /**
     * Get the most recent body measurement
     */
    async getLatestBodyMetric(metricType: MetricType): Promise<BodyMetric> {
        this.ensureAvailable();
        try {
            const metric: BodyMetric = await IOSHealthManager.getLatestBodyMetric(metricType);
            return metric;
        } catch (error: any) {
            console.error('[IOSHealthClient] getLatestBodyMetric error:', error);
            return await this.handlePermissionError(error, ['body'], () =>
                IOSHealthManager.getLatestBodyMetric(metricType)
            );
        }
    }

    // MARK: - Nutrition

    /**
     * Get nutrition summary
     */
    async getNutritionSummary(startDate: string, endDate: string): Promise<NutritionSummary> {
        this.ensureAvailable();
        try {
            const summary: NutritionSummary = await IOSHealthManager.getNutritionSummary(startDate, endDate);
            return summary;
        } catch (error: any) {
            console.error('[IOSHealthClient] getNutritionSummary error:', error);
            return await this.handlePermissionError(error, ['nutrition'], () =>
                IOSHealthManager.getNutritionSummary(startDate, endDate)
            );
        }
    }

    // MARK: - Workouts

    /**
     * Get workout sessions
     */
    async getWorkouts(startDate: string, endDate: string, workoutType?: string, limit: number = 20): Promise<Workout[]> {
        this.ensureAvailable();
        try {
            const workouts: Workout[] = await IOSHealthManager.getWorkouts(
                startDate,
                endDate,
                workoutType || '',
                limit
            );
            return workouts;
        } catch (error: any) {
            console.error('[IOSHealthClient] getWorkouts error:', error);
            return await this.handlePermissionError(error, ['workouts'], () =>
                IOSHealthManager.getWorkouts(startDate, endDate, workoutType || '', limit)
            );
        }
    }

    // MARK: - Aggregated Summaries

    /**
     * Get comprehensive daily health summary
     */
    async getDailySummary(date: string): Promise<DailySummary> {
        this.ensureAvailable();
        try {
            const summary: DailySummary = await IOSHealthManager.getDailySummary(date);
            return summary;
        } catch (error: any) {
            console.error('[IOSHealthClient] getDailySummary error:', error);
            // Daily summary needs all categories
            return await this.handlePermissionError(error, ['activity', 'heart', 'sleep', 'workouts'], () =>
                IOSHealthManager.getDailySummary(date)
            );
        }
    }

    /**
     * Get 7-day aggregated health summary
     */
    async getWeeklySummary(startDate: string): Promise<WeeklySummary> {
        this.ensureAvailable();
        try {
            const summary: WeeklySummary = await IOSHealthManager.getWeeklySummary(startDate);
            return summary;
        } catch (error: any) {
            console.error('[IOSHealthClient] getWeeklySummary error:', error);
            // Weekly summary needs all categories
            return await this.handlePermissionError(error, ['activity', 'heart', 'sleep', 'workouts'], () =>
                IOSHealthManager.getWeeklySummary(startDate)
            );
        }
    }

    // MARK: - Write Operations

    /**
     * Log a workout session to HealthKit
     */
    async addWorkout(
        type: string,
        start: string,
        duration: number,
        calories: number,
        distance: number = 0,
        metadata: Record<string, any> = {}
    ): Promise<{ success: boolean; id: string }> {
        this.ensureAvailable();
        try {
            const result = await IOSHealthManager.addWorkout(type, start, duration, calories, distance, metadata);
            return result;
        } catch (error: any) {
            console.error('[IOSHealthClient] addWorkout error:', error);
            return await this.handlePermissionError(error, ['workouts'], () =>
                IOSHealthManager.addWorkout(type, start, duration, calories, distance, metadata)
            );
        }
    }

    /**
     * Log a body measurement to HealthKit
     */
    async addBodyMetric(metricType: MetricType, value: number, date: string): Promise<{ success: boolean; id: string }> {
        this.ensureAvailable();
        try {
            const result = await IOSHealthManager.addBodyMetric(metricType, value, date);
            return result;
        } catch (error: any) {
            console.error('[IOSHealthClient] addBodyMetric error:', error);
            return await this.handlePermissionError(error, ['body'], () =>
                IOSHealthManager.addBodyMetric(metricType, value, date)
            );
        }
    }

    /**
     * Log nutrition data to HealthKit
     */
    async addNutritionEntry(
        calories: number,
        protein: number,
        carbs: number,
        fat: number,
        water: number,
        date: string
    ): Promise<{ success: boolean }> {
        this.ensureAvailable();
        try {
            const result = await IOSHealthManager.addNutritionEntry(calories, protein, carbs, fat, water, date);
            return result;
        } catch (error: any) {
            console.error('[IOSHealthClient] addNutritionEntry error:', error);
            return await this.handlePermissionError(error, ['nutrition'], () =>
                IOSHealthManager.addNutritionEntry(calories, protein, carbs, fat, water, date)
            );
        }
    }

    /**
     * Manually log a sleep session to HealthKit
     */
    async addSleepSession(
        inBedStart: string,
        inBedEnd: string,
        asleepStart: string,
        asleepEnd: string
    ): Promise<{ success: boolean }> {
        this.ensureAvailable();
        try {
            const result = await IOSHealthManager.addSleepSession(inBedStart, inBedEnd, asleepStart, asleepEnd);
            return result;
        } catch (error: any) {
            console.error('[IOSHealthClient] addSleepSession error:', error);
            return await this.handlePermissionError(error, ['sleep'], () =>
                IOSHealthManager.addSleepSession(inBedStart, inBedEnd, asleepStart, asleepEnd)
            );
        }
    }

    /**
     * Delete a health record from HealthKit
     */
    async deleteHealthRecord(recordType: string, recordId: string): Promise<{ success: boolean }> {
        this.ensureAvailable();
        try {
            const result = await IOSHealthManager.deleteHealthRecord(recordType, recordId);
            return result;
        } catch (error: any) {
            console.error('[IOSHealthClient] deleteHealthRecord error:', error);
            // Delete requires the same permissions as the record type being deleted
            const categoryMap: Record<string, HealthCategory[]> = {
                'workout': ['workouts'],
                'body_metric': ['body'],
                'nutrition': ['nutrition'],
                'sleep': ['sleep']
            };
            const categories = categoryMap[recordType] || ['activity'];
            return await this.handlePermissionError(error, categories, () =>
                IOSHealthManager.deleteHealthRecord(recordType, recordId)
            );
        }
    }

    // MARK: - RAG Integration

    /**
     * Index the last 30 days of health data into the backend RAG store.
     * Follows the same pattern as IOSCalendarClient, IOSRemindersClient, IOSContactsClient.
     */
    async indexForRAG(integrationId: string): Promise<void> {
        if (Platform.OS !== 'ios') {
            console.warn('[IOSHealthClient] RAG indexing is iOS only');
            return;
        }

        try {
            const today = new Date();
            let indexed = 0;
            for (let i = 0; i < 30; i++) {
                const d = new Date(today);
                d.setDate(today.getDate() - i);
                const date = d.toISOString().split('T')[0];

                let summary: DailySummary;
                try {
                    summary = await this.getDailySummary(date);
                } catch {
                    continue; // skip days with no data or permission errors
                }

                const parts: string[] = [`Health summary for ${date}.`];
                if (summary.activity) {
                    const a = summary.activity;
                    parts.push(`Activity: ${a.steps} steps, ${Math.round(a.distance)} m distance, ${Math.round(a.activeEnergy)} kcal active energy, ${a.exerciseMinutes} min exercise, ${a.standHours} stand hours.`);
                }
                if (summary.heart) {
                    const h = summary.heart;
                    parts.push(`Heart rate: avg ${h.avg} bpm${h.resting ? `, resting ${h.resting} bpm` : ''}, range ${h.min}–${h.max} bpm.`);
                }
                if (summary.sleep) {
                    parts.push(`Sleep: ${summary.sleep.duration.toFixed(1)} hours (${summary.sleep.quality}).`);
                }
                if (summary.workouts?.length) {
                    const wStr = summary.workouts.map(w => `${w.type} ${w.duration} min ${w.calories} kcal`).join(', ');
                    parts.push(`Workouts: ${wStr}.`);
                }

                const content = parts.join(' ');
                await ragApi.index({
                    id: `ios_health_${integrationId}_${date}`,
                    source_type: 'ios_health',
                    content,
                    metadata: { integration_id: integrationId, date },
                });
                indexed++;
            }
            console.log(`[IOSHealthClient] Indexed ${indexed} days of health data for RAG`);
        } catch (error) {
            console.error('[IOSHealthClient] indexForRAG error:', error);
        }
    }

    /**
     * Search is handled on the backend via the search_knowledge_base tool.
     */
    async searchInRAG(_query: string, _integrationId?: string): Promise<any[]> {
        return [];
    }

    /**
     * Background task handler
     * Note: This is a stub for Phase 2 implementation
     */
    async onWake(integrationId: string): Promise<void> {
        // TODO: Phase 2 - Implement background sync
        console.log('[IOSHealthClient] Background sync not yet implemented (Phase 2)');
    }
}

export const iosHealthClient = new IOSHealthClient();
export { IOSHealthClient };
