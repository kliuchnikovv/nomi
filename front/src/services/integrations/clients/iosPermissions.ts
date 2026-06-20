/**
 * Shared permission helpers for iOS native clients (Reminders, Contacts, ...).
 *
 * Each native bridge exposes the same trio: checkPermissionStatus,
 * requestPermission, openSettings. The behavior is identical except for the
 * log label and which manager is called — this helper takes both as args.
 */

export type IOSPermissionStatus = 'authorized' | 'denied' | 'notDetermined';

export interface IOSPermissionsManager {
    checkPermissionStatus: () => Promise<string>;
    requestPermission: () => Promise<boolean>;
    openSettings: () => Promise<void>;
}

function ensure(
    manager: IOSPermissionsManager | null | undefined,
    label: string,
): IOSPermissionsManager {
    if (!manager) {
        throw new Error(`${label} is not available.`);
    }
    return manager;
}

export async function checkIOSPermissionStatus(
    manager: IOSPermissionsManager | null | undefined,
    label: string,
): Promise<IOSPermissionStatus> {
    const mgr = ensure(manager, label);
    try {
        const status = await mgr.checkPermissionStatus();
        return status as IOSPermissionStatus;
    } catch (error) {
        console.error(`[${label}] checkPermissionStatus error:`, error);
        throw error;
    }
}

export async function requestIOSPermission(
    manager: IOSPermissionsManager | null | undefined,
    label: string,
): Promise<boolean> {
    const mgr = ensure(manager, label);
    try {
        return await mgr.requestPermission();
    } catch (error) {
        console.error(`[${label}] requestPermission error:`, error);
        throw error;
    }
}

export async function openIOSPermissionSettings(
    manager: IOSPermissionsManager | null | undefined,
    label: string,
): Promise<void> {
    const mgr = ensure(manager, label);
    try {
        await mgr.openSettings();
    } catch (error) {
        console.error(`[${label}] openSettings error:`, error);
        throw error;
    }
}
