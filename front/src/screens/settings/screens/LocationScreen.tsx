// front/src/screens/settings/screens/LocationScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { NavArrowLeft, MapPin } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { SettingsStackParamList } from '../../../navigation/types';
import {
    UserLocation,
    NominatimResult,
    getStoredLocation,
    saveLocation,
    searchLocations,
    nominatimResultToLocation,
    updateLocationFromGPS,
} from '../../../services/location/locationService';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'LocationScreen'>;

export function LocationScreen() {
    const navigation = useNavigation<Nav>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    const [location, setLocation] = useState<UserLocation | null>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<NominatimResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [gpsLoading, setGpsLoading] = useState(false);
    const isMountedRef = useRef(true);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        getStoredLocation().then(setLocation);
    }, []);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    const handleQueryChange = (text: string) => {
        setQuery(text);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (text.trim().length < 2) {
            setResults([]);
            return;
        }
        const capturedQuery = text;
        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            const found = await searchLocations(capturedQuery);
            // Discard results if query changed while request was in-flight
            setQuery(current => {
                if (current === capturedQuery) {
                    setResults(found);
                    setSearching(false);
                } else {
                    setSearching(false);
                }
                return current;
            });
        }, 300);
    };

    const handleSelectResult = async (result: NominatimResult) => {
        try {
            const share = location?.shareWithAgent ?? false;
            const updated = nominatimResultToLocation(result, share);
            await saveLocation(updated);
            setLocation(updated);
            setQuery('');
            setResults([]);
        } catch {
            // storage failure — silently ignore, state is unchanged
        }
    };

    const handleGPS = async () => {
        setGpsLoading(true);
        const updated = await updateLocationFromGPS();
        if (!isMountedRef.current) return;
        if (updated) setLocation(updated);
        setGpsLoading(false);
    };

    const handleToggleShare = async (value: boolean) => {
        if (!location) return;
        try {
            const updated = { ...location, shareWithAgent: value };
            await saveLocation(updated);
            setLocation(updated);
        } catch {
            // storage failure — silently ignore
        }
    };

    const styles = useMemo(() => StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.background },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingBottom: 12,
            gap: 8,
        },
        backBtn: { padding: 4 },
        title: { fontSize: 24, fontWeight: '700', color: theme.textPrimary },
        body: { paddingHorizontal: 16, paddingTop: 24 },
        sectionLabel: { fontSize: 13, color: theme.fadedText, marginBottom: 8, textTransform: 'uppercase' },
        searchRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
        input: {
            flex: 1,
            backgroundColor: theme.surface,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: theme.textPrimary,
            fontSize: 16,
        },
        clearBtn: {
            backgroundColor: theme.surface,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            paddingHorizontal: 14,
            justifyContent: 'center',
        },
        clearBtnText: { color: theme.textPrimary, fontSize: 16 },
        dropdown: {
            backgroundColor: theme.surface,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            marginBottom: 16,
            overflow: 'hidden',
        },
        resultItem: {
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.border,
        },
        resultText: { color: theme.textPrimary, fontSize: 14 },
        savedCard: {
            backgroundColor: theme.surface,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            padding: 14,
            marginBottom: 16,
        },
        savedLabel: { fontSize: 12, color: theme.fadedText, marginBottom: 4 },
        savedValue: { fontSize: 16, fontWeight: '600', color: theme.textPrimary },
        gpsBtn: {
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 32,
        },
        gpsBtnText: { color: theme.textPrimary, fontWeight: '500', fontSize: 16 },
        toggleRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: theme.surface,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            padding: 14,
            marginBottom: 8,
        },
        toggleLabel: { fontSize: 16, color: theme.textPrimary, flex: 1 },
        toggleHint: { fontSize: 12, color: theme.fadedText, marginTop: 4 },
    }), [theme]);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <NavArrowLeft width={24} height={24} color={theme.textPrimary} />
                </Pressable>
                <Text style={styles.title}>Location</Text>
            </View>

            <View style={styles.body}>
                <Text style={styles.sectionLabel}>City Search</Text>
                <View style={styles.searchRow}>
                    <TextInput
                        style={styles.input}
                        value={query}
                        onChangeText={handleQueryChange}
                        placeholder="Enter city name..."
                        placeholderTextColor={theme.fadedText}
                    />
                    {query.length > 0 && (
                        <Pressable style={styles.clearBtn} onPress={() => { setQuery(''); setResults([]); }}>
                            <Text style={styles.clearBtnText}>✕</Text>
                        </Pressable>
                    )}
                </View>

                {searching && <ActivityIndicator size="small" color={theme.textPrimary} style={{ marginBottom: 8 }} />}

                {results.length > 0 && (
                    <View style={styles.dropdown}>
                        <FlatList
                            data={results}
                            keyExtractor={(item) => String(item.place_id)}
                            renderItem={({ item }) => (
                                <Pressable style={styles.resultItem} onPress={() => handleSelectResult(item)}>
                                    <Text style={styles.resultText} numberOfLines={1}>
                                        {item.display_name}
                                    </Text>
                                </Pressable>
                            )}
                            scrollEnabled={false}
                        />
                    </View>
                )}

                {location && (
                    <View style={styles.savedCard}>
                        <Text style={styles.savedLabel}>Saved</Text>
                        <Text style={styles.savedValue}>{location.displayName}</Text>
                    </View>
                )}

                <Pressable onPress={handleGPS} disabled={gpsLoading} style={styles.gpsBtn}>
                    {gpsLoading
                        ? <ActivityIndicator size="small" color={theme.textPrimary} />
                        : <><MapPin width={20} height={20} color={theme.textPrimary} /><Text style={styles.gpsBtnText}>Detect via GPS</Text></>
                    }
                </Pressable>

                <Text style={styles.sectionLabel}>Agent</Text>
                <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>Share location with agent</Text>
                    <Switch
                        value={location?.shareWithAgent ?? false}
                        onValueChange={handleToggleShare}
                        trackColor={{ true: theme.accent }}
                    />
                </View>
                {location?.shareWithAgent && (
                    <Text style={styles.toggleHint}>
                        Agent will know: {location.displayName}
                    </Text>
                )}
            </View>
        </View>
    );
}
