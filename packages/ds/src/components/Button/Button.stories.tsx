import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { darkMinimalTheme } from '@genie/front/themes/darkMinimal';

import { Button } from './Button';

const meta: Meta<typeof Button> = {
    title: 'Primitives/Button',
    component: Button,
    args: {
        theme: darkMinimalTheme,
        label: 'Continue',
    },
    argTypes: {
        variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
        size: { control: 'select', options: ['sm', 'md', 'lg'] },
        loading: { control: 'boolean' },
        disabled: { control: 'boolean' },
        fullWidth: { control: 'boolean' },
    },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: 'primary', size: 'md' } };

export const AllVariants: Story = {
    render: (args) => (
        <View style={{ gap: 12, alignItems: 'flex-start' }}>
            <Button {...args} variant="primary" label="Primary" />
            <Button {...args} variant="secondary" label="Secondary" />
            <Button {...args} variant="ghost" label="Ghost" />
            <Button {...args} variant="danger" label="Danger" />
        </View>
    ),
};

export const Sizes: Story = {
    render: (args) => (
        <View style={{ gap: 12, alignItems: 'flex-start' }}>
            <Button {...args} size="sm" label="Small" />
            <Button {...args} size="md" label="Medium" />
            <Button {...args} size="lg" label="Large" />
        </View>
    ),
};

export const LoadingAndDisabled: Story = {
    render: (args) => (
        <View style={{ gap: 12, alignItems: 'flex-start' }}>
            <Button {...args} loading label="Loading" />
            <Button {...args} disabled label="Disabled" />
        </View>
    ),
};
