import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { darkMinimalTheme } from '@nomi/front/themes/darkMinimal';

import { Text } from './Text';

const meta: Meta<typeof Text> = {
    title: 'Primitives/Text',
    component: Text,
    args: {
        theme: darkMinimalTheme,
        children: 'The quick brown fox jumps over the lazy dog',
    },
    argTypes: {
        variant: {
            control: 'select',
            options: ['display', 'title', 'body', 'caption', 'mono'],
        },
        tone: {
            control: 'select',
            options: ['primary', 'secondary', 'faded', 'accent', 'error', 'success', 'warning'],
        },
        align: {
            control: 'select',
            options: [undefined, 'left', 'center', 'right'],
        },
    },
};
export default meta;

type Story = StoryObj<typeof Text>;

export const Body: Story = { args: { variant: 'body', tone: 'primary' } };

export const AllVariants: Story = {
    render: (args) => (
        <View style={{ gap: 12 }}>
            <Text {...args} variant="display">Display</Text>
            <Text {...args} variant="title">Title</Text>
            <Text {...args} variant="body">Body</Text>
            <Text {...args} variant="caption">Caption</Text>
            <Text {...args} variant="mono">mono 0O1lI</Text>
        </View>
    ),
};

export const AllTones: Story = {
    render: (args) => (
        <View style={{ gap: 6 }}>
            <Text {...args} tone="primary">primary — main copy</Text>
            <Text {...args} tone="secondary">secondary — supporting</Text>
            <Text {...args} tone="faded">faded — least emphasis</Text>
            <Text {...args} tone="accent">accent — highlight</Text>
            <Text {...args} tone="error">error — destructive</Text>
            <Text {...args} tone="success">success — positive</Text>
            <Text {...args} tone="warning">warning — caution</Text>
        </View>
    ),
};
