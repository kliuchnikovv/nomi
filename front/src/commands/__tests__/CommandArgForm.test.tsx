import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { CommandArgForm } from '../CommandArgForm';
import type { CommandSpec } from '../types';
import { ThemeProvider } from '../../context/ThemeContext';

const wrap = (node: React.ReactElement) => (
    <ThemeProvider>{node}</ThemeProvider>
);

const spec: CommandSpec = {
    name: 'memory.note',
    title: 'Save note',
    description: '',
    requires: [],
    missing: [],
    surface: 'chat',
    args_schema: {
        type: 'object',
        required: ['text'],
        properties: {
            text: { type: 'string', minLength: 1, description: 'Note body' },
            tags: { type: 'array', items: { type: 'string' }, default: [] },
        },
    },
};

describe('CommandArgForm', () => {
    it('submits valid args', async () => {
        const onSubmit = jest.fn().mockResolvedValue(undefined);
        const { getByLabelText, getByText } = render(
            wrap(
                <CommandArgForm
                    spec={spec}
                    onSubmit={onSubmit}
                    onCancel={() => {}}
                />,
            ),
        );
        fireEvent.changeText(getByLabelText('text'), 'hello');
        fireEvent.press(getByText('Send'));
        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith({ text: 'hello', tags: [] }),
        );
    });

    it('blocks submit on required-field violation', async () => {
        const onSubmit = jest.fn();
        const { getByText, queryByText } = render(
            wrap(
                <CommandArgForm
                    spec={spec}
                    onSubmit={onSubmit}
                    onCancel={() => {}}
                />,
            ),
        );
        fireEvent.press(getByText('Send'));
        await waitFor(() => expect(queryByText(/required/i)).toBeTruthy());
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('cancel calls onCancel', () => {
        const onCancel = jest.fn();
        const { getByText } = render(
            wrap(
                <CommandArgForm
                    spec={spec}
                    onSubmit={() => {}}
                    onCancel={onCancel}
                />,
            ),
        );
        fireEvent.press(getByText('Cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});
