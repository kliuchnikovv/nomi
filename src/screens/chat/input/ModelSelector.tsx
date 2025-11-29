import React from 'react';
import {
    Modal,
    View,
    Text,
    Pressable,
    FlatList,
    ActivityIndicator,
} from 'react-native';
import { oneDark } from '../../../themes/oneDark';
import { Model } from '../models';

type Props = {
    visible: boolean;
    onClose: () => void;
    models: Model[];
    selectedModel: string | null;
    onSelectModel: (modelId: string) => void;
    loading?: boolean;
    chatMode: 'agent' | 'team';
    onModeChange: (mode: 'agent' | 'team') => void;
    teamCommand: any;
    onChangeTeamCommand: (cmd: any) => void;
};

const buildDefaultTeamCommand = (modelId: string | null) => ({
    name: 'Default Team',
    model: modelId || 'gemini-1.5-pro',
    participants: [
        { type: 'mailer' },
        { type: 'rag', model: modelId || 'gemini-1.5-pro' },
        { type: 'memoriser' },
    ],
});

export default function ModelSelector({
    visible,
    onClose,
    models,
    selectedModel,
    onSelectModel,
    loading = false,
    chatMode,
    onModeChange,
    teamCommand,
    onChangeTeamCommand,
}: Props) {
    const handleSelect = (modelId: string) => {
        onSelectModel(modelId);
        if (chatMode === 'team') {
            onChangeTeamCommand(buildDefaultTeamCommand(modelId));
        }
        onClose();
    };

    const switchToMode = (mode: 'agent' | 'team') => {
        if (mode === 'team') {
            onChangeTeamCommand(buildDefaultTeamCommand(selectedModel));
        } else {
            onChangeTeamCommand(null);
        }
        onModeChange(mode);
    };

    const defaultTeamJson = React.useMemo(() => {
        const cmd = teamCommand || buildDefaultTeamCommand(selectedModel);
        try {
            return JSON.stringify(cmd, null, 2);
        } catch {
            return '';
        }
    }, [teamCommand, selectedModel]);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable
                style={{
                    flex: 1,
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    justifyContent: 'center',
                    alignItems: 'center',
                }}
                onPress={onClose}
            >
                <Pressable
                    style={{
                        backgroundColor: oneDark.background,
                        borderRadius: 12,
                        padding: 20,
                        width: '80%',
                        maxWidth: 400,
                        maxHeight: '70%',
                        borderWidth: 1,
                        borderColor: oneDark.border,
                    }}
                    onPress={(e) => e.stopPropagation()}
                >
                    <Text
                        style={{
                            fontSize: 18,
                            fontWeight: '600',
                            color: oneDark.text,
                            marginBottom: 12,
                        }}
                    >
                        Выбор режима
                    </Text>

                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                        {(['agent', 'team'] as const).map(mode => (
                            <Pressable
                                key={mode}
                                onPress={() => switchToMode(mode)}
                                style={({ pressed }) => ({
                                    paddingVertical: 8,
                                    paddingHorizontal: 12,
                                    borderRadius: 10,
                                    backgroundColor:
                                        chatMode === mode
                                            ? oneDark.accent
                                            : pressed
                                                ? oneDark.border
                                                : 'transparent',
                                    borderWidth: 1,
                                    borderColor:
                                        chatMode === mode
                                            ? oneDark.accent
                                            : oneDark.border,
                                })}
                            >
                                <Text
                                    style={{
                                        color: chatMode === mode ? oneDark.background : oneDark.text,
                                        fontWeight: '700',
                                    }}
                                >
                                    {mode === 'agent' ? 'Агент' : 'Команда'}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    {chatMode === 'team' ? (
                        <View>
                            <Text style={{ color: oneDark.textSecondary, fontSize: 13, marginBottom: 6 }}>
                                Используется команда по умолчанию с полным составом. Меняется модель — обновляется команда.
                            </Text>
                            <View
                                style={{
                                    backgroundColor: oneDark.background,
                                    borderRadius: 10,
                                    padding: 12,
                                    borderWidth: 1,
                                    borderColor: oneDark.border,
                                }}
                            >
                                <Text
                                    style={{
                                        color: oneDark.textSecondary,
                                        fontSize: 12,
                                        fontFamily: 'Menlo',
                                    }}
                                >
                                    {defaultTeamJson}
                                </Text>
                            </View>
                        </View>
                    ) : loading ? (
                        <View style={{ padding: 40, alignItems: 'center' }}>
                            <ActivityIndicator size="large" color={oneDark.accent} />
                        </View>
                    ) : (
                        <FlatList
                            data={models}
                            keyExtractor={(item) => item.id}
                            renderItem={({ item }) => (
                                <Pressable
                                    onPress={() => handleSelect(item.id)}
                                    style={({ pressed }) => ({
                                        padding: 12,
                                        borderRadius: 8,
                                        marginBottom: 8,
                                        backgroundColor:
                                            item.id === selectedModel
                                                ? oneDark.accent + '20'
                                                : pressed
                                                    ? oneDark.border
                                                    : 'transparent',
                                        borderWidth: 1,
                                        borderColor:
                                            item.id === selectedModel
                                                ? oneDark.accent
                                                : oneDark.border,
                                    })}
                                >
                                    <Text
                                        style={{
                                            fontSize: 16,
                                            fontWeight: item.id === selectedModel ? '600' : '400',
                                            color: oneDark.text,
                                            marginBottom: 4,
                                        }}
                                    >
                                        {item.name}
                                    </Text>
                                    {item.description && (
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                color: oneDark.textSecondary,
                                            }}
                                        >
                                            {item.description}
                                        </Text>
                                    )}
                                </Pressable>
                            )}
                        />
                    )}

                    <Pressable
                        onPress={onClose}
                        style={({ pressed }) => ({
                            marginTop: 16,
                            padding: 12,
                            borderRadius: 8,
                            backgroundColor: pressed ? oneDark.border : 'transparent',
                            alignItems: 'center',
                        })}
                    >
                        <Text style={{ color: oneDark.textSecondary, fontSize: 16 }}>
                            Cancel
                        </Text>
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
    );
}
