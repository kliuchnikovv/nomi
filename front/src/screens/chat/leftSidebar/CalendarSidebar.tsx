import React, { useEffect, useState } from 'react';
import { View, Text, SectionList, Pressable, Linking } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { calendarClient } from '../../../services/integrations/clients/CalendarClient';
import { ExtractedEvent, Integration } from '../../../services/integrations/IntegrationStorage';
import { Calendar, Plus } from 'iconoir-react-native';

interface CalendarSidebarProps {
    integration: Integration;
    scrollEnabled?: boolean;
}

export function CalendarSidebar({ integration, scrollEnabled = true }: CalendarSidebarProps) {
    const { theme, palette } = useTheme();
    const [events, setEvents] = useState<ExtractedEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const loadEvents = async () => {
        try {
            setLoading(true);
            const data = await calendarClient.getUpcomingEvents(integration.id);
            setEvents(data);
        } catch (error) {
            console.error('Failed to load calendar events:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadEvents();
    }, [integration.id]);

    const groupEventsByDate = (events: ExtractedEvent[]) => {
        const groups: Record<string, ExtractedEvent[]> = {};
        events.forEach(event => {
            const dateStr = event.startDate.toDateString();
            if (!groups[dateStr]) {
                groups[dateStr] = [];
            }
            groups[dateStr].push(event);
        });

        return Object.entries(groups).map(([date, data]) => ({
            title: date,
            data
        }));
    };

    const sections = groupEventsByDate(events);

    const handleCreateEvent = () => {
        // Open Google Calendar in browser to create event
        Linking.openURL('https://calendar.google.com/calendar/r/eventedit');
    };

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 16,
                borderBottomWidth: 1,
                borderBottomColor: theme.border
            }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Calendar width={20} height={20} color={palette.orange} />
                    <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Calendar</Text>
                </View>
                <Pressable onPress={handleCreateEvent}>
                    <Plus width={20} height={20} color={theme.text} />
                </Pressable>
            </View>

            <SectionList
                sections={sections}
                scrollEnabled={scrollEnabled}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                renderSectionHeader={({ section: { title } }) => {
                    const date = new Date(title);
                    const isToday = new Date().toDateString() === title;
                    const displayTitle = isToday
                        ? 'Today'
                        : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

                    return (
                        <View style={{ backgroundColor: theme.background, paddingVertical: 8 }}>
                            <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' }}>
                                {displayTitle}
                            </Text>
                        </View>
                    );
                }}
                renderItem={({ item }) => {
                    const startTime = item.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const endTime = item.endDate?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                    return (
                        <View style={{
                            marginBottom: 12,
                            padding: 12,
                            backgroundColor: theme.card,
                            borderRadius: 8,
                            borderLeftWidth: 3,
                            borderLeftColor: palette.orange
                        }}>
                            <Text style={{ color: theme.text, fontWeight: '600', fontSize: 14 }}>{item.title}</Text>
                            <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 4 }}>
                                {startTime} - {endTime}
                            </Text>
                            {item.location && (
                                <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>
                                    📍 {item.location}
                                </Text>
                            )}
                        </View>
                    );
                }}
                ListEmptyComponent={
                    !loading ? (
                        <Text style={{ color: theme.textSecondary, textAlign: 'center', marginTop: 20 }}>
                            No upcoming events
                        </Text>
                    ) : null
                }
            />
        </View>
    );
}
