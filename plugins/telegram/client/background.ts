/**
 * Telegram background task: Telegram is server-only, no background sync needed.
 */

export async function backgroundTask(integrationId: string): Promise<void> {
    // Telegram is server-only, no background sync needed
    console.log(`Telegram integration ${integrationId} - server-only, no background task`);
}
