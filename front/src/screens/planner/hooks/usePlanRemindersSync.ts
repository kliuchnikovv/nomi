import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { iosRemindersClient } from '../../../services/integrations/clients/IOSRemindersClient';
import { PlanItem } from '../types';

const storageKey = (date: string) => `planner_reminders_map_${date}`;
const LIST_NAME = 'Genie Plan';

function chipToDate(date: string, chipValue: string): string | undefined {
    const match = chipValue.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return undefined;
    const h = match[1].padStart(2, '0');
    const m = match[2];
    return `${date}T${h}:${m}:00`;
}

export interface PlanRemindersSyncResult {
    isSyncing: boolean;
    lastSynced: Date | null;
    sync: () => Promise<void>;
}

export function usePlanRemindersSync(date: string, items: PlanItem[]): PlanRemindersSyncResult {
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState<Date | null>(null);
    // planItemId → reminderId
    const mapRef = useRef<Record<string, string>>({});
    const mapLoadedRef = useRef(false);

    // Load saved mapping when date changes
    useEffect(() => {
        mapLoadedRef.current = false;
        mapRef.current = {};
        AsyncStorage.getItem(storageKey(date))
            .then(raw => {
                mapRef.current = raw ? JSON.parse(raw) : {};
                mapLoadedRef.current = true;
            })
            .catch(() => { mapLoadedRef.current = true; });
    }, [date]);

    const sync = useCallback(async () => {
        if (Platform.OS !== 'ios') return;
        if (!mapLoadedRef.current) return;

        setIsSyncing(true);
        try {
            const named = items.filter(i => i.text.trim() !== '');
            const newMap: Record<string, string> = {};

            for (const item of named) {
                const timeChip = item.chips.find(c => c.type === 'time');
                const noteChip = item.chips.find(c => c.type === 'note');
                const dueDate = timeChip ? chipToDate(date, timeChip.value) : undefined;
                const notes = noteChip?.value;

                if (mapRef.current[item.id]) {
                    await iosRemindersClient.updateReminder(mapRef.current[item.id], {
                        title: item.text,
                        isCompleted: item.checked,
                        dueDate,
                        notes,
                    }).catch(() => {
                        // Reminder may have been deleted externally; will recreate below
                        delete mapRef.current[item.id];
                    });

                    if (mapRef.current[item.id]) {
                        newMap[item.id] = mapRef.current[item.id];
                        continue;
                    }
                }

                // Create (either new or after failed update)
                try {
                    const r = await iosRemindersClient.createReminder(item.text, {
                        list: LIST_NAME,
                        dueDate,
                        notes,
                    });
                    newMap[item.id] = r.id;
                } catch (e) {
                    console.warn('[usePlanRemindersSync] createReminder failed:', e);
                }
            }

            // Delete reminders for items removed from the plan
            for (const [planId, remId] of Object.entries(mapRef.current)) {
                if (!newMap[planId]) {
                    await iosRemindersClient.deleteReminder(remId).catch(() => {});
                }
            }

            mapRef.current = newMap;
            await AsyncStorage.setItem(storageKey(date), JSON.stringify(newMap));
            setLastSynced(new Date());
        } catch (e) {
            console.error('[usePlanRemindersSync] sync error:', e);
        } finally {
            setIsSyncing(false);
        }
    }, [date, items]);

    // Auto-sync debounced 2 s after items change
    useEffect(() => {
        if (Platform.OS !== 'ios') return;
        const t = setTimeout(() => { sync(); }, 2000);
        return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items]);

    return { isSyncing, lastSynced, sync };
}
