import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    View,
    StyleSheet,
    Platform,
    KeyboardAvoidingView,
    TouchableOpacity,
    Text,
    FlatList,
    Pressable,
    Animated,
    Easing,
    useWindowDimensions,
    Linking,
} from 'react-native';
import { GiftedChat, IMessage, InputToolbar, Bubble, Send, Composer, MessageText, Message } from 'react-native-gifted-chat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Microphone, Sparks, Menu } from 'iconoir-react-native';
import { useChat } from './context';
import { useAuth } from '../auth/context';
import { Chat, Message as GenieMessage } from '../main/models';
import { useMain } from '../main/context';
import Markdown from 'react-native-markdown-display';

const palette = {
    background: '#0C0C10',
    surface: '#111118',
    surfaceAlt: '#14141F',
    border: '#1F1F2C',
    textPrimary: '#E6E7EC',
    textSecondary: '#A6A7AE',
    accent: '#7C8CFF',
    accentAlt: '#6AE6C9',
    userBubble: '#2E3053',
    assistantBubble: '#1A1B2A',
};

const ASSISTANT_BUBBLE_WIDTH_RATIO = 0.95; // Adjust this ratio to change assistant bubble width

// Extended IMessage interface to include our custom metadata
interface ExtendedIMessage extends IMessage {
    // metadata?: { // No longer used by the iMessage style bubble
    //     actions?: any[];
    //     importance?: number;
    //     role?: string;
    //     originalMessage?: GenieMessage;
    //     [key: string]: any;
    // };
}

