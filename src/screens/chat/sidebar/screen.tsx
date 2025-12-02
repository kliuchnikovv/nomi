import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, Text, View } from 'react-native';
import { ChatSidebarProps } from './models';
import { styles } from './styles';

function ChatList({
    chats,
    activeChatID,
    onSelectChat,
    onNewChat,
}: Pick<ChatSidebarProps, 'chats' | 'activeChatID' | 'onSelectChat' | 'onNewChat'>) {
    const renderItem = ({ item }: { item: typeof chats[number] }) => {
        const isActive = item.id === activeChatID;
        return (
            <Pressable
                style={[styles.item, isActive && styles.itemActive]}
                onPress={() => onSelectChat(item.id)}
            >
                <Text style={[styles.itemTitle, isActive && { color: styles.title.color }]} numberOfLines={1}>
                    {item.title || 'Без названия'}
                </Text>
                <Text style={styles.itemSubtitle} numberOfLines={1}>
                    {new Date(item.updated_at || item.created_at).toLocaleString()}
                </Text>
            </Pressable>
        );
    };

    return (
        <>
            <View style={styles.header}>
                <Text style={styles.title}>Chats</Text>
                <Pressable onPress={onNewChat} style={styles.newChatButton}>
                    <Text style={styles.newChatText}>＋ New</Text>
                </Pressable>
            </View>
            <FlatList
                data={chats}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />
        </>
    );
}

export function ChatSidebar({
    variant,
    width,
    visible = true,
    chats,
    activeChatID,
    onClose,
    onSelectChat,
    onNewChat,
}: ChatSidebarProps) {
    const animation = useRef(new Animated.Value(0)).current;
    const [shouldRender, setShouldRender] = useState(variant === 'inline' || visible);

    useEffect(() => {
        if (variant === 'inline') {
            animation.setValue(1);
            setShouldRender(true);
            return;
        }

        if (visible) {
            setShouldRender(true);
        }

        const driver = visible
            ? Animated.spring(animation, {
                toValue: 1,
                useNativeDriver: true,
                tension: 190,
                friction: 20,
            })
            : Animated.timing(animation, {
                toValue: 0,
                duration: 220,
                useNativeDriver: true,
            });

        driver.start(({ finished }) => {
            if (!visible && finished) {
                setShouldRender(false);
            }
        });
    }, [animation, variant, visible]);

    const translateX = useMemo(() => animation.interpolate({
        inputRange: [0, 1],
        outputRange: [-width * 0.4, 0],
    }), [animation, width]);

    const cardOpacity = useMemo(() => animation.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
    }), [animation]);

    const backdropOpacity = useMemo(() => animation.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.5],
    }), [animation]);

    if (!shouldRender) {
        return null;
    }

    if (variant === 'inline') {
        return (
            <View style={[styles.container, { width }]}>
                <ChatList
                    chats={chats}
                    activeChatID={activeChatID}
                    onSelectChat={onSelectChat}
                    onNewChat={onNewChat}
                />
            </View>
        );
    }

    return (
        <View style={styles.overlayRoot} pointerEvents="box-none">
            <Pressable style={styles.overlayBackdrop} onPress={onClose}>
                <Animated.View style={[styles.overlayBackdrop, { opacity: backdropOpacity }]} />
            </Pressable>
            <Animated.View
                style={[
                    {
                        width,
                        opacity: cardOpacity,
                        transform: [{ translateX }],
                    },
                    styles.overlayCard,
                ]}
            >
                <ChatList
                    chats={chats}
                    activeChatID={activeChatID}
                    onSelectChat={id => {
                        onSelectChat(id);
                        onClose?.();
                    }}
                    onNewChat={() => {
                        onNewChat();
                        onClose?.();
                    }}
                />
            </Animated.View>
        </View>
    );
}
