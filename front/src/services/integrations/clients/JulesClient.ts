
// Placeholder for Jules Client
class JulesClient {
    async getTasks(integrationId: string): Promise<any[]> {
        // TODO: Implement actual API call
        console.log(`JulesClient: fetching tasks for ${integrationId}`);
        return [];
    }
}

export const julesClient = new JulesClient();
