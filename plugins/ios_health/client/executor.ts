/**
 * iOS Health client plugin: executes Apple Health (HealthKit) tool actions.
 */

import type { ClientPluginHandler } from '@genie/front/plugins/clientRegistry';
import { IOSHealthClient } from '@genie/front/services/integrations/clients/IOSHealthClient';

export const iosHealthPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const client = new IOSHealthClient();

        switch (method) {
            // Permission Management
            case 'check_permission_status': {
                const status = await client.checkPermissionStatus();
                return `HealthKit availability: ${status.available ? 'Available' : 'Not available'}. Authorized categories: ${status.authorized.join(', ') || 'none'}`;
            }

            case 'request_permission': {
                const result = await client.requestPermission(params.categories);
                return result.granted
                    ? `HealthKit permissions granted for: ${result.categories.join(', ')}`
                    : 'HealthKit permissions were not granted';
            }

            // Activity Queries
            case 'get_steps': {
                const steps = await client.getSteps(params.start_date, params.end_date, params.interval || 'day');

                const total = steps.reduce((sum, s) => sum + s.value, 0);
                return `<details><summary>Steps (Total: ${total.toFixed(0)})</summary>\n\n\`\`\`json\n${JSON.stringify(steps, null, 2)}\n\`\`\`\n</details>`;
            }

            case 'get_activity_summary': {
                const summary = await client.getActivitySummary(params.start_date, params.end_date);
                return `Activity Summary: ${summary.steps} steps, ${(summary.distance / 1000).toFixed(2)} km, ${summary.activeEnergy.toFixed(0)} kcal, ${summary.exerciseMinutes} exercise minutes, ${summary.standHours} stand hours, ${summary.flightsClimbed} flights climbed`;
            }

            // Heart Queries
            case 'get_heart_rate': {
                const heartRates = await client.getHeartRate(params.start_date, params.end_date, params.limit || 100);
                if (heartRates.length === 0) {
                    return 'No heart rate data found for the specified period';
                }
                const avg = heartRates.reduce((sum, hr) => sum + hr.value, 0) / heartRates.length;
                const min = Math.min(...heartRates.map(hr => hr.value));
                const max = Math.max(...heartRates.map(hr => hr.value));
                return `<details><summary>Heart Rate (${heartRates.length} measurements)</summary>\n\nAverage: ${avg.toFixed(0)} bpm, Min: ${min.toFixed(0)} bpm, Max: ${max.toFixed(0)} bpm\n\n\`\`\`json\n${JSON.stringify(heartRates.slice(0, 10), null, 2)}\n\`\`\`\n</details>`;
            }

            case 'get_resting_heart_rate': {
                const restingHR = await client.getRestingHeartRate(params.start_date, params.end_date);
                if (restingHR.length === 0) {
                    return 'No resting heart rate data found';
                }
                const avg = restingHR.reduce((sum, hr) => sum + hr.value, 0) / restingHR.length;
                return `Resting Heart Rate: Average ${avg.toFixed(0)} bpm over ${restingHR.length} measurements`;
            }

            // Sleep Analysis
            case 'get_sleep_analysis': {
                const sleepData = await client.getSleepAnalysis(params.start_date, params.end_date);
                if (sleepData.length === 0) {
                    return 'No sleep data found for the specified period';
                }
                const avgDuration = sleepData.reduce((sum, s) => sum + s.duration, 0) / sleepData.length;
                return `<details><summary>Sleep Analysis (${sleepData.length} nights)</summary>\n\nAverage duration: ${avgDuration.toFixed(1)} hours\n\n\`\`\`json\n${JSON.stringify(sleepData, null, 2)}\n\`\`\`\n</details>`;
            }

            // Body Metrics
            case 'get_body_metrics': {
                const metrics = await client.getBodyMetrics(params.metric_type, params.start_date, params.end_date);
                if (metrics.length === 0) {
                    return `No ${params.metric_type} data found`;
                }
                return `<details><summary>${params.metric_type} (${metrics.length} measurements)</summary>\n\n\`\`\`json\n${JSON.stringify(metrics, null, 2)}\n\`\`\`\n</details>`;
            }

            case 'get_latest_body_metric': {
                const metric = await client.getLatestBodyMetric(params.metric_type);
                return `Latest ${params.metric_type}: ${metric.value} ${metric.unit} (${new Date(metric.date).toLocaleDateString()})`;
            }

            // Nutrition
            case 'get_nutrition_summary': {
                const nutrition = await client.getNutritionSummary(params.start_date, params.end_date);
                return `Nutrition Summary: ${nutrition.calories.toFixed(0)} kcal, ${nutrition.protein.toFixed(0)}g protein, ${nutrition.carbs.toFixed(0)}g carbs, ${nutrition.fat.toFixed(0)}g fat, ${nutrition.water.toFixed(0)}ml water`;
            }

            // Workouts
            case 'get_workouts': {
                const workouts = await client.getWorkouts(
                    params.start_date,
                    params.end_date,
                    params.workout_type,
                    params.limit || 20
                );
                if (workouts.length === 0) {
                    return 'No workouts found for the specified period';
                }
                return `<details><summary>Workouts (${workouts.length} sessions)</summary>\n\n\`\`\`json\n${JSON.stringify(workouts, null, 2)}\n\`\`\`\n</details>`;
            }

            // Aggregated Summaries
            case 'get_daily_summary': {
                const summary = await client.getDailySummary(params.date);

                // Build a human-readable summary
                let result = `**Health Summary for ${params.date}**\n\n`;

                if (summary.activity) {
                    result += `**Activity:**\n`;
                    result += `- Steps: ${summary.activity.steps}\n`;
                    result += `- Distance: ${(summary.activity.distance / 1000).toFixed(2)} km\n`;
                    result += `- Active Energy: ${summary.activity.activeEnergy.toFixed(0)} kcal\n`;
                    result += `- Exercise: ${summary.activity.exerciseMinutes} minutes\n`;
                    result += `- Stand Hours: ${summary.activity.standHours}\n\n`;
                }

                if (summary.heart) {
                    result += `**Heart:**\n`;
                    result += `- Average: ${summary.heart.avg.toFixed(0)} bpm\n`;
                    if (summary.heart.resting) {
                        result += `- Resting: ${summary.heart.resting.toFixed(0)} bpm\n`;
                    }
                    result += `- Range: ${summary.heart.min.toFixed(0)}-${summary.heart.max.toFixed(0)} bpm\n\n`;
                }

                if (summary.sleep) {
                    result += `**Sleep:**\n`;
                    result += `- Duration: ${summary.sleep.duration.toFixed(1)} hours\n`;
                    result += `- Quality: ${summary.sleep.quality}\n\n`;
                }

                if (summary.workouts && summary.workouts.length > 0) {
                    result += `**Workouts:**\n`;
                    summary.workouts.forEach(w => {
                        result += `- ${w.type}: ${w.duration.toFixed(0)} min, ${w.calories.toFixed(0)} kcal\n`;
                    });
                }

                return result;
            }

            case 'get_weekly_summary': {
                const summary = await client.getWeeklySummary(params.start_date);
                return `<details><summary>Weekly Health Summary (${summary.summaries.length} days)</summary>\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n</details>`;
            }

            // Write Operations
            case 'add_workout': {
                const result = await client.addWorkout(
                    params.type,
                    params.start,
                    params.duration,
                    params.calories,
                    params.distance || 0,
                    params.metadata || {}
                );
                const distanceText = params.distance > 0 ? `, ${(params.distance / 1000).toFixed(2)} km` : '';
                return `Workout logged: ${params.type} for ${params.duration} minutes, ${params.calories.toFixed(0)} kcal${distanceText} (ID: ${result.id})`;
            }

            case 'add_body_metric': {
                const result = await client.addBodyMetric(params.metric_type, params.value, params.date);
                return `Body metric logged: ${params.metric_type} = ${params.value} on ${new Date(params.date).toLocaleDateString()} (ID: ${result.id})`;
            }

            case 'add_nutrition_entry': {
                const result = await client.addNutritionEntry(
                    params.calories,
                    params.protein,
                    params.carbs,
                    params.fat,
                    params.water,
                    params.date
                );
                return `Nutrition logged for ${new Date(params.date).toLocaleDateString()}: ${params.calories.toFixed(0)} kcal, ${params.protein}g protein, ${params.carbs}g carbs, ${params.fat}g fat, ${params.water}ml water`;
            }

            case 'add_sleep_session': {
                const result = await client.addSleepSession(
                    params.in_bed_start,
                    params.in_bed_end,
                    params.asleep_start,
                    params.asleep_end
                );
                const inBedStart = new Date(params.in_bed_start);
                const inBedEnd = new Date(params.in_bed_end);
                const duration = (inBedEnd.getTime() - inBedStart.getTime()) / (1000 * 60 * 60);
                return `Sleep session logged: ${duration.toFixed(1)} hours from ${inBedStart.toLocaleString()} to ${inBedEnd.toLocaleString()}`;
            }

            case 'delete_health_record': {
                const result = await client.deleteHealthRecord(params.record_type, params.record_id);
                return `Health record deleted: ${params.record_type} with ID ${params.record_id}`;
            }

            default:
                throw new Error(`Unknown iOS Health method: ${method}`);
        }
    },
};
