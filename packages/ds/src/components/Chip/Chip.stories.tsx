import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { darkMinimalTheme } from '@genie/front/themes/darkMinimal';

import { Chip } from './Chip';

const meta: Meta<typeof Chip> = {
    title: 'Primitives/Chip',
    component: Chip,
    args: {
        theme: darkMinimalTheme,
        label: 'Label',
        tone: 'default',
        variant: 'soft',
        size: 'sm',
    },
    argTypes: {
        tone: { control: 'select', options: ['default', 'accent', 'success', 'error', 'warning'] },
        variant: { control: 'select', options: ['solid', 'soft', 'outlined'] },
        size: { control: 'select', options: ['sm', 'md'] },
        selected: { control: 'boolean' },
    },
};
export default meta;

type Story = StoryObj<typeof Chip>;

export const Default: Story = {};

export const AllTones: Story = {
    render: (args) => (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip {...args} tone="default" label="default" />
            <Chip {...args} tone="accent" label="accent" />
            <Chip {...args} tone="success" label="success" />
            <Chip {...args} tone="error" label="error" />
            <Chip {...args} tone="warning" label="warning" />
        </View>
    ),
};

export const AllVariants: Story = {
    render: (args) => (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip {...args} variant="solid" label="solid" tone="accent" />
            <Chip {...args} variant="soft" label="soft" tone="accent" />
            <Chip {...args} variant="outlined" label="outlined" tone="accent" />
        </View>
    ),
};

export const Interactive: Story = {
    args: { onPress: () => {} },
    render: (args) => (
        <View style={{ flexDirection: 'row', gap: 8 }}>
            <Chip {...args} label="Not selected" />
            <Chip {...args} label="Selected" selected />
            <Chip {...args} label="Disabled" disabled />
        </View>
    ),
};
