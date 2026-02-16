/**
 * iOS Health Client
 * Uses React Native module to access HealthKit health and fitness data
 */

import { NativeModules, Platform } from 'react-native';

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
        try {
            const steps: StepData[] = await IOSHealthManager.getSteps(startDate, endDate, interval);
            return steps;
        } catch (error) {
            console.error('[IOSHealthClient] getSteps error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getActivitySummary error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getHeartRate error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getRestingHeartRate error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getSleepAnalysis error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getBodyMetrics error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getLatestBodyMetric error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getNutritionSummary error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getWorkouts error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getDailySummary error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] getWeeklySummary error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] addWorkout error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] addBodyMetric error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] addNutritionEntry error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] addSleepSession error:', error);
            throw error;
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
        } catch (error) {
            console.error('[IOSHealthClient] deleteHealthRecord error:', error);
            throw error;
        }
    }

    // MARK: - RAG Integration (Phase 2 - stub for now)

    /**
     * Index health data for RAG semantic search
     * Note: This is a stub for Phase 2 implementation
     */
    async indexForRAG(integrationId: string): Promise<void> {
        if (Platform.OS !== 'ios') {
            console.warn('[IOSHealthClient] RAG indexing is iOS only');
            return;
        }

        // TODO: Phase 2 - Implement RAG indexing
        // - Get daily summaries for past 30 days
        // - Build natural language descriptions
        // - Store in VectorStore with embeddings
        console.log('[IOSHealthClient] RAG indexing not yet implemented (Phase 2)');
    }

    /**
     * Search indexed health data
     * Note: This is a stub for Phase 2 implementation
     */
    async searchInRAG(query: string, integrationId?: string): Promise<any[]> {
        if (Platform.OS !== 'ios') {
            return [];
        }

        // TODO: Phase 2 - Implement RAG search
        console.log('[IOSHealthClient] RAG search not yet implemented (Phase 2)');
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