export default function ChatScreen() {
    const {
        messages,
        sendMessage,
        assistantWorking,
        externalTitle,
        // executeMessageAction, // No longer used
        // isPluginThread // No longer used
    } = useChat();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const { chats, activeChatID, setActiveChatID, getChats, createNewChat } = useMain();
    const [menuVisible, setMenuVisible] = useState(false);
    const menuAnim = useRef(new Animated.Value(0)).current;
    const assistantBubbleMaxWidth = windowWidth * ASSISTANT_BUBBLE_WIDTH_RATIO;
    const assistantContainerMaxWidth = `${ASSISTANT_BUBBLE_WIDTH_RATIO * 100}%`;

    // Convert Genie messages to Gifted Chat format
    const giftedMessages = useMemo(() => {
        const getTimestamp = (value?: number | string | null) => {
            if (!value) {
                return 0;
            }
            if (typeof value === 'number') {
                return value;
            }
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? 0 : parsed;
        };

        // Sort oldest -> newest so GiftedChat (with inverted list) renders in correct order
        const sorted = [...messages].sort(
            (a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at),
        );

        console.log(sorted)

        return sorted.map((msg): ExtendedIMessage => {
            const isUserMessage = msg.role === 'user';

            return {
                _id: String(msg.id || `${msg.created_at}-${msg.role}`),
                text: msg.text.trimEnd() || '',
                createdAt: new Date(msg.created_at || Date.now()),
                user: {
                    _id: isUserMessage ? (user?.id || 'user') : 'assistant',
                    name: isUserMessage ? 'You' : 'Assistant',
                },
            };
        });
    }, [messages, user?.id]);

    const handleSend = useCallback((newMessages: IMessage[] = []) => {
        if (newMessages.length > 0 && newMessages[0].text) {
            sendMessage(newMessages[0].text.trim());
        }
    }, [sendMessage]);

    // No longer needed for iMessage style bubble
    // const handleActionPress = useCallback(async (action: Action) => {
    //     await executeMessageAction(action, action.message_id);
    // }, [executeMessageAction]);

    const renderBubble = useCallback((props: any) => {
        return (
            <Bubble
                {...props}
                wrapperStyle={{
                    right: {
                        backgroundColor: palette.userBubble,
                        borderRadius: 18,
                        borderBottomRightRadius: 6,
                        padding: 4,
                        marginBottom: 0,
                    },
                    left: {
                        backgroundColor: palette.background,
                        borderRadius: 18,
                        // borderBottomLeftRadius: 6,
                        padding: 4,
                        paddingLeft:10,
                        // paddingBottom: 0,
                        marginBottom: 0,
                        // borderWidth: StyleSheet.hairlineWidth,
                        // borderColor: palette.border,
                    },
                }}
                textStyle={{
                    right: {
                        color: palette.textPrimary,
                        fontSize: 16,
                        lineHeight: 22,
                    },
                    left: {
                        color: palette.textPrimary,
                        fontSize: 16,
                        lineHeight: 22,
                    },
                }}
                timeTextStyle={{
                    right: { color: palette.textSecondary },
                    left: { color: palette.textSecondary },
                }}
            />
        );
    }, [assistantBubbleMaxWidth]);

    const renderInputToolbar = useCallback((props: any) => {
        return (
            <InputToolbar
                {...props}
                containerStyle={styles.inputToolbarContainer}
                primaryStyle={[
                    styles.inputToolbarPrimary,
                    { paddingBottom: Math.max(insets.bottom, 20) }
                ]}
                renderActions={() => (
                    <TouchableOpacity style={styles.actionButton}>
                        <Plus width={24} height={24} color="#E8EAED" strokeWidth={2} />
                    </TouchableOpacity>
                )}
            />
        );
    }, [insets.bottom]);

    const renderComposer = useCallback((props: any) => {
        return (
            <Composer
                {...props}
                textInputStyle={styles.textInput}
                placeholder="Ask Gemini"
                placeholderTextColor="#9AA0A6"
            />
        );
    }, []);

    const renderMessage = useCallback((props: any) => {
        return (
            <Message
                {...props}
                containerStyle={{
                    left: [{ maxWidth: assistantContainerMaxWidth }],
                }}
            />
        );
    }, [assistantContainerMaxWidth]);

    const renderMessageText = useCallback((props: any) => {
        const isAssistant = props.currentMessage?.user?._id === 'assistant';
        if (!isAssistant) {
            return <MessageText {...props} />;
        }

        return (
            <Markdown
                style={markdownStyles as any}
                onLinkPress={url => {
                    Linking.openURL(url).catch(() => {});
                    return false;
                }}
            >
                {props.currentMessage?.text || ''}
            </Markdown>
        );
    }, []);

    const renderSend = useCallback((props: any) => {
        const hasText = props.text && props.text.trim().length > 0;

        if (hasText) {
            return (
                <Send
                    {...props}
                    containerStyle={styles.sendContainer}
                >
                    <View style={styles.sendButton}>
                        <View style={styles.arrowUp} />
                    </View>
                </Send>
            );
        }

        return (
            <View style={styles.rightIconsContainer}>
                <TouchableOpacity style={styles.iconButton}>
                    <Microphone width={24} height={24} color={palette.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton}>
                    <Sparks width={24} height={24} color={palette.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
            </View>
        );
    }, []);

    const renderFooter = useCallback(() => {
        if (!assistantWorking) {
            return null;
        }

        return (
            <View style={styles.footerContainer}>
                <View style={styles.typingDot} />
                <Text style={styles.footerText}>Assistant is thinking…</Text>
            </View>
        );
    }, [assistantWorking]);

    const currentUser = useMemo(() => ({
        _id: user?.id || 'user',
        name: 'You',
    }), [user?.id]);

    const getTimestamp = useCallback((value?: number | string | null) => {
        if (!value) {
            return 0;
        }
        if (typeof value === 'number') {
            return value;
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }, []);

    const sortedChats = useMemo(
        () => [...(chats || [])].sort((a, b) => getTimestamp(b.updated_at) - getTimestamp(a.updated_at)),
        [chats, getTimestamp],
    );

    const sheetWidth = windowWidth * 0.9;

    const menuBackdropOpacity = menuAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.6],
    });
    const menuCardTranslate = menuAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-sheetWidth * 0.4, 0],
    });
    const menuCardScale = menuAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0.94, 1],
    });
    const menuCardOpacity = menuAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
    });

    const handleOpenMenu = useCallback(() => {
        getChats();
        if (!menuVisible) {
            setMenuVisible(true);
        }
        Animated.spring(menuAnim, {
            toValue: 1,
            useNativeDriver: true,
            tension: 180,
            friction: 18,
        }).start();
    }, [getChats, menuAnim, menuVisible]);

    const handleCloseMenu = useCallback(() => {
        if (!menuVisible) {
            return;
        }
        Animated.timing(menuAnim, {
            toValue: 0,
            duration: 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
        }).start(({ finished }) => {
            if (finished) {
                setMenuVisible(false);
            }
        });
    }, [menuAnim, menuVisible]);

    const handleSelectChat = useCallback((chatId: string) => {
        setActiveChatID(chatId);
        handleCloseMenu();
    }, [handleCloseMenu, setActiveChatID]);

    const handleNewChat = useCallback(() => {
        createNewChat();
        handleCloseMenu();
    }, [createNewChat, handleCloseMenu]);

    const renderChatItem = useCallback(({ item }: { item: Chat }) => {
        const isActive = item.id === activeChatID;
        return (
            <TouchableOpacity
                style={[styles.menuChatItem, isActive && styles.menuChatItemActive]}
                onPress={() => handleSelectChat(item.id)}
            >
                <Text style={[styles.menuChatTitle, isActive && styles.menuChatTitleActive]} numberOfLines={1}>
                    {item.title || 'Без названия'}
                </Text>
                <Text style={styles.menuChatTimestamp} numberOfLines={1}>
                    {new Date(item.updated_at || item.created_at).toLocaleString()}
                </Text>
            </TouchableOpacity>
        );
    }, [activeChatID, handleSelectChat]);

    const headerTitle = externalTitle || 'Gemini';
    const headerSubtitle = assistantWorking ? 'Assistant is thinking…' : 'Available to help';

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.menuButton} onPress={handleOpenMenu}>
                    <Menu width={22} height={22} color={palette.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
                <View style={styles.headerAvatar}>
                    <Text style={styles.headerAvatarText}>G</Text>
                </View>
                <View style={styles.headerBody}>
                    <Text style={styles.headerTitle}>{headerTitle}</Text>
                    <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>
                </View>
                <View style={styles.headerBadge}>
                    <Text style={styles.headerBadgeText}>AI</Text>
                </View>
            </View>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={insets.bottom}
            >
                <GiftedChat
                    messages={giftedMessages}
                    onSend={handleSend}
                    user={currentUser}
                    renderMessage={renderMessage}
                    renderBubble={renderBubble}
                    renderMessageText={renderMessageText}
                    renderInputToolbar={renderInputToolbar}
                    renderComposer={renderComposer}
                    renderSend={renderSend}
                    isTyping={assistantWorking}
                    renderFooter={renderFooter}
                    // @ts-ignore
                    inverted={true}
                    minInputToolbarHeight={80}
                    maxComposerHeight={100}
                    // Hide avatars for iMessage look
                    renderAvatar={null}
                    messagesContainerStyle={styles.messagesContainer}
                    placeholder="Type a message..."
                    scrollToBottom
                    alwaysShowSend
                    isAlignedTop={false}
                    isScrollToBottomEnabled={true}
                />
            </KeyboardAvoidingView>

            {menuVisible && (
                <View style={styles.menuLayer} pointerEvents="box-none">
                    <Pressable style={StyleSheet.absoluteFillObject} onPress={handleCloseMenu}>
                        <Animated.View style={[styles.menuBackdrop, { opacity: menuBackdropOpacity }]} />
                    </Pressable>
                    <Animated.View
                        style={[
                            styles.menuContainer,
                            {
                                width: sheetWidth,
                                paddingTop: 20,
                                paddingBottom: 0,
                                opacity: menuCardOpacity,
                                transform: [
                                    { translateX: menuCardTranslate },
                                    { scale: menuCardScale },
                                ],
                            },
                        ]}
                    >
                        <View style={styles.menuHeader}>
                            <Text style={styles.menuTitle}>Ваши чаты</Text>
                            <TouchableOpacity style={styles.menuNewChatBtn} onPress={handleNewChat}>
                                <Text style={styles.menuNewChatText}>＋ Новый чат</Text>
                            </TouchableOpacity>
                        </View>
                        <FlatList
                            data={sortedChats}
                            keyExtractor={item => item.id}
                            renderItem={renderChatItem}
                            style={styles.menuList}
                            contentContainerStyle={styles.menuListContent}
                            showsVerticalScrollIndicator={false}
                        />
                    </Animated.View>
                </View>
            )}
        </View>
    );
}

