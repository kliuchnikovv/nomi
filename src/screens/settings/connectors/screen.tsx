import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Switch,
    Text,
    View,
} from 'react-native';
import { styles } from './styles.tsx';
import React from 'react';
import { Props, CONNECTORS } from './models.tsx';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NavArrowRight } from 'iconoir-react-native';
import { useConnectors } from './context.tsx';
import { oneDarkPalette } from '../../../themes/oneDark.ts';


export default function ConnectorScreenDialog({ onClose }: Props) {
    const { integrations } = useConnectors()

    // Получаем enabled tools и disabled tools отдельно
    const enabledTools = integrations.filter(t => t.connected);
    const disabledTools = integrations.filter(t => !t.connected);

    const getConnectorDetails = (provider: string) => {
        return CONNECTORS.find(c => c.oauthProvider.toLowerCase() === provider.toLowerCase());
    };

    return (
        <View style={styles.overlay} pointerEvents="box-none">
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={styles.sheet}>
                <Text style={styles.dialogTitle}>Apps & connectors</Text>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {enabledTools.length > 0 && (
                        <>
                            <Text style={styles.sectionTitle}>Включено</Text>
                            <View style={styles.card}>
                                {enabledTools.map((integration, i) => {
                                    const details = getConnectorDetails(integration.provider);
                                    return (
                                        <View key={integration.id}>
                                            <Item
                                                name={integration.name}
                                                enabled={true}
                                                glyph={details?.glyph || 'application'}
                                                color={details?.color || oneDarkPalette.blue}
                                                configID={integration.id}
                                            />
                                            {i < enabledTools.length - 1 && (
                                                <View style={styles.divider} />
                                            )}
                                        </View>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {disabledTools.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { marginTop: (enabledTools.length > 0 || disabledTools.length > 0) ? 16 : 0 }]}>
                                Доступные интеграции
                            </Text>
                            <View style={styles.card}>
                                {disabledTools.map((integration, i) => {
                                    const details = getConnectorDetails(integration.provider);
                                    return (
                                        <View key={integration.id}>
                                            <Item
                                                name={integration.name}
                                                enabled={false}
                                                glyph={details?.glyph || 'application'}
                                                color={details?.color || oneDarkPalette.blue}
                                                configID={integration.id}
                                            />
                                            {i < disabledTools.length - 1 && (
                                                <View style={styles.divider} />
                                            )}
                                        </View>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {enabledTools.length === 0 && disabledTools.length === 0 && (
                        <View style={styles.emptyRow}>
                            <Text style={styles.emptyText}>
                                Нет доступных интеграций
                            </Text>
                        </View>
                    )}
                </ScrollView>
            </View>
        </View>
    );
}


const Item = ({ name, enabled, color, glyph, configID }: {
    name: string;
    enabled: boolean;
    glyph: string;
    color: string;
    configID: string;
}) => {
    const { toggleTool } = useConnectors()
    const [isLoading, setIsLoading] = React.useState(false);

    const handleToggle = async (newValue: boolean) => {
        if (isLoading) return;

        setIsLoading(true);
        try {
            await toggleTool(configID, newValue);
        } catch (error) {
            console.error('Failed to toggle tool', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View style={styles.row}>
            <View style={[styles.iconBubble, { backgroundColor: color }]}>
                <Icon name={glyph} size={20} color="#fff" />
            </View>
            <View style={styles.titleBlock}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                    {name}
                </Text>
            </View>
            <View style={styles.switchWrap}>
                {isLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                ) : (
                    <Switch
                        value={enabled}
                        onValueChange={handleToggle}
                        trackColor={{
                            true: '#61afef',
                            false: 'rgba(171, 178, 191, 0.3)',
                        }}
                        thumbColor="#fff"
                    />
                )}
            </View>
            <NavArrowRight
                width={22}
                height={22}
                color={'rgba(171, 178, 191, 0.8)'}
            />
        </View>
    );
};