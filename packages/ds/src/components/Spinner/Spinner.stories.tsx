import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { darkMinimalTheme } from '@genie/front/themes/darkMinimal';

import { Spinner } from './Spinner';

const meta: Meta<typeof Spinner> = {
    title: 'Primitives/Spinner',
    component: Spinner,
    args: { theme: darkMinimalTheme, size: 'md', tone: 'accent' },
    argTypes: {
        size: { control: 'select', options: ['sm', 'md', 'lg'] },
        tone: { control: 'select', options: ['primary', 'accent', 'onAccent'] },
    },
};
export default meta;

type Story = StoryObj<typeof Spinner>;

export const Default: Story = {};

export const AllSizes: Story = {
    render: (args) => (
        <View style={{ flexDirection: 'row', gap: 24, alignItems: 'center' }}>
            <Spinner {...args} size="sm" />
            <Spinner {...args} size="md" />
            <Spinner {...args} size="lg" />
        </View>
    ),
};
