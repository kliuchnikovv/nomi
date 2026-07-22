import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { darkMinimalTheme } from '@genie/front/themes/darkMinimal';

import { Divider } from './Divider';
import { Text } from '../Text';

const meta: Meta<typeof Divider> = {
    title: 'Primitives/Divider',
    component: Divider,
    args: {
        theme: darkMinimalTheme,
        orientation: 'horizontal',
    },
    argTypes: {
        orientation: { control: 'select', options: ['horizontal', 'vertical'] },
        inset: { control: 'select', options: ['none', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'] },
        thickness: { control: { type: 'number', min: 0.5, max: 4, step: 0.5 } },
    },
};
export default meta;

type Story = StoryObj<typeof Divider>;

export const Horizontal: Story = {
    render: (args) => (
        <View style={{ gap: 12, width: 320 }}>
            <Text theme={args.theme}>Above</Text>
            <Divider {...args} />
            <Text theme={args.theme}>Below</Text>
        </View>
    ),
};

export const Vertical: Story = {
    args: { orientation: 'vertical' },
    render: (args) => (
        <View style={{ flexDirection: 'row', height: 80, alignItems: 'center', gap: 12 }}>
            <Text theme={args.theme}>Left</Text>
            <Divider {...args} />
            <Text theme={args.theme}>Right</Text>
        </View>
    ),
};
