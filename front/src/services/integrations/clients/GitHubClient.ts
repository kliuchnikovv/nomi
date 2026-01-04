
// Placeholder for GitHub Client
class GitHubClient {
    async getAssignedIssues(integrationId: string): Promise<any[]> {
        // TODO: Implement actual API call
        console.log(`GitHubClient: fetching issues for ${integrationId}`);
        return [];
    }
}

export const githubClient = new GitHubClient();
