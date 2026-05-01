// front/src/services/location/locationService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

export type UserLocation = {
    lat: number;
    lon: number;
    displayName: string;
    fullAddress?: string;
    city: string;
    country: string;
    shareWithAgent: boolean;
};

export type NominatimResult = {
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
    address: {
        city?: string;
        town?: string;
        village?: string;
        country?: string;
    };
};

const LOCATION_KEY = 'user_location';
const LEGACY_KEY = 'weather_location';
const DEFAULT_LOCATION: UserLocation = {
    lat: 55.75,
    lon: 37.62,
    displayName: 'Moscow, Russia',
    city: 'Moscow',
    country: 'Russia',
    shareWithAgent: false,
};

export async function getStoredLocation(): Promise<UserLocation> {
    try {
        const raw = await AsyncStorage.getItem(LOCATION_KEY);
        if (raw) {
            return JSON.parse(raw) as UserLocation;
        }
        // Migrate from old weather_location key
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        if (legacy) {
            const old = JSON.parse(legacy) as { lat: number; lon: number };
            const migrated: UserLocation = {
                lat: old.lat,
                lon: old.lon,
                displayName: 'Current location',
                city: '',
                country: '',
                shareWithAgent: false,
            };
            await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(migrated));
            return migrated;
        }
    } catch {
        // corrupted storage — fall through to default
    }
    return DEFAULT_LOCATION;
}

export async function saveLocation(loc: UserLocation): Promise<void> {
    await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
}

export async function searchLocations(
    query: string,
): Promise<NominatimResult[]> {
    if (query.trim().length < 2) return [];
    const lang = 'ru';
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        query,
    )}&format=json&limit=5&addressdetails=1&accept-language=${lang}`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'GenieApp/1.0' },
        });
        if (!res.ok) return [];
        return res.json();
    } catch {
        return [];
    }
}

export function nominatimResultToLocation(
    result: NominatimResult,
    shareWithAgent: boolean,
): UserLocation {
    const addr = result.address;
    const city = addr.city ?? addr.town ?? addr.village ?? '';
    const country = addr.country ?? '';
    return {
        lat: parseFloat(result.lat),
        lon: parseFloat(result.lon),
        displayName: result.display_name
            .split(',')
            .slice(0, 2)
            .join(',')
            .trim(),
        fullAddress: result.display_name,
        city,
        country,
        shareWithAgent,
    };
}

export async function reverseGeocode(
    lat: number,
    lon: number,
): Promise<NominatimResult | null> {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=ru`;
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': 'GenieApp/1.0' },
        });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

export async function updateLocationFromGPS(): Promise<UserLocation | null> {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    try {
        const pos = await Location.getCurrentPositionAsync({});
        const { latitude, longitude } = pos.coords;
        const result = await reverseGeocode(latitude, longitude);
        if (!result) return null;
        const existing = await getStoredLocation();
        const updated = nominatimResultToLocation(
            result,
            existing.shareWithAgent,
        );
        await saveLocation(updated);
        return updated;
    } catch {
        return null;
    }
}
