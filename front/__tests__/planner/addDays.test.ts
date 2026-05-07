import { addDays } from '../../src/screens/planner/hooks/useMultiDayPlan';

describe('addDays', () => {
    it('adds 1 day', () => {
        expect(addDays('2024-01-01', 1)).toBe('2024-01-02');
    });

    it('adds 0 days returns same date', () => {
        expect(addDays('2024-06-15', 0)).toBe('2024-06-15');
    });

    it('crosses month boundary', () => {
        expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    });

    it('crosses year boundary', () => {
        expect(addDays('2023-12-31', 1)).toBe('2024-01-01');
    });

    it('handles leap year Feb 28 → Feb 29', () => {
        expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    });

    it('handles non-leap year Feb 28 → Mar 01', () => {
        expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    });

    it('adds 7 days (one week)', () => {
        expect(addDays('2024-06-10', 7)).toBe('2024-06-17');
    });

    it('zero-pads single-digit month and day', () => {
        expect(addDays('2024-01-01', 0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});
