/**
 * GitHub background task: GitHub is server-only, no background sync needed.
 */

export async function backgroundTask(integrationId: string): Promise<void> {
    // GitHub is server-only, no background sync needed
    console.log(`GitHub integration ${integrationId} - server-only, no background task`);
}
