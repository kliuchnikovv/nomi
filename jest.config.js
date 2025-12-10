module.exports = {
  preset: 'react-native',
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-reanimated|@react-navigation|iconoir-react-native|react-native-gesture-handler|react-native-iphone-x-helper|react-native-safe-area-context|@react-native-google-signin|react-native-markdown-display|react-native-inappbrowser-reborn)/)',
  ],
};
