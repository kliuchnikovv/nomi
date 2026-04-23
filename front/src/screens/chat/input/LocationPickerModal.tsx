import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { MapPin, XmarkCircle } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import {
    NominatimResult,
    UserLocation,
    getStoredLocation,
    nominatimResultToLocation,
    searchLocations,
    updateLocationFromGPS,
} from '../../../services/location/locationService';
import { contextStore } from '../../../services/ContextStore';

type Props = {
    visible: boolean;
    onClose: () => void;
};

export function LocationPickerModal({ visible, onClose }: Props) {
    const { theme } = useTheme();

    const [savedLocation, setSavedLocation] = useState<UserLocation | null>(null);
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<NominatimResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [gpsLoading, setGpsLoading] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);

    // Load saved location when modal opens
    useEffect(() => {
        if (visible) {
            getStoredLocation().then(loc => {
                if (isMountedRef.current) setSavedLocation(loc);
            }).catch(() => {});
        } else {
            setQuery('');
            setResults([]);
        }
    }, [visible]);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    const attachLocation = useCallback((title: string, lat: number | string, lon: number | string) => {
        contextStore.add({
            id: `location-${Date.now()}`,
            sourceType: 'location',
            title,
            metadata: { lat: Number(lat), lon: Number(lon) },
            addedAt: Date.now(),
        });
        onClose();
    }, [onClose]);

    const handleUseSaved = useCallback(() => {
        if (!savedLocation) return;
        attachLocation(savedLocation.displayName, savedLocation.lat, savedLocation.lon);
    }, [savedLocation, attachLocation]);

    const handleQueryChange = useCallback((text: string) => {
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
            setQuery(current => {
                if (current === capturedQuery) {
                    setResults(found);
                    setSearching(false);
                } else {
                    setSearching(false);
                }
                return current;
            });
        }, 400);
    }, []);

    const handleSelectResult = useCallback((result: NominatimResult) => {
        const loc = nominatimResultToLocation(result, false);
        attachLocation(loc.displayName, loc.lat, loc.lon);
    }, [attachLocation]);

    const handleGPS = useCallback(async () => {
        setGpsLoading(true);
        const loc = await updateLocationFromGPS();
        if (!isMountedRef.current) return;
        setGpsLoading(false);
        if (!loc) return;
        attachLocation(loc.displayName, loc.lat, loc.lon);
    }, [attachLocation]);

    const styles = useMemo(() => StyleSheet.create({
        overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
        sheet: {
            backgroundColor: theme.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 16,
            paddingHorizontal: 16,
            paddingBottom: 16,
            maxHeight: '85%',
        },
        handle: {
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.border,
            alignSelf: 'center',
            marginBottom: 16,
        },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
        },
        title: { fontSize: 18, fontWeight: '700', color: theme.textPrimary },
        sectionLabel: {
            fontSize: 11,
            fontWeight: '600',
            color: theme.fadedText,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 8,
        },
        savedCard: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.surface,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
            gap: 10,
            marginBottom: 20,
        },
        savedCardText: { flex: 1, color: theme.textPrimary, fontSize: 15 },
        savedCardHint: { fontSize: 12, color: theme.fadedText, marginTop: 1 },
        divider: {
            height: StyleSheet.hairlineWidth,
            backgroundColor: theme.border,
            marginBottom: 16,
        },
        input: {
            backgroundColor: theme.surface,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: theme.textPrimary,
            fontSize: 16,
            marginBottom: 8,
        },
        dropdown: {
            backgroundColor: theme.surface,
            borderRadius: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            marginBottom: 12,
            overflow: 'hidden',
        },
        resultItem: {
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: theme.border,
        },
        resultText: { color: theme.textPrimary, fontSize: 14 },
        gpsBtn: {
            backgroundColor: theme.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            borderRadius: 12,
            paddingVertical: 13,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 8,
            marginTop: 8,
        },
        gpsBtnText: { color: theme.textPrimary, fontWeight: '500', fontSize: 15 },
    }), [theme]);

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
                <Pressable style={styles.overlay} onPress={onClose}>
                    <Pressable style={styles.sheet} onPress={() => {}}>
                        <View style={styles.handle} />
                        <View style={styles.header}>
                            <Text style={styles.title}>Attach Location</Text>
                            <Pressable onPress={onClose} hitSlop={12}>
                                <XmarkCircle width={22} height={22} color={theme.textPrimary} />
                            </Pressable>
                        </View>

                        {/* My saved location */}
                        {savedLocation && (
                            <>
                                <Text style={styles.sectionLabel}>My Location</Text>
                                <Pressable style={styles.savedCard} onPress={handleUseSaved}>
                                    <MapPin width={20} height={20} color={theme.accent} />
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.savedCardText} numberOfLines={1}>
                                            {savedLocation.displayName}
                                        </Text>
                                        <Text style={styles.savedCardHint}>Tap to attach</Text>
                                    </View>
                                </Pressable>
                                <View style={styles.divider} />
                            </>
                        )}

                        {/* Search for a custom point */}
                        <Text style={styles.sectionLabel}>Search a Place</Text>
                        <TextInput
                            style={styles.input}
                            value={query}
                            onChangeText={handleQueryChange}
                            placeholder="Enter city, address..."
                            placeholderTextColor={theme.fadedText}
                            autoFocus={!savedLocation}
                        />

                        {searching && (
                            <ActivityIndicator size="small" color={theme.textPrimary} style={{ marginBottom: 8 }} />
                        )}

                        {results.length > 0 && (
                            <View style={styles.dropdown}>
                                <FlatList
                                    data={results}
                                    keyExtractor={item => String(item.place_id)}
                                    renderItem={({ item }) => (
                                        <Pressable style={styles.resultItem} onPress={() => handleSelectResult(item)}>
                                            <Text style={styles.resultText} numberOfLines={2}>
                                                {item.display_name}
                                            </Text>
                                        </Pressable>
                                    )}
                                    keyboardShouldPersistTaps="handled"
                                />
                            </View>
                        )}

                        <Pressable onPress={handleGPS} disabled={gpsLoading} style={styles.gpsBtn}>
                            {gpsLoading
                                ? <ActivityIndicator size="small" color={theme.textPrimary} />
                                : (
                                    <>
                                        <MapPin width={18} height={18} color={theme.textPrimary} />
                                        <Text style={styles.gpsBtnText}>Use current GPS location</Text>
                                    </>
                                )
                            }
                        </Pressable>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}
