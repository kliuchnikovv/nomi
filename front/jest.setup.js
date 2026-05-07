import 'react-native-gesture-handler/jestSetup';

// @react-navigation/native's NavigationContainer calls window.dispatchEvent to
// broadcast navigation state changes. The react-native Jest environment doesn't
// provide a real DOM, so we stub it to prevent worker crashes.
if (typeof window !== 'undefined' && typeof window.dispatchEvent !== 'function') {
    window.dispatchEvent = () => true;
}

jest.mock('react-native-reanimated', () => {
    const Reanimated = require('react-native-reanimated/mock');

    // The mock for `call` immediately calls the callback which is incorrect
    // So we override it with a no-op
    Reanimated.default.call = () => { };

    return Reanimated;
});

// Silence the warning: Animated: `useNativeDriver` is not supported because the native animated module is missing
// jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');

jest.mock('react-native-image-viewing', () => 'ImageViewing');
jest.mock('react-native-gifted-chat', () => ({
    GiftedChat: () => 'GiftedChat',
}));
jest.mock('expo-file-system', () => ({
    makeDirectoryAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
    readAsStringAsync: jest.fn(),
    deleteAsync: jest.fn(),
    getInfoAsync: jest.fn(),
    downloadAsync: jest.fn(),
    cacheDirectory: 'file:///cache/',
}));
jest.mock('expo-sharing', () => ({
    shareAsync: jest.fn(),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
    setString: jest.fn(),
    getString: jest.fn(),
    hasString: jest.fn(),
    getImage: jest.fn(),
    setImage: jest.fn(),
    getImagePNG: jest.fn(),
    getImageJPG: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
    const React = require('react');
    const insets = { top: 0, bottom: 0, left: 0, right: 0 };
    const frame = { x: 0, y: 0, width: 375, height: 812 };
    const SafeAreaInsetsContext = React.createContext(insets);
    const SafeAreaFrameContext = React.createContext(frame);
    return {
        SafeAreaProvider: ({ children }) => children,
        SafeAreaView: ({ children }) => children,
        SafeAreaInsetsContext,
        SafeAreaFrameContext,
        useSafeAreaInsets: () => insets,
        useSafeAreaFrame: () => frame,
        initialWindowMetrics: { insets, frame },
    };
});

jest.mock('react-native-image-picker', () => ({
    launchImageLibrary: jest.fn(),
    launchCamera: jest.fn(),
}));

jest.mock('react-native-document-picker', () => ({
    pick: jest.fn(),
    types: {
        allFiles: 'allFiles',
    },
}));

jest.mock('react-native-permissions', () => ({
    check: jest.fn(),
    request: jest.fn(),
    PERMISSIONS: {
        IOS: {
            CAMERA: 'ios.permission.CAMERA',
            MICROPHONE: 'ios.permission.MICROPHONE',
        },
        ANDROID: {
            CAMERA: 'android.permission.CAMERA',
            RECORD_AUDIO: 'android.permission.RECORD_AUDIO',
        },
    },
    RESULTS: {
        GRANTED: 'granted',
    },
}));

jest.mock('react-native-blob-util', () => ({
    fs: {
        dirs: {
            CacheDir: 'cache',
        },
        writeFile: jest.fn(),
        readFile: jest.fn(),
    },
}));

jest.mock('react-native-audio-recorder-player', () => {
    return {
        AudioRecorderPlayer: jest.fn().mockImplementation(() => {
            return {
                startRecorder: jest.fn(),
                stopRecorder: jest.fn(),
                addRecordBackListener: jest.fn(),
                removeRecordBackListener: jest.fn(),
            };
        }),
    };
});

jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@react-native-google-signin/google-signin', () => ({
    GoogleSignin: {
        configure: jest.fn(),
        hasPlayServices: jest.fn(),
        signIn: jest.fn(),
        signOut: jest.fn(),
        isSignedIn: jest.fn(),
        getCurrentUser: jest.fn(),
    },
}));

jest.mock('@react-native-voice/voice', () => ({
    destroy: jest.fn(),
    removeAllListeners: jest.fn(),
    onSpeechStart: jest.fn(),
    onSpeechEnd: jest.fn(),
    onSpeechResults: jest.fn(),
    onSpeechError: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
}));

jest.mock('react-native-keyboard-controller', () => ({
    KeyboardProvider: ({ children }) => children,
    useKeyboardHandler: jest.fn(),
    useKeyboardController: jest.fn(),
}));

jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');
jest.mock('react-native-markdown-display', () => 'Markdown');

jest.mock('@gorhom/bottom-sheet', () => {
    const React = require('react');
    const BottomSheetFlatList = ({ data, renderItem }) =>
        data ? data.map((item, i) => renderItem({ item, index: i })) : null;
    const BottomSheet = ({ children }) => children || null;
    BottomSheet.displayName = 'BottomSheet';
    return { __esModule: true, default: BottomSheet, BottomSheetFlatList, BottomSheetScrollView: ({ children }) => children };
});

jest.mock('iconoir-react-native', () => {
    const React = require('react');
    const stub = (name) => (props) => React.createElement('View', { testID: name, ...props });
    return new Proxy({}, { get: (_, name) => stub(String(name)) });
});

jest.mock('@expo/vector-icons', () => {
    const React = require('react');
    const mockIcon = ({ name, ...props }) => React.createElement('View', props);
    return new Proxy({}, {
        get: () => mockIcon,
    });
});

jest.mock('expo-secure-store', () => ({
    setItemAsync: jest.fn(() => Promise.resolve()),
    getItemAsync: jest.fn(() => Promise.resolve(null)),
    deleteItemAsync: jest.fn(() => Promise.resolve()),
    AFTER_FIRST_UNLOCK: 'AfterFirstUnlock',
}));

jest.mock('expo-task-manager', () => ({
    defineTask: jest.fn(),
    isTaskRegisteredAsync: jest.fn(() => Promise.resolve(false)),
    getRegisteredTasksAsync: jest.fn(() => Promise.resolve([])),
    unregisterTaskAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('./src/plugins/registerClientPlugins', () => ({
    registerClientPlugins: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-background-fetch', () => ({
    registerTaskAsync: jest.fn(() => Promise.resolve()),
    unregisterTaskAsync: jest.fn(() => Promise.resolve()),
    getStatusAsync: jest.fn(() => Promise.resolve(1)),
    BackgroundFetchResult: { NewData: 1, NoData: 2, Failed: 3 },
    BackgroundFetchStatus: { Restricted: 1, Denied: 2, Available: 3 },
}));

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
    getCurrentPositionAsync: jest.fn(() => Promise.resolve({
        coords: { latitude: 0, longitude: 0, accuracy: 0 },
    })),
    Accuracy: { Balanced: 3 },
}));

jest.mock('expo-network', () => ({
    getNetworkStateAsync: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
    NetworkStateType: { CELLULAR: 1, WIFI: 2, NONE: 0 },
}));

jest.mock('expo-crypto', () => ({
    randomUUID: jest.fn(() => '00000000-0000-0000-0000-000000000000'),
    digestStringAsync: jest.fn(() => Promise.resolve('mock-hash')),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

jest.mock('@react-native-community/netinfo', () => ({
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
    useNetInfo: jest.fn(() => ({ isConnected: true })),
}));
