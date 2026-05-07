// Mock Platform and NativeModules before importing the classifier
jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
    NativeModules: { ProjectClassifier: null }, // no native module
}));

import { classifyMessageForProject } from '../../src/services/projects/ProjectClassifier';
import type { Project } from '../../src/screens/main/models';

function makeProject(id: string, name: string, description: string): Project {
    return { id, name, description, icon: '💼', chat_count: 0 };
}

describe('classifyMessageForProject — keyword fallback', () => {
    it('returns null when projects list is empty', async () => {
        expect(await classifyMessageForProject('hello', [])).toBeNull();
    });

    it('matches a project by name keyword', async () => {
        const projects = [makeProject('p1', 'Work Tasks', 'things for work')];
        const result = await classifyMessageForProject('remind me about my work tasks', projects);
        expect(result).toBe('p1');
    });

    it('matches by description keyword when name does not match', async () => {
        const projects = [makeProject('p2', 'Alpha', 'quarterly budget planning for finance')];
        const result = await classifyMessageForProject('what is the quarterly budget?', projects);
        expect(result).toBe('p2');
    });

    it('returns the highest-scoring project', async () => {
        const projects = [
            makeProject('p1', 'Code Review', 'reviewing pull requests'),
            makeProject('p2', 'Budget Planning', 'finance budget quarterly'),
        ];
        const result = await classifyMessageForProject(
            'I need to do some budget planning for next quarter', projects
        );
        expect(result).toBe('p2');
    });

    it('returns null when no project matches', async () => {
        const projects = [makeProject('p1', 'Unicorn Project', 'rainbow sparkles')];
        const result = await classifyMessageForProject('send me the invoice', projects);
        expect(result).toBeNull();
    });

    it('is case-insensitive', async () => {
        const projects = [makeProject('p1', 'WORK', 'work tasks')];
        const result = await classifyMessageForProject('WORK tasks due today', projects);
        expect(result).toBe('p1');
    });

    it('ignores keywords shorter than 3 characters', async () => {
        const projects = [makeProject('p1', 'AI', 'ai tasks')];
        // "AI" and "ai" are both < 3 chars
        const result = await classifyMessageForProject('do AI stuff', projects);
        // "tasks" (5 chars) should still match via description
        // Actually "stuff" won't match, but "tasks" matches description
        // result depends on whether "tasks" is in message — it's not here
        // "do" < 3 chars, "AI" < 3 chars, "stuff" ≠ "tasks"
        expect(result).toBeNull();
    });
});
