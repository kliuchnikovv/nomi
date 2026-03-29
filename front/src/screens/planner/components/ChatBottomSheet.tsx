import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import BottomSheet, {
    BottomSheetView,
    BottomSheetFlatList,
} from '@gorhom/bottom-sheet';
import { useTheme } from '../../../context/ThemeContext';
import { usePlannerChat, ChatMessage } from '../hooks/usePlannerChat';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
    isOpen: boolean;
    onClose: () => void;
    date: string; // YYYY-MM-DD — passed through to usePlannerChat context if needed
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatBottomSheet({ isOpen, onClose, date: _date }: Props) {
    const { theme } = useTheme();
    const bottomSheetRef = useRef<BottomSheet>(null);
    const snapPoints = ['40%', '80%'];

    const { messages, sendMessage, isConnected } = usePlannerChat();

    const [inputText, setInputText] = useState('');

    // Sync open/close state → bottom sheet index
    useEffect(() => {
        if (isOpen) {
            bottomSheetRef.current?.snapToIndex(0);
        } else {
            bottomSheetRef.current?.close();
        }
    }, [isOpen]);

    // Called when bottom sheet is closed by swipe
    const handleSheetChanges = useCallback(
        (index: number) => {
            if (index === -1) {
                onClose();
            }
        },
        [onClose],
    );

    const handleSend = useCallback(() => {
        const text = inputText.trim();
        if (!text) return;
        sendMessage(text);
        setInputText('');
    }, [inputText, sendMessage]);

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    const renderMessage = ({ item }: { item: ChatMessage }) => {
        const isUser = item.role === 'user';
        return (
            <View
                style={[
                    styles.bubble,
                    isUser
                        ? [styles.userBubble, { backgroundColor: '#007AFF' }]
                        : [styles.assistantBubble, { backgroundColor: theme.surface }],
                ]}
            >
                <Text
                    style={[
                        styles.bubbleText,
                        { color: isUser ? '#FFFFFF' : theme.textPrimary },
                    ]}
                >
                    {item.text}
                </Text>
            </View>
        );
    };

    return (
        <BottomSheet
            ref={bottomSheetRef}
            index={-1}
            snapPoints={snapPoints}
            enablePanDownToClose
            onChange={handleSheetChanges}
            handleComponent={() => (
                <View style={styles.handleContainer}>
                    <View style={styles.handle} />
                </View>
            )}
            backgroundStyle={{ backgroundColor: theme.background }}
        >
            <BottomSheetView style={styles.container}>
                {/* Header */}
                <View
                    style={[
                        styles.header,
                        { borderBottomColor: theme.border },
                    ]}
                >
                    <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
                        ✦ Genie
                    </Text>
                    {!isConnected && (
                        <Text style={[styles.connectingLabel, { color: theme.textSecondary }]}>
                            подключение...
                        </Text>
                    )}
                    <TouchableOpacity
                        onPress={onClose}
                        style={styles.closeBtn}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Text style={[styles.closeBtnText, { color: theme.textSecondary }]}>
                            Закрыть
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Messages */}
                <BottomSheetFlatList
                    data={messages}
                    keyExtractor={item => item.id}
                    renderItem={renderMessage}
                    contentContainerStyle={styles.messageList}
                    ListEmptyComponent={
                        <Text
                            style={[
                                styles.emptyText,
                                { color: theme.textSecondary },
                            ]}
                        >
                            Спроси Genie про этот день…
                        </Text>
                    }
                />

                {/* Input bar */}
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    keyboardVerticalOffset={8}
                >
                    <View
                        style={[
                            styles.inputBar,
                            {
                                borderTopColor: theme.border,
                                backgroundColor: theme.background,
                            },
                        ]}
                    >
                        <TextInput
                            style={[
                                styles.textInput,
                                {
                                    color: theme.textPrimary,
                                    backgroundColor: theme.surface,
                                    borderColor: theme.border,
                                },
                            ]}
                            placeholder="Написать Genie…"
                            placeholderTextColor={theme.textSecondary}
                            value={inputText}
                            onChangeText={setInputText}
                            returnKeyType="send"
                            onSubmitEditing={handleSend}
                            blurOnSubmit={false}
                        />
                        <TouchableOpacity
                            onPress={handleSend}
                            disabled={!inputText.trim()}
                            activeOpacity={0.7}
                            style={[
                                styles.sendBtn,
                                {
                                    backgroundColor: inputText.trim()
                                        ? '#007AFF'
                                        : theme.border,
                                },
                            ]}
                        >
                            <Text style={styles.sendBtnIcon}>↑</Text>
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </BottomSheetView>
        </BottomSheet>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    handleContainer: {
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 4,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#8E8E93',
    },
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 8,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '700',
        flex: 1,
    },
    connectingLabel: {
        fontSize: 12,
    },
    closeBtn: {
        paddingHorizontal: 4,
    },
    closeBtnText: {
        fontSize: 14,
    },
    messageList: {
        padding: 12,
        gap: 8,
        flexGrow: 1,
    },
    bubble: {
        maxWidth: '80%',
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 6,
    },
    userBubble: {
        alignSelf: 'flex-end',
        borderBottomRightRadius: 4,
    },
    assistantBubble: {
        alignSelf: 'flex-start',
        borderBottomLeftRadius: 4,
    },
    bubbleText: {
        fontSize: 15,
        lineHeight: 22,
    },
    emptyText: {
        textAlign: 'center',
        marginTop: 32,
        fontSize: 14,
    },
    inputBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    textInput: {
        flex: 1,
        fontSize: 15,
        borderRadius: 18,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: Platform.OS === 'ios' ? 8 : 6,
        minHeight: 36,
    },
    sendBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendBtnIcon: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        lineHeight: 20,
    },
});
