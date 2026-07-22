import React, { useState } from 'react';
import {
    Modal,
    View,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    Dimensions,
} from 'react-native';
import { Text } from '@genie/ds';
import { ThemeColors } from '../../../themes/types';
import { useTheme } from '../../../context/ThemeContext';

interface AskUserDialogProps {
    visible: boolean;
    question: string;
    options: string[];
    onSubmit: (response: string) => void;
    onCancel: () => void;
    theme: ThemeColors;
}

const { height: screenHeight } = Dimensions.get('window');

export const AskUserDialog: React.FC<AskUserDialogProps> = ({
    visible,
    question,
    options,
    onSubmit,
    onCancel,
    theme,
}) => {
    const [selectedOption, setSelectedOption] = useState<string | null>(null);
    const [customInput, setCustomInput] = useState('');
    const [isCustom, setIsCustom] = useState(false);
    const { descriptor } = useTheme();

    const handleSubmit = () => {
        if (isCustom && customInput.trim()) {
            onSubmit(customInput.trim());
        } else if (selectedOption) {
            onSubmit(selectedOption);
        }
    };

    const handleOptionPress = (option: string) => {
        setSelectedOption(option);
        setIsCustom(false);
    };

    const handleCustomFocus = () => {
        setIsCustom(true);
        setSelectedOption(null);
    };

    const handleCancel = () => {
        setCustomInput('');
        setSelectedOption(null);
        setIsCustom(false);
        onCancel();
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={handleCancel}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.keyboardAvoiding}
            >
                <View style={styles.overlay}>
                    <View
                        style={[
                            styles.container,
                            {
                                backgroundColor: theme.surface,
                                maxHeight: screenHeight * 0.7,
                            },
                        ]}
                    >
                        <Text
                            theme={descriptor}
                            tone="primary"
                            style={styles.question}
                        >
                            {question}
                        </Text>

                        <ScrollView
                            style={styles.scrollView}
                            showsVerticalScrollIndicator={true}
                        >
                            {options.map((option, index) => (
                                <TouchableOpacity
                                    key={index}
                                    style={[
                                        styles.optionButton,
                                        {
                                            backgroundColor:
                                                selectedOption === option
                                                    ? theme.accent
                                                    : 'transparent',
                                            borderColor:
                                                selectedOption === option
                                                    ? theme.accent
                                                    : theme.border,
                                        },
                                    ]}
                                    onPress={() => handleOptionPress(option)}
                                    activeOpacity={0.7}
                                >
                                    <Text
                                        theme={descriptor}
                                        style={[
                                            styles.optionText,
                                            {
                                                color:
                                                    selectedOption === option
                                                        ? '#fff'
                                                        : theme.textPrimary,
                                            },
                                        ]}
                                    >
                                        {option}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        <View style={styles.customSection}>
                            <TextInput
                                style={[
                                    styles.customInput,
                                    {
                                        backgroundColor: theme.background,
                                        color: theme.textPrimary,
                                        borderColor: isCustom
                                            ? theme.accent
                                            : theme.border,
                                    },
                                ]}
                                placeholder="Or enter your own option..."
                                placeholderTextColor={theme.textSecondary}
                                value={customInput}
                                onChangeText={setCustomInput}
                                onFocus={handleCustomFocus}
                                multiline
                                numberOfLines={2}
                                textAlignVertical="top"
                            />
                        </View>

                        <View style={styles.buttons}>
                            <TouchableOpacity
                                style={[
                                    styles.button,
                                    styles.cancelButton,
                                    { borderColor: theme.border },
                                ]}
                                onPress={handleCancel}
                            >
                                <Text
                                    theme={descriptor}
                                    tone="secondary"
                                    style={styles.buttonText}
                                >
                                    Cancel
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[
                                    styles.button,
                                    styles.submitButton,
                                    {
                                        backgroundColor:
                                            !selectedOption &&
                                            !customInput.trim()
                                                ? theme.border
                                                : theme.accent,
                                    },
                                ]}
                                onPress={handleSubmit}
                                disabled={
                                    !selectedOption && !customInput.trim()
                                }
                            >
                                <Text
                                    theme={descriptor}
                                    style={styles.submitButtonText}
                                >
                                    Send
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    keyboardAvoiding: {
        flex: 1,
    },
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    container: {
        width: '100%',
        maxWidth: 400,
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 8,
    },
    question: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 20,
    },
    scrollView: {
        maxHeight: 200,
        marginBottom: 16,
    },
    optionButton: {
        padding: 14,
        borderRadius: 10,
        borderWidth: 2,
        marginBottom: 8,
    },
    optionText: {
        fontSize: 15,
        fontWeight: '500',
    },
    customSection: {
        marginBottom: 16,
    },
    customInput: {
        borderWidth: 2,
        borderRadius: 10,
        padding: 12,
        fontSize: 15,
        minHeight: 60,
    },
    buttons: {
        flexDirection: 'row',
        gap: 12,
    },
    button: {
        flex: 1,
        padding: 14,
        borderRadius: 10,
        alignItems: 'center',
    },
    cancelButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
    },
    submitButton: {
        opacity: 1,
    },
    buttonText: {
        fontSize: 15,
        fontWeight: '600',
    },
    submitButtonText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#fff',
    },
});
