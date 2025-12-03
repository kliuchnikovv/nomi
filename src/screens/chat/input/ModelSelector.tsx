import React from 'react';
import {
    Modal,
    View,
    Text,
    Pressable,
    FlatList,
    ActivityIndicator,
} from 'react-native';
import { theme } from '../../../themes';
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
    hasChatStarted?: boolean;
};

const buildDefaultTeamCommand = (modelId: string | null) => {
    const model = modelId || 'gemini-1.5-pro';
    return {
        name: 'Default Team',
        model,
        participants: [
            { type: 'mailer', model },
            { type: 'rag', model },
            { type: 'memoriser', model },
        ],
    };
};

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
    hasChatStarted = false,
}: Props) {
    const handleSelect = (modelId: string) => {
        if (hasChatStarted) {
            return; // Don't allow model change after chat started
        }
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
                        backgroundColor: theme.surface,
                        borderRadius: 12,
                        padding: 20,
                        width: '80%',
                        maxWidth: 400,
                        maxHeight: '70%',
                        borderWidth: 1,
                        borderColor: theme.border,
                    }}
                    onPress={(e) => e.stopPropagation()}
                >
                    <Text
                        style={{
                            fontSize: 18,
                            fontWeight: '600',
                            color: theme.textPrimary,
                            marginBottom: 12,
                        }}
                    >
                        Select Mode
                    </Text>

                    {hasChatStarted && (
                        <View style={{
                            backgroundColor: `${theme.accent}1F`,
                            borderRadius: 8,
                            padding: 12,
                            marginBottom: 12,
                            borderWidth: 1,
                            borderColor: `${theme.accent}40`,
                        }}>
                            <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: 'center' }}>
                                Model selection is disabled after chat starts
                            </Text>
                        </View>
                    )}

                    {loading ? (
                        <View style={{ padding: 40, alignItems: 'center' }}>
                            <ActivityIndicator size="large" color={theme.accent} />
                        </View>
                    ) : (
                        <FlatList
                            data={models}
                            keyExtractor={(item) => item.id}
                            renderItem={({ item }) => (
                                <Pressable
                                    onPress={() => handleSelect(item.id)}
                                    disabled={hasChatStarted}
                                    style={({ pressed }) => ({
                                        padding: 12,
                                        borderRadius: 8,
                                        marginBottom: 8,
                                        backgroundColor:
                                            item.id === selectedModel
                                                ? theme.accent + '20'
                                                : pressed
                                                    ? theme.border
                                                    : 'transparent',
                                        borderWidth: 1,
                                        borderColor:
                                            item.id === selectedModel
                                                ? theme.accent
                                                : theme.border,
                                        opacity: hasChatStarted ? 0.5 : 1,
                                    })}
                                >
                                    <Text
                                        style={{
                                            fontSize: 16,
                                            fontWeight: item.id === selectedModel ? '600' : '400',
                                            color: theme.text,
                                            marginBottom: 4,
                                        }}
                                    >
                                        {item.name}
                                    </Text>
                                    {item.description && (
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                color: theme.textSecondary,
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
                            backgroundColor: pressed ? theme.border : 'transparent',
                            alignItems: 'center',
                        })}
                    >
                        <Text style={{ color: theme.textSecondary, fontSize: 16 }}>
                            Cancel
                        </Text>
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
    );
}
