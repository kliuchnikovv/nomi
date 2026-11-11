import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';

import { View } from 'react-native';
import { darkMinimalTheme } from '@nomi/front/themes/darkMinimal';

import { Input } from './Input';

const meta: Meta<typeof Input> = {
    title: 'Primitives/Input',
    component: Input,
    args: {
        theme: darkMinimalTheme,
        placeholder: 'Type here…',
        size: 'md',
    },
    argTypes: {
        size: { control: 'select', options: ['sm', 'md', 'lg'] },
        editable: { control: 'boolean' },
    },
};
export default meta;

type Story = StoryObj<typeof Input>;

const Controlled: React.FC<React.ComponentProps<typeof Input>> = (args) => {
    const [value, setValue] = useState('');
    return <Input {...args} value={value} onChangeText={setValue} />;
};

export const Default: Story = { render: (args) => <Controlled {...args} /> };

export const WithLabel: Story = {
    args: { label: 'Email', hint: "We'll never share this." },
    render: (args) => <Controlled {...args} />,
};

export const WithError: Story = {
    args: { label: 'Email', error: 'Invalid email address' },
    render: (args) => <Controlled {...args} />,
};

export const Sizes: Story = {
    render: (args) => (
        <View style={{ gap: 12 }}>
            <Controlled {...args} size="sm" placeholder="small" />
            <Controlled {...args} size="md" placeholder="medium" />
            <Controlled {...args} size="lg" placeholder="large" />
        </View>
    ),
};

export const Disabled: Story = {
    args: { editable: false, value: 'Read-only content' },
};
