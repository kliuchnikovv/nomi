const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('metro-config');
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
            '@nomi/front': path.resolve(__dirname, 'src'),
            '@nomi/ds': path.resolve(__dirname, '../packages/ds/src'),
            '@nomi/plugin-gmail': path.resolve(__dirname, '../plugins/gmail'),
            '@nomi/plugin-calendar': path.resolve(
                __dirname,
                '../plugins/calendar',
            ),
            '@nomi/plugin-github': path.resolve(
                __dirname,
                '../plugins/github',
            ),
            '@nomi/plugin-telegram': path.resolve(
                __dirname,
                '../plugins/telegram',
            ),
            '@nomi/plugin-ios_calendar': path.resolve(
                __dirname,
                '../plugins/ios_calendar',
            ),
            '@nomi/plugin-ios_reminders': path.resolve(
                __dirname,
                '../plugins/ios_reminders',
            ),
            '@nomi/plugin-ios_contacts': path.resolve(
                __dirname,
                '../plugins/ios_contacts',
            ),
            '@nomi/plugin-ios_health': path.resolve(
                __dirname,
                '../plugins/ios_health',
            ),
        },
        // Support for TypeScript path aliases
        alias: {
            '@nomi/front': path.resolve(__dirname, 'src'),
            '@nomi/ds': path.resolve(__dirname, '../packages/ds/src'),
            '@nomi/ds/*': path.resolve(__dirname, '../packages/ds/src/*'),
            '@nomi/plugin-gmail': path.resolve(__dirname, '../plugins/gmail'),
            '@nomi/plugin-gmail/*': path.resolve(
                __dirname,
                '../plugins/gmail/*',
            ),
            '@nomi/plugin-calendar': path.resolve(
                __dirname,
                '../plugins/calendar',
            ),
            '@nomi/plugin-calendar/*': path.resolve(
                __dirname,
                '../plugins/calendar/*',
            ),
            '@nomi/plugin-github': path.resolve(
                __dirname,
                '../plugins/github',
            ),
            '@nomi/plugin-github/*': path.resolve(
                __dirname,
                '../plugins/github/*',
            ),
            '@nomi/plugin-telegram': path.resolve(
                __dirname,
                '../plugins/telegram',
            ),
            '@nomi/plugin-telegram/*': path.resolve(
                __dirname,
                '../plugins/telegram/*',
            ),
            '@nomi/plugin-ios_calendar': path.resolve(
                __dirname,
                '../plugins/ios_calendar',
            ),
            '@nomi/plugin-ios_calendar/*': path.resolve(
                __dirname,
                '../plugins/ios_calendar/*',
            ),
            '@nomi/plugin-ios_reminders': path.resolve(
                __dirname,
                '../plugins/ios_reminders',
            ),
            '@nomi/plugin-ios_reminders/*': path.resolve(
                __dirname,
                '../plugins/ios_reminders/*',
            ),
            '@nomi/plugin-ios_contacts': path.resolve(
                __dirname,
                '../plugins/ios_contacts',
            ),
            '@nomi/plugin-ios_contacts/*': path.resolve(
                __dirname,
                '../plugins/ios_contacts/*',
            ),
            '@nomi/plugin-ios_health': path.resolve(
                __dirname,
                '../plugins/ios_health',
            ),
            '@nomi/plugin-ios_health/*': path.resolve(
                __dirname,
                '../plugins/ios_health/*',
            ),
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
