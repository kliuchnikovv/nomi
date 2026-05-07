module.exports = {
  preset: 'react-native',
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|react-native-reanimated|@react-navigation|iconoir-react-native|react-native-gesture-handler|react-native-iphone-x-helper|react-native-safe-area-context|@react-native-google-signin|react-native-markdown-display|react-native-inappbrowser-reborn|expo-modules-core|expo-file-system|expo-sharing|react-native-image-viewing|@expo/vector-icons|expo-font|expo-asset|expo-constants|expo-keep-awake|expo-web-browser|expo-linear-gradient|expo-sqlite|expo-task-manager|expo-background-fetch|expo-location|expo-network|expo-crypto)/)',
  ],
  moduleNameMapper: {
    'expo-sqlite': '<rootDir>/__mocks__/expo-sqlite.js',
    '^@genie/front/(.*)$': '<rootDir>/src/$1',
    '^@genie/plugin-gmail(.*)$': '<rootDir>/../plugins/gmail$1',
    '^@genie/plugin-calendar(.*)$': '<rootDir>/../plugins/calendar$1',
    '^@genie/plugin-github(.*)$': '<rootDir>/../plugins/github$1',
    '^@genie/plugin-telegram(.*)$': '<rootDir>/../plugins/telegram$1',
    '^@genie/plugin-ios_calendar(.*)$': '<rootDir>/../plugins/ios_calendar$1',
    '^@genie/plugin-ios_reminders(.*)$': '<rootDir>/../plugins/ios_reminders$1',
    '^@genie/plugin-ios_contacts(.*)$': '<rootDir>/../plugins/ios_contacts$1',
    '^@genie/plugin-ios_health(.*)$': '<rootDir>/../plugins/ios_health$1',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/types.ts',
  ],
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: {
    global: {
      lines: 5,
    },
  },
};
