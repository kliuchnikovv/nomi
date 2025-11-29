import React from 'react';
import {
    ActionSheetIOS,
    FlatList,
    Pressable,
    Text,
    View,
} from 'react-native';

import { Chat } from '../main/models';
import { Settings } from 'iconoir-react-native';
import { styles } from './styles.tsx';

type Props = {
    width: number;
    chats: Chat[];
    activeChatID: string | null;
    onSelect: (id: string) => void;
    onNewChat: () => void;
    onChatDelete: (id: string) => void;
    onOpenSettings: () => void;
    onCollapse?: () => void;
};

export default function Sidebar({
    width,
    chats,
    activeChatID,
    onSelect,
    onNewChat,
    onChatDelete,
    onOpenSettings,
}: Props) {
    const [highlightedChatID, setHighlightedChatID] = React.useState<string | null>(null);

    const openMenu = (chat_id: string) => {
        setHighlightedChatID(chat_id);
        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: ['Rename', 'Delete', 'Cancel'],
                destructiveButtonIndex: 1,
                cancelButtonIndex: 2,
                userInterfaceStyle: 'dark',
            },
            (i) => {
                setHighlightedChatID(null);
                // if (i === 0) onRename();
                if (i === 1) onChatDelete(chat_id);
            }
        );
    };

    return (
        <View style={[styles.root, { width }]}>
            <View style={styles.topBar}>
                <Pressable style={styles.newChatBtn} onPress={onNewChat}>
                    <Text style={styles.newChatText}>＋ Новый чат</Text>
                </Pressable>
            </View>
            <FlatList
                data={chats}
                keyExtractor={item => item.id}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
                    <Pressable
                        onPress={() => onSelect(item.id)}
                        style={[
                            styles.chatItem,
                            item.id === activeChatID && styles.chatItemActive,
                            item.id === highlightedChatID && styles.chatItemHighlighted,
                        ]}
                        onLongPress={() => openMenu(item.id)}
                    >
                        <Text
                            style={[
                                styles.chatTitle,
                                item.id === activeChatID && styles.chatTitleActive,
                            ]}
                            numberOfLines={1}
                        >
                            {item.title || 'Без названия'}
                        </Text>
                        <Text style={styles.chatSubtitle} numberOfLines={1}>
                            {new Date(item.created_at).toLocaleString()}
                        </Text>
                    </Pressable>
                )}
            />
            <View style={styles.bottomBar}>
                <Pressable style={styles.settingsBtn} onPress={onOpenSettings}>
                    <Settings
                        width={28}
                        height={28}
                        color={styles.settingsColor.color}
                    />
                    <Text style={styles.settingsText}>Settings</Text>
                </Pressable>
            </View>
        </View>
    );
}