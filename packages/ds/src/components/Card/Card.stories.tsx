import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { darkMinimalTheme } from '@genie/front/themes/darkMinimal';

import { Card } from './Card';
import { Text } from '../Text';

const meta: Meta<typeof Card> = {
    title: 'Primitives/Card',
    component: Card,
    args: {
        theme: darkMinimalTheme,
        padding: 'lg',
        radius: 'lg',
        surface: 'surface',
    },
    argTypes: {
        padding: { control: 'select', options: ['none', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'] },
        radius: { control: 'select', options: ['sm', 'md', 'lg', 'xl', 'pill'] },
        surface: { control: 'select', options: ['surface', 'surfaceAlt', 'surfaceHighlight', 'transparent'] },
        elevation: { control: 'select', options: ['none', 'raised', 'inset'] },
        bordered: { control: 'boolean' },
    },
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Plain: Story = {
    render: (args) => (
        <Card {...args}>
            <Text theme={args.theme} variant="title">Card title</Text>
            <Text theme={args.theme} variant="body" tone="secondary">Supporting copy inside a Card.</Text>
        </Card>
    ),
};

export const Bordered: Story = {
    args: { bordered: true },
    render: (args) => (
        <Card {...args}>
            <Text theme={args.theme} variant="body">Bordered card</Text>
        </Card>
    ),
};

export const Raised: Story = {
    args: { elevation: 'raised' },
    render: (args) => (
        <Card {...args}>
            <Text theme={args.theme} variant="body">Card with raised shadow (only visible on themes with effects)</Text>
        </Card>
    ),
};

export const Surfaces: Story = {
    render: (args) => (
        <View style={{ gap: 12 }}>
            <Card {...args} surface="surface"><Text theme={args.theme}>surface</Text></Card>
            <Card {...args} surface="surfaceAlt"><Text theme={args.theme}>surfaceAlt</Text></Card>
            <Card {...args} surface="surfaceHighlight"><Text theme={args.theme}>surfaceHighlight</Text></Card>
        </View>
    ),
};