const markdownStyles = {
    body: {
        color: palette.textPrimary,
        fontSize: 16,
        lineHeight: 22,
        fontFamily: 'System',
    },
    link: {
        color: palette.accent,
        fontSize: 16,
        fontFamily: 'System',
    },
    bullet_list: {
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    ordered_list: {
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    list_item: {
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    paragraph: {
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
        lineHeight: 22,
    },
    heading1: {
        color: palette.textPrimary,
        fontSize: 22,
        fontFamily: 'System',
        marginBottom: 6,
    },
    heading2: {
        color: palette.textPrimary,
        fontSize: 20,
        fontFamily: 'System',
        marginBottom: 6,
    },
    heading3: {
        color: palette.textPrimary,
        fontSize: 18,
        fontFamily: 'System',
        marginBottom: 4,
    },
    strong: {
        fontWeight: '700',
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    em: {
        fontStyle: 'italic',
        color: palette.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    code_inline: {
        backgroundColor: '#1C1C29',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 6,
        color: palette.accentAlt,
        fontFamily: 'Courier',
    },
    code_block: {
        backgroundColor: '#1C1C29',
        padding: 8,
        borderRadius: 10,
        color: palette.accentAlt,
        fontFamily: 'Courier',
    },
    fence: {
        backgroundColor: '#1C1C29',
        padding: 8,
        borderRadius: 10,
        color: palette.accentAlt,
        fontFamily: 'Courier',
    },
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: palette.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: palette.border,
        backgroundColor: '#111118',
    },
    menuButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: palette.surface,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
    },
    headerAvatar: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: palette.userBubble,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    headerAvatarText: {
        color: palette.textPrimary,
        fontSize: 18,
        fontWeight: '700',
    },
    headerBody: {
        flex: 1,
    },
    headerTitle: {
        color: palette.textPrimary,
        fontSize: 18,
        fontWeight: '600',
    },
    headerSubtitle: {
        color: palette.textSecondary,
        fontSize: 13,
        marginTop: 2,
    },
    headerBadge: {
        backgroundColor: palette.accent,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
    },
    headerBadgeText: {
        color: palette.background,
        fontSize: 12,
        fontWeight: '700',
    },
    messagesContainer: {
        backgroundColor: palette.background,
        paddingHorizontal: 8,
    },
    inputToolbarContainer: {
        backgroundColor: 'transparent',
        borderTopWidth: 0,
        paddingHorizontal: 0,
        paddingBottom: 0,
    },
    inputToolbarPrimary: {
        backgroundColor: palette.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        alignItems: 'center',
        paddingHorizontal: 12,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        paddingTop: 8,
    },
    textInput: {
        color: palette.textPrimary,
        fontSize: 16,
        lineHeight: 20,
        marginTop: 8,
        marginBottom: 8,
        marginLeft: 8,
        paddingRight: 8,
    },
    actionButton: {
        width: 40,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 4,
    },
    rightIconsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 44,
        marginRight: 8,
    },
    iconButton: {
        width: 40,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },
    sendContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'center',
        marginRight: 8,
        marginBottom: 0,
        height: 44,
    },
    sendButton: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: palette.accent,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
    },
    arrowUp: {
        width: 0,
        height: 0,
        backgroundColor: 'transparent',
        borderStyle: 'solid',
        borderLeftWidth: 6,
        borderRightWidth: 6,
        borderBottomWidth: 10,
        borderLeftColor: 'transparent',
        borderRightColor: 'transparent',
        borderBottomColor: palette.textPrimary,
        transform: [{ translateY: -1 }],
    },
    footerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 8,
        paddingBottom: 20,
    },
    typingDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: palette.accentAlt,
        marginRight: 8,
    },
    footerText: {
        color: palette.textSecondary,
        fontSize: 13,
    },
    menuLayer: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
    },
    menuBackdrop: {
        flex: 1,
        backgroundColor: palette.background,
    },
    menuContainer: {
        height: '100%',
        backgroundColor: '#111118',
        // borderTopRightRadius: 28,
        // borderBottomRightRadius: 28,
        paddingHorizontal: 20,
        // borderWidth: StyleSheet.hairlineWidth,
        // borderColor: palette.border,
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
    },
    menuHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    menuTitle: {
        color: palette.textPrimary,
        fontSize: 18,
        fontWeight: '600',
    },
    menuNewChatBtn: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 14,
        backgroundColor: palette.userBubble,
    },
    menuNewChatText: {
        color: palette.textPrimary,
        fontSize: 13,
        fontWeight: '600',
    },
    menuList: {
        flex: 1,
    },
    menuListContent: {
        paddingBottom: 24,
    },
    menuChatItem: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: palette.surface,
        marginBottom: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'transparent',
    },
    menuChatItemActive: {
        borderColor: palette.accent,
    },
    menuChatTitle: {
        color: palette.textPrimary,
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 2,
    },
    menuChatTitleActive: {
        color: palette.accentAlt,
    },
    menuChatTimestamp: {
        color: palette.textSecondary,
        fontSize: 12,
    },
});
