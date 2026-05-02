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
    TouchableOpacity,
    View,
} from 'react-native';
import { MapPin, XmarkCircle } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import {
    NominatimResult,
    nominatimResultToLocation,
    searchLocations,
    updateLocationFromGPS,
} from '../../../services/location/locationService';

interface Props {
    visible: boolean;
    onClose: () => void;
    onSelect: (locationName: string) => void;
}

export function PlanLocationPickerModal({ visible, onClose, onSelect }: Props) {
    const { theme } = useTheme();

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<NominatimResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [gpsLoading, setGpsLoading] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
        if (!visible) {
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

    const handleSelect = useCallback((name: string) => {
        onSelect(name);
        onClose();
    }, [onSelect, onClose]);

    const handleQueryChange = useCallback((text: string) => {
        setQuery(text);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (text.trim().length < 2) {
            setResults([]);
            return;
        }
        const captured = text;
        debounceRef.current = setTimeout(async () => {
            setSearching(true);
            const found = await searchLocations(captured);
            if (!isMountedRef.current) return;
            setQuery(current => {
                if (current === captured) {
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
        handleSelect(loc.displayName);
    }, [handleSelect]);

    const handleGPS = useCallback(async () => {
        setGpsLoading(true);
        const loc = await updateLocationFromGPS();
        if (!isMountedRef.current) return;
        setGpsLoading(false);
        if (!loc) return;
        handleSelect(loc.displayName);
    }, [handleSelect]);

    const styles = useMemo(() => StyleSheet.create({
        overlay: {
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'flex-end',
        },
        sheet: {
            backgroundColor: theme.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingTop: 16,
            paddingHorizontal: 16,
            paddingBottom: 24,
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
            marginBottom: 16,
        },
        title: {
            fontSize: 18,
            fontWeight: '700',
            color: theme.textPrimary,
        },
        input: {
            backgroundColor: (theme as any).surface ?? theme.background,
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
            backgroundColor: (theme as any).surface ?? theme.background,
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
        resultText: {
            color: theme.textPrimary,
            fontSize: 14,
        },
        gpsBtn: {
            backgroundColor: (theme as any).surface ?? theme.background,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            borderRadius: 12,
            paddingVertical: 13,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 8,
            marginTop: 4,
        },
        gpsBtnText: {
            color: theme.textPrimary,
            fontWeight: '500',
            fontSize: 15,
        },
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
                            <Text style={styles.title}>Add Location</Text>
                            <Pressable onPress={onClose} hitSlop={12}>
                                <XmarkCircle width={22} height={22} color={theme.textPrimary} />
                            </Pressable>
                        </View>

                        <TextInput
                            style={styles.input}
                            value={query}
                            onChangeText={handleQueryChange}
                            placeholder="Search address or place…"
                            placeholderTextColor={theme.textSecondary}
                            autoFocus
                        />

                        {searching && (
                            <ActivityIndicator
                                size="small"
                                color={theme.textPrimary}
                                style={{ marginBottom: 8 }}
                            />
                        )}

                        {results.length > 0 && (
                            <View style={styles.dropdown}>
                                <FlatList
                                    data={results}
                                    keyExtractor={(item: NominatimResult) => String(item.place_id)}
                                    renderItem={({ item }: { item: NominatimResult }) => (
                                        <TouchableOpacity
                                            style={styles.resultItem}
                                            onPress={() => handleSelectResult(item)}
                                            activeOpacity={0.7}
                                        >
                                            <Text style={styles.resultText} numberOfLines={2}>
                                                {item.display_name}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                    keyboardShouldPersistTaps="handled"
                                />
                            </View>
                        )}

                        <TouchableOpacity
                            onPress={handleGPS}
                            disabled={gpsLoading}
                            style={styles.gpsBtn}
                            activeOpacity={0.7}
                        >
                            {gpsLoading ? (
                                <ActivityIndicator size="small" color={theme.textPrimary} />
                            ) : (
                                <>
                                    <MapPin width={18} height={18} color={theme.textPrimary} />
                                    <Text style={styles.gpsBtnText}>Use current GPS location</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </Pressable>
                </Pressable>
            </KeyboardAvoidingView>
        </Modal>
    );
}
