import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { darkMinimalTheme } from '@nomi/front/themes/darkMinimal';

import { ListItem } from './ListItem';
import { Divider } from '../Divider';
import { Text } from '../Text';

const meta: Meta<typeof ListItem> = {
    title: 'Primitives/ListItem',
    component: ListItem,
    args: {
        theme: darkMinimalTheme,
        title: 'Item title',
        subtitle: 'Supporting subtitle',
        density: 'comfortable',
    },
    argTypes: {
        density: { control: 'select', options: ['compact', 'comfortable'] },
        selected: { control: 'boolean' },
    },
};
export default meta;

type Story = StoryObj<typeof ListItem>;

export const Static: Story = {};

export const Interactive: Story = {
    args: { onPress: () => {} },
};

export const List: Story = {
    render: (args) => (
        <View style={{ width: 360, borderWidth: 1, borderColor: args.theme.colors.border, borderRadius: args.theme.radius.md }}>
            <ListItem {...args} title="First" subtitle="With subtitle" onPress={() => {}} />
            <Divider theme={args.theme} inset="lg" />
            <ListItem {...args} title="Second" subtitle="Selected" selected onPress={() => {}} />
            <Divider theme={args.theme} inset="lg" />
            <ListItem
                {...args}
                title="With right slot"
                subtitle={undefined}
                rightContent={<Text theme={args.theme} tone="secondary">›</Text>}
                onPress={() => {}}
            />
        </View>
    ),
};
