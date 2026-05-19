import React from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../auth/context';
import { useMain } from '../main/context';
import { CalendarWidget } from './components/CalendarWidget';
import { WeatherWidget } from './components/WeatherWidget';
import { DateWidget } from './components/DateWidget';
import { RecentChatsWidget } from './components/RecentChatsWidget';
import { PlaceholderWidget } from './components/PlaceholderWidget';
import { TAB_BAR_ICON_HEIGHT } from '../../navigation/MainTabs';
import type { RootTabParamList } from '../../navigation/types';
import type { NavigationProp } from '@react-navigation/native';

function getGreeting(name?: string) {
    const hour = new Date().getHours();
    const base =
        hour < 12
            ? 'Good morning'
            : hour < 18
            ? 'Good afternoon'
            : 'Good evening';
    return name ? `${base}, ${name}!` : `${base}!`;
}

export const DashboardScreen = () => {
    const navigation = useNavigation<NavigationProp<RootTabParamList>>();
    const { theme } = useTheme();
    const { user } = useAuth();
    const { setActivePluginView } = useMain();
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                    styles.content,
                    { paddingTop: insets.top + 16, paddingBottom: TAB_BAR_ICON_HEIGHT + insets.bottom + 16 },
                ]}
                showsVerticalScrollIndicator={false}
            >
                {/* Greeting header */}
                <Text style={[styles.greeting, { color: theme.textPrimary }]}>
                    {getGreeting(user?.name)}
                </Text>

                {/* Row 1: Calendar | Date + Weather stacked */}
                <View style={styles.row}>
                    <CalendarWidget />
                    <View style={styles.column}>
                        <DateWidget />
                        <WeatherWidget />
                    </View>
                </View>

                {/* Plan My Day card */}
                {/*<TouchableOpacity
                    style={[styles.planCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
                    onPress={() => navigation.navigate('Planning')}
                    activeOpacity={0.8}
                >
                    <View style={[styles.planIconBg, { backgroundColor: theme.accent }]}>
                        <Ionicons name="sparkles" size={20} color="#fff" />
                    </View>
                    <View style={styles.planText}>
                        <Text style={[styles.planTitle, { color: theme.textPrimary }]}>Plan My Day</Text>
                        <Text style={[styles.planSubtitle, { color: theme.textSecondary }]}>
                            Let Nomi build your schedule
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </TouchableOpacity>*/}

                {/* Row 2: Recent Chats (full width) */}
                <RecentChatsWidget />

                {/* Row 3: Placeholder full */}
                <PlaceholderWidget size="full" />

                {/* Row 5: Two half placeholders */}
                <View style={styles.row}>
                    <PlaceholderWidget size="half" />
                    <PlaceholderWidget size="half" />
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scroll: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 24,
        gap: 8,
    },
    greeting: {
        fontSize: 28,
        fontWeight: '700',
        marginBottom: 4,
    },
    row: {
        flexDirection: 'row',
        gap: 8,
    },
    column: {
        flex: 1,
        gap: 8,
    },
    planCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
    },
    planIconBg: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    planText: {
        flex: 1,
        gap: 2,
    },
    planTitle: {
        fontSize: 15,
        fontWeight: '600',
    },
    planSubtitle: {
        fontSize: 12,
    },
});
