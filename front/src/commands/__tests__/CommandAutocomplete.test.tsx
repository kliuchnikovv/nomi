import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { CommandAutocomplete } from '../CommandAutocomplete';
import { CommandRegistry } from '../CommandRegistry';
import type { CommandSpec } from '../types';

jest.mock('../CommandRegistry');
jest.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      surface: '#1a1a2e',
      border: '#333',
      accent: '#7c6af7',
      background: '#0f0f1a',
      text: '#ffffff',
      textSecondary: '#888',
    },
  }),
}));

const SPECS: CommandSpec[] = [
  {
    name: 'plan.build',
    title: 'Build Plan',
    description: 'Build a day plan',
    requires: [],
    missing: [],
    args_schema: {},
    surface: 'chat',
  },
  {
    name: 'search.web',
    title: 'Web Search',
    description: 'Search the web',
    requires: ['web'],
    missing: ['web'],
    args_schema: {},
    surface: 'chat',
  },
  {
    name: 'bg.task',
    title: 'Background',
    description: 'Background only',
    requires: [],
    missing: [],
    args_schema: {},
    surface: 'background',
  },
];

beforeEach(() => {
  (CommandRegistry.load as jest.Mock).mockResolvedValue(SPECS);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('CommandAutocomplete', () => {
  it('renders filtered commands matching query', async () => {
    const { getByText, queryByText } = render(
      <CommandAutocomplete query="plan" onPick={jest.fn()} />,
    );
    await waitFor(() => {
      expect(getByText('/plan.build')).toBeTruthy();
    });
    // search.web doesn't match "plan"
    expect(queryByText('/search.web')).toBeNull();
    // background surface commands are always hidden
    expect(queryByText('/bg.task')).toBeNull();
  });

  it('shows all non-background commands when query is empty', async () => {
    const { getByText, queryByText } = render(
      <CommandAutocomplete query="" onPick={jest.fn()} />,
    );
    await waitFor(() => {
      expect(getByText('/plan.build')).toBeTruthy();
      expect(getByText('/search.web')).toBeTruthy();
    });
    expect(queryByText('/bg.task')).toBeNull();
  });

  it('calls onPick with the spec when a non-missing item is tapped', async () => {
    const onPick = jest.fn();
    const { getByText } = render(
      <CommandAutocomplete query="" onPick={onPick} />,
    );
    await waitFor(() => getByText('/plan.build'));
    fireEvent.press(getByText('/plan.build'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(SPECS[0]);
  });

  it('does NOT call onPick when a missing item is tapped', async () => {
    const onPick = jest.fn();
    const { getByText } = render(
      <CommandAutocomplete query="" onPick={onPick} />,
    );
    await waitFor(() => getByText('/search.web'));
    fireEvent.press(getByText('/search.web'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shows missing badge for commands with missing integrations', async () => {
    const { getByText } = render(
      <CommandAutocomplete query="" onPick={jest.fn()} />,
    );
    await waitFor(() => getByText('/search.web'));
    expect(getByText('needs web')).toBeTruthy();
  });

  it('returns null when no commands match query', async () => {
    const { toJSON } = render(
      <CommandAutocomplete query="zzznomatch" onPick={jest.fn()} />,
    );
    await waitFor(() => {
      expect(toJSON()).toBeNull();
    });
  });
});
