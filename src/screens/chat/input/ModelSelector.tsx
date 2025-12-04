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
import {
    NavArrowDownSolid,
    NavArrowRightSolid,
} from 'iconoir-react-native';

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
    voiceLanguage: string;
    onSelectVoiceLanguage: (lang: string) => void;
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

const VOICE_LANGUAGES = [
    { id: 'auto', name: 'Auto (Device Default)' },
    { id: 'en-US', name: 'English' },
    { id: 'ru-RU', name: 'Russian' },
    { id: 'es-ES', name: 'Spanish' },
    { id: 'de-DE', name: 'German' },
    { id: 'fr-FR', name: 'French' },
];
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
    voiceLanguage,
    onSelectVoiceLanguage,
}: Props) {
    const [expandedSection, setExpandedSection] = React.useState<'model' | 'language' | null>('model');

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

    const toggleSection = (section: 'model' | 'language') => {
        setExpandedSection(prev => prev === section ? null : section);
    };

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
                        maxHeight: '80%',
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
                            marginBottom: 16,
                            textAlign: 'center',
                        }}
                    >
                        Additional
                    </Text>

                    {/*{hasChatStarted && (*/}
                    {/*    <View style={{*/}
                    {/*        backgroundColor: `${theme.accent}1F`,*/}
                    {/*        borderRadius: 8,*/}
                    {/*        padding: 12,*/}
                    {/*        marginBottom: 12,*/}
                    {/*        borderWidth: 1,*/}
                    {/*        borderColor: `${theme.accent}40`,*/}
                    {/*    }}>*/}
                    {/*        <Text style={{ color: theme.textSecondary, fontSize: 13, textAlign: 'center' }}>*/}
                    {/*            Model selection is disabled after chat starts*/}
                    {/*        </Text>*/}
                    {/*    </View>*/}
                    {/*)}*/}

                    {/* Model Section */}
                    {/*<Pressable*/}
                    {/*    onPress={() => toggleSection('model')}*/}
                    {/*    style={{*/}
                    {/*        flexDirection: 'row',*/}
                    {/*        alignItems: 'center',*/}
                    {/*        justifyContent: 'space-between',*/}
                    {/*        paddingVertical: 12,*/}
                    {/*        borderBottomWidth: 1,*/}
                    {/*        borderBottomColor: theme.border,*/}
                    {/*    }}*/}
                    {/*>*/}
                    {/*    <Text style={{ fontSize: 16, fontWeight: '600', color: theme.textPrimary }}>*/}
                    {/*        Model*/}
                    {/*    </Text>*/}
                    {/*    {expandedSection === 'model' ? (*/}
                    {/*        <NavArrowDownSolid width={20} height={20} color={theme.textSecondary} />*/}
                    {/*    ) : (*/}
                    {/*        <NavArrowRightSolid width={20} height={20} color={theme.textSecondary} />*/}
                    {/*    )}*/}
                    {/*</Pressable>*/}

                    {/*{expandedSection === 'model' && (*/}
                    {/*    <View style={{ maxHeight: 250, marginTop: 8 }}>*/}
                    {/*        {loading ? (*/}
                    {/*            <View style={{ padding: 20, alignItems: 'center' }}>*/}
                    {/*                <ActivityIndicator size="large" color={theme.accent} />*/}
                    {/*            </View>*/}
                    {/*        ) : (*/}
                    {/*            <FlatList*/}
                    {/*                data={models}*/}
                    {/*                keyExtractor={(item) => item.id}*/}
                    {/*                renderItem={({ item }) => (*/}
                    {/*                    <Pressable*/}
                    {/*                        onPress={() => handleSelect(item.id)}*/}
                    {/*                        disabled={hasChatStarted}*/}
                    {/*                        style={({ pressed }) => ({*/}
                    {/*                            padding: 12,*/}
                    {/*                            borderRadius: 8,*/}
                    {/*                            marginBottom: 8,*/}
                    {/*                            backgroundColor:*/}
                    {/*                                item.id === selectedModel*/}
                    {/*                                    ? theme.accent + '20'*/}
                    {/*                                    : pressed*/}
                    {/*                                        ? theme.border*/}
                    {/*                                        : 'transparent',*/}
                    {/*                            borderWidth: 1,*/}
                    {/*                            borderColor:*/}
                    {/*                                item.id === selectedModel*/}
                    {/*                                    ? theme.accent*/}
                    {/*                                    : theme.border,*/}
                    {/*                            opacity: hasChatStarted ? 0.5 : 1,*/}
                    {/*                        })}*/}
                    {/*                    >*/}
                    {/*                        <Text*/}
                    {/*                            style={{*/}
                    {/*                                fontSize: 16,*/}
                    {/*                                fontWeight: item.id === selectedModel ? '600' : '400',*/}
                    {/*                                color: theme.text,*/}
                    {/*                                marginBottom: 4,*/}
                    {/*                            }}*/}
                    {/*                        >*/}
                    {/*                            {item.name}*/}
                    {/*                        </Text>*/}
                    {/*                        {item.description && (*/}
                    {/*                            <Text*/}
                    {/*                                style={{*/}
                    {/*                                    fontSize: 12,*/}
                    {/*                                    color: theme.textSecondary,*/}
                    {/*                                }}*/}
                    {/*                            >*/}
                    {/*                                {item.description}*/}
                    {/*                            </Text>*/}
                    {/*                        )}*/}
                    {/*                    </Pressable>*/}
                    {/*                )}*/}
                    {/*            />*/}
                    {/*        )}*/}
                    {/*    </View>*/}
                    {/*)}*/}

                    {/* Voice Language Section */}
                    <Pressable
                        onPress={() => toggleSection('language')}
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.border,
                            marginTop: 8,
                        }}
                    >
                        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.textPrimary }}>
                            Voice Language
                        </Text>
                        {expandedSection === 'language' ? (
                            <NavArrowDownSolid width={20} height={20} color={theme.textSecondary} />
                        ) : (
                            <NavArrowRightSolid width={20} height={20} color={theme.textSecondary} />
                        )}
                    </Pressable>

                    {expandedSection === 'language' && (
                        <View style={{ maxHeight: 250, marginTop: 8 }}>
                            <FlatList
                                data={VOICE_LANGUAGES}
                                keyExtractor={(item) => item.id}
                                renderItem={({ item }) => (
                                    <Pressable
                                        onPress={() => onSelectVoiceLanguage(item.id)}
                                        style={({ pressed }) => ({
                                            padding: 12,
                                            borderRadius: 8,
                                            marginBottom: 8,
                                            backgroundColor:
                                                item.id === voiceLanguage
                                                    ? theme.accent + '20'
                                                    : pressed
                                                        ? theme.border
                                                        : 'transparent',
                                            borderWidth: 1,
                                            borderColor:
                                                item.id === voiceLanguage
                                                    ? theme.accent
                                                    : theme.border,
                                        })}
                                    >
                                        <Text
                                            style={{
                                                fontSize: 16,
                                                fontWeight: item.id === voiceLanguage ? '600' : '400',
                                                color: theme.text,
                                            }}
                                        >
                                            {item.name}
                                        </Text>
                                    </Pressable>
                                )}
                            />
                        </View>
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
                            Close
                        </Text>
                    </Pressable>
                </Pressable>
            </Pressable>
        </Modal>
    );
}
