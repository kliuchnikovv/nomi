module.exports = {
  preset: 'react-native',
  setupFiles: ['./__tests__/setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|@react-navigation|expo-modules-core|expo-file-system|expo-sharing|react-native-image-viewing)',
  ],
};
