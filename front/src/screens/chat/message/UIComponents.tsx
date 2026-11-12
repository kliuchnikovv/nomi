import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import { useChat } from '../context';
import { Check } from 'iconoir-react-native';

interface PollProps {
    question: string;
    options: string[];
    allowMultiple?: boolean;
}

export function PollComponent({ question, options, allowMultiple }: PollProps) {
    const { theme, descriptor } = useTheme();
    const { sendMessage } = useChat();
    const [selected, setSelected] = useState<string[]>([]);
    const [voted, setVoted] = useState(false);

    const handleSelect = (option: string) => {
        if (voted) return;

        if (allowMultiple) {
            if (selected.includes(option)) {
                setSelected(selected.filter(s => s !== option));
            } else {
                setSelected([...selected, option]);
            }
        } else {
            // Immediate vote for single select
            sendMessage(`I vote for: ${option}`, [], false, undefined, 'user');
            setSelected([option]);
            setVoted(true);
        }
    };

    const submitVote = () => {
        if (selected.length === 0) return;
        sendMessage(
            `I vote for: ${selected.join(', ')}`,
            [],
            false,
            undefined,
            'user',
        );
        setVoted(true);
    };

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: theme.card || theme.surface,
                    borderColor: theme.border,
                },
            ]}
        >
            <Text
                theme={descriptor}
                style={[styles.question, { color: theme.text }]}
            >
                {question}
            </Text>
            {options.map((option, index) => {
                const isSelected = selected.includes(option);
                return (
                    <Pressable
                        key={index}
                        onPress={() => handleSelect(option)}
                        disabled={voted}
                        style={({ pressed }) => [
                            styles.optionButton,
                            {
                                backgroundColor: isSelected
                                    ? theme.primary + '20'
                                    : theme.background,
                                borderColor: isSelected
                                    ? theme.primary
                                    : theme.border,
                                opacity:
                                    voted && !isSelected
                                        ? 0.6
                                        : pressed
                                        ? 0.8
                                        : 1,
                            },
                        ]}
                    >
                        <Text
                            theme={descriptor}
                            style={[
                                styles.optionText,
                                {
                                    color: isSelected
                                        ? theme.primary
                                        : theme.text,
                                },
                            ]}
                        >
                            {option}
                        </Text>
                        {isSelected && (
                            <Check
                                width={16}
                                height={16}
                                color={theme.primary}
                            />
                        )}
                    </Pressable>
                );
            })}

            {allowMultiple && !voted && (
                <Pressable
                    onPress={submitVote}
                    disabled={selected.length === 0}
                    style={[
                        styles.submitButton,
                        {
                            backgroundColor: theme.primary,
                            opacity: selected.length === 0 ? 0.5 : 1,
                        },
                    ]}
                >
                    <Text theme={descriptor} style={styles.submitText}>
                        Submit Vote
                    </Text>
                </Pressable>
            )}
        </View>
    );
}

interface ButtonsProps {
    text: string;
    buttons: Array<{ label: string; value: string }>;
}

export function ButtonsComponent({ text, buttons }: ButtonsProps) {
    const { theme, descriptor } = useTheme();
    const { sendMessage } = useChat();
    const [clicked, setClicked] = useState(false);

    const handlePress = (value: string, label: string) => {
        if (clicked) return;
        sendMessage(value, [], false, undefined, 'user');
        setClicked(true);
    };

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: theme.card || theme.surface,
                    borderColor: theme.border,
                },
            ]}
        >
            <Text
                theme={descriptor}
                style={[styles.question, { color: theme.text }]}
            >
                {text}
            </Text>
            <View style={styles.buttonRow}>
                {buttons.map((btn, index) => (
                    <Pressable
                        key={index}
                        onPress={() => handlePress(btn.value, btn.label)}
                        disabled={clicked}
                        style={({ pressed }) => [
                            styles.actionButton,
                            {
                                backgroundColor: theme.primary,
                                opacity: clicked ? 0.5 : pressed ? 0.8 : 1,
                            },
                        ]}
                    >
                        <Text
                            theme={descriptor}
                            style={styles.actionButtonText}
                        >
                            {btn.label}
                        </Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 16,
        marginVertical: 8,
        width: '100%',
    },
    question: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 12,
    },
    optionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        marginBottom: 8,
    },
    optionText: {
        fontSize: 15,
    },
    submitButton: {
        padding: 12,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
    },
    submitText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 15,
    },
    buttonRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    actionButton: {
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 20,
    },
    actionButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
});
