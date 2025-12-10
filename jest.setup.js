import 'react-native-gesture-handler/jestSetup';

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

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
}));

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
