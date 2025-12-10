
jest.mock('react-native-gesture-handler', () => {
  const View = require('react-native/Libraries/Components/View/View');
  return {
    Swipeable: View,
    DrawerLayoutAndroid: View,
    State: {},
    ScrollView: View,
    Slider: View,
    Switch: View,
    TextInput: View,
    ToolbarAndroid: View,
    ViewPagerAndroid: View,
    DrawerLayoutAndroid: View,
    WebView: View,
    NativeViewGestureHandler: View,
    TapGestureHandler: View,
    FlingGestureHandler: View,
    ForceTouchGestureHandler: View,
    LongPressGestureHandler: View,
    PanGestureHandler: View,
    PinchGestureHandler: View,
    RotationGestureHandler: View,
    /* Buttons */
    RawButton: View,
    BaseButton: View,
    RectButton: View,
    BorderlessButton: View,
    /* Other */
    FlatList: View,
    gestureHandlerRootHOC: jest.fn(),
    Directions: {},
    GestureHandlerRootView: View,
    GestureDetector: View,
    Gesture: {
        Pan: () => {
            return {
                maxPointers: jest.fn().mockReturnThis(),
                activeOffsetX: jest.fn().mockReturnThis(),
                failOffsetY: jest.fn().mockReturnThis(),
                onStart: jest.fn().mockReturnThis(),
                onUpdate: jest.fn().mockReturnThis(),
                onEnd: jest.fn().mockReturnThis(),
            }
        }
    }
  };
});

jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  return Reanimated;
});

jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

jest.mock('expo-file-system', () => ({
    documentDirectory: 'file:///tmp/',
    downloadAsync: jest.fn(),
    writeAsStringAsync: jest.fn(),
    EncodingType: { Base64: 'base64' },
}));

jest.mock('expo-sharing', () => ({
    isAvailableAsync: jest.fn(() => Promise.resolve(true)),
    shareAsync: jest.fn(),
}));

jest.mock('react-native-image-viewing', () => 'ImageViewing');

jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 }
  return {
    SafeAreaProvider: jest.fn().mockImplementation(({ children }) => children),
    SafeAreaConsumer: jest.fn().mockImplementation(({ children }) => children(inset)),
    useSafeAreaInsets: jest.fn().mockImplementation(() => inset),
  }
});

jest.mock('react-native-gifted-chat', () => ({
    GiftedChat: () => 'GiftedChat',
    Bubble: () => 'Bubble',
    Message: () => 'Message',
    MessageText: () => 'MessageText',
}));

jest.mock('react-native-markdown-display', () => 'Markdown');

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('@react-native-google-signin/google-signin', () => ({
    GoogleSignin: {
        configure: jest.fn(),
        hasPlayServices: jest.fn(),
        signIn: jest.fn(),
    }
}));
