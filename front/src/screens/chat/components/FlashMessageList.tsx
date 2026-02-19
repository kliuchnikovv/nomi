import React, { useCallback, useMemo, memo } from 'react';
import { View, KeyboardAvoidingView, Platform, RefreshControl, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { FlashList } from '@shopify/flash-list';
import { useTheme } from '../../../context/ThemeContext';
import { ExtendedIMessage } from '../hooks/useGiftedMessages';

interface FlashMessageListProps {
    messages: ExtendedIMessage[];
    onSend: (messages: IMessage[]) => void;
    user: { _id: string; name: string };
    renderMessage: (props: any) => JSX.Element;
    renderBubble: (props: any) => JSX.Element;
    renderMessageText: (props: any) => JSX.Element;
    renderInputToolbar: (props: any) => JSX.Element;
    renderFooter: () => JSX.Element | null;
    isTyping: boolean;
    renderAvatar?: () => JSX.Element | null;
    messagesContainerStyle?: any;
    placeholder?: string;
    scrollToBottom: boolean;
    alwaysShowSend: boolean;
    isAlignedTop: boolean;
    isScrollToBottomEnabled: boolean;
    timeFormat?: string;
    onLongPress?: (context: any, message: any) => void;
    shouldUpdateMessage?: (currentProps: any, nextProps: any) => boolean;
    extraData?: any;
    listProps?: any;
    refreshControl?: JSX.Element;
}

// Memoized message item renderer for FlashList
const MemoizedMessageItem = memo(function MessageItem({
    item,
    renderMessage,
    renderBubble,
    renderMessageText,
}: {
    item: ExtendedIMessage;
    renderMessage: (props: any) => JSX.Element;
    renderBubble: (props: any) => JSX.Element;
    renderMessageText: (props: any) => JSX.Element;
}) {
    // GiftedChat message props
    const messageProps = {
        currentMessage: item,
        nextMessage: null, // FlashList doesn't provide this
        previousMessage: null, // FlashList doesn't provide this
        position: 'left' as any, // Simplified for FlashList
    };

    return (
        <View style={{ width: '100%' }}>
            {renderMessage({
                ...messageProps,
                containerStyle: {
                    left: [{ maxWidth: '95%', width: '100%' }],
                },
            })}
        </View>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for message items
    return (
        prevProps.item._id === nextProps.item._id &&
        prevProps.item.text === nextProps.item.text &&
        prevProps.item.createdAt === nextProps.item.createdAt &&
        (prevProps.item as any).content_parts === (nextProps.item as any).content_parts
    );
});

// Memoized input toolbar component
const MemoizedInputToolbar = memo(function InputToolbar({
    renderInputToolbar,
}: {
    renderInputToolbar: (props: any) => JSX.Element;
}) {
    return <View>{renderInputToolbar({})}</View>;
});

export function FlashMessageList({
    messages,
    onSend,
    user,
    renderMessage,
    renderBubble,
    renderMessageText,
    renderInputToolbar,
    renderFooter,
    isTyping,
    renderAvatar,
    messagesContainerStyle,
    placeholder,
    scrollToBottom,
    alwaysShowSend,
    isAlignedTop,
    isScrollToBottomEnabled,
    timeFormat,
    onLongPress,
    shouldUpdateMessage,
    extraData,
    listProps = {},
    refreshControl,
}: FlashMessageListProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const flatListRef = React.useRef<FlatList<any>>(null);
    const [contentHeight, setContentHeight] = React.useState(0);

    // Scroll to bottom when new message arrives
    React.useEffect(() => {
        if (scrollToBottom && flatListRef.current && messages.length > 0) {
            setTimeout(() => {
                flatListRef.current?.scrollToEnd({ animated: true });
            }, 50);
        }
    }, [messages.length, scrollToBottom]);

    // Key extractor - use message _id
    const keyExtractor = useCallback((item: ExtendedIMessage) => item._id, []);

    // Render individual message
    const renderItem = useCallback(({ item, index }: { item: ExtendedIMessage; index: number }) => {
        return (
            <MemoizedMessageItem
                item={item}
                renderMessage={renderMessage}
                renderBubble={renderBubble}
                renderMessageText={renderMessageText}
            />
        );
    }, [renderMessage, renderBubble, renderMessageText]);

    // Calculate estimated item size (average message height)
    const estimatedItemSize = useMemo(() => {
        if (messages.length === 0) return 100;
        return Math.max(60, Math.min(300, 20000 / messages.length));
    }, [messages.length]);

    // List empty state
    const ListEmptyComponent = listProps?.renderChatEmpty || (() => null);

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
            <View style={[{ flex: 1 }, messagesContainerStyle]}>
                <FlashList
                    ref={flatListRef as any}
                    data={messages}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    estimatedItemSize={estimatedItemSize}
                    // Invert the list to show newest messages at bottom
                    inverted={true}
                    // FlashList performance optimizations
                    removeClippedSubviews={true}
                    // Content layout
                    contentContainerStyle={{ padding: 8 }}
                    // Scroll settings
                    showsVerticalScrollIndicator={true}
                    // Refresh control
                    refreshControl={refreshControl}
                    // List props from GiftedChat
                    maxToRenderPerBatch={listProps.maxToRenderPerBatch || 20}
                    windowSize={listProps.windowSize || 20}
                    initialNumToRender={listProps.initialNumToRender || 20}
                    updateCellsBatchingPeriod={listProps.updateCellsBatchingPeriod || 100}
                    // Empty state
                    ListEmptyComponent={ListEmptyComponent}
                    // Footer (input toolbar)
                    ListFooterComponent={MemoizedInputToolbar ? (
                        <MemoizedInputToolbar renderInputToolbar={renderInputToolbar} />
                    ) : undefined}
                    // Footer for additional content
                    ListHeaderComponent={renderFooter && renderFooter() ? () => renderFooter!() : undefined}
                    // Extra data for re-rendering
                    extraData={extraData}
                    // Scroll handlers
                    onEndReached={listProps.onEndReached}
                    onEndReachedThreshold={listProps.onEndReachedThreshold}
                />
            </View>
        </KeyboardAvoidingView>
    );
}
