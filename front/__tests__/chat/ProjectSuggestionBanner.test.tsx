import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ProjectSuggestionBanner } from '../../src/screens/chat/chatDetail/ProjectSuggestionBanner';
import { COLORS } from './chatMocks';

const PROJECT = { id: 'p1', name: 'Alpha', icon: '🚀', description: 'A project' };

const baseProps = {
    project: PROJECT,
    onAccept: jest.fn(),
    onDismiss: jest.fn(),
    accentColor: COLORS.accent,
    surfaceColor: COLORS.surface,
    textPrimaryColor: COLORS.textPrimary,
    textSecondaryColor: COLORS.textSecondary,
    borderColor: COLORS.border,
};

describe('ProjectSuggestionBanner', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders project name', () => {
        const { getByText } = render(<ProjectSuggestionBanner {...baseProps} />);
        expect(getByText('Alpha')).toBeTruthy();
    });

    it('renders project icon', () => {
        const { getByText } = render(<ProjectSuggestionBanner {...baseProps} />);
        expect(getByText('🚀')).toBeTruthy();
    });

    it('renders "Add to project?" label', () => {
        const { getByText } = render(<ProjectSuggestionBanner {...baseProps} />);
        expect(getByText('Add to project?')).toBeTruthy();
    });

    it('renders "Add" accept button', () => {
        const { getByText } = render(<ProjectSuggestionBanner {...baseProps} />);
        expect(getByText('Add')).toBeTruthy();
    });

    it('renders close icon button (not "No") when showNoButton=false', () => {
        const { queryByText } = render(<ProjectSuggestionBanner {...baseProps} showNoButton={false} />);
        expect(queryByText('No')).toBeNull();
    });

    it('renders "No" text button when showNoButton=true', () => {
        const { getByText } = render(<ProjectSuggestionBanner {...baseProps} showNoButton={true} />);
        expect(getByText('No')).toBeTruthy();
    });

    it('pressing "Add" calls onAccept', () => {
        const onAccept = jest.fn();
        const { getByText } = render(<ProjectSuggestionBanner {...baseProps} onAccept={onAccept} />);
        fireEvent.press(getByText('Add'));
        expect(onAccept).toHaveBeenCalledTimes(1);
    });

    it('pressing "No" calls onDismiss when showNoButton=true', () => {
        const onDismiss = jest.fn();
        const { getByText } = render(
            <ProjectSuggestionBanner {...baseProps} onDismiss={onDismiss} showNoButton={true} />,
        );
        fireEvent.press(getByText('No'));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('pressing close icon calls onDismiss when showNoButton=false', () => {
        const onDismiss = jest.fn();
        // The close button wraps an Ionicons — we target the closest Touchable by position
        const { UNSAFE_getAllByType } = render(
            <ProjectSuggestionBanner {...baseProps} onDismiss={onDismiss} showNoButton={false} />,
        );
        const { TouchableOpacity } = require('react-native');
        const touchables = UNSAFE_getAllByType(TouchableOpacity);
        // First touchable is the dismiss (close icon), second is "Add"
        fireEvent.press(touchables[0]);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
