const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration for monorepo workspace
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Watch the plugins directory for changes
  watchFolders: [
    path.resolve(__dirname, '..'), // Root of monorepo
    path.resolve(__dirname, '../plugins'), // Plugins directory
  ],
  
  // Resolver configuration
  resolver: {
    // Add extra node modules paths for resolution
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../node_modules'),
    ],
    // Ensure we resolve workspace packages
    extraNodeModules: {
      '@genie/front': path.resolve(__dirname, 'src'),
      '@genie/plugin-gmail': path.resolve(__dirname, '../plugins/gmail'),
      '@genie/plugin-calendar': path.resolve(__dirname, '../plugins/calendar'),
      '@genie/plugin-github': path.resolve(__dirname, '../plugins/github'),
      '@genie/plugin-telegram': path.resolve(__dirname, '../plugins/telegram'),
      '@genie/plugin-ios_calendar': path.resolve(__dirname, '../plugins/ios_calendar'),
      '@genie/plugin-ios_reminders': path.resolve(__dirname, '../plugins/ios_reminders'),
      '@genie/plugin-ios_contacts': path.resolve(__dirname, '../plugins/ios_contacts'),
      '@genie/plugin-ios_health': path.resolve(__dirname, '../plugins/ios_health'),
    },
    // Support for TypeScript path aliases
    alias: {
      '@genie/front': path.resolve(__dirname, 'src'),
      '@genie/plugin-gmail': path.resolve(__dirname, '../plugins/gmail'),
      '@genie/plugin-gmail/*': path.resolve(__dirname, '../plugins/gmail/*'),
      '@genie/plugin-calendar': path.resolve(__dirname, '../plugins/calendar'),
      '@genie/plugin-calendar/*': path.resolve(__dirname, '../plugins/calendar/*'),
      '@genie/plugin-github': path.resolve(__dirname, '../plugins/github'),
      '@genie/plugin-github/*': path.resolve(__dirname, '../plugins/github/*'),
      '@genie/plugin-telegram': path.resolve(__dirname, '../plugins/telegram'),
      '@genie/plugin-telegram/*': path.resolve(__dirname, '../plugins/telegram/*'),
      '@genie/plugin-ios_calendar': path.resolve(__dirname, '../plugins/ios_calendar'),
      '@genie/plugin-ios_calendar/*': path.resolve(__dirname, '../plugins/ios_calendar/*'),
      '@genie/plugin-ios_reminders': path.resolve(__dirname, '../plugins/ios_reminders'),
      '@genie/plugin-ios_reminders/*': path.resolve(__dirname, '../plugins/ios_reminders/*'),
      '@genie/plugin-ios_contacts': path.resolve(__dirname, '../plugins/ios_contacts'),
      '@genie/plugin-ios_contacts/*': path.resolve(__dirname, '../plugins/ios_contacts/*'),
      '@genie/plugin-ios_health': path.resolve(__dirname, '../plugins/ios_health'),
      '@genie/plugin-ios_health/*': path.resolve(__dirname, '../plugins/ios_health/*'),
    },
  },
  
  // Transformer configuration
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
