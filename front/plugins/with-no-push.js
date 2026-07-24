// Local Expo config plugin that strips iOS Push Notifications capability from
// the generated project so the app can be signed by a free ("Personal Team")
// Apple ID. Paid teams add the capability back by removing this plugin.
//
// Uses withDangerousMod for the entitlements strip because expo-notifications
// writes aps-environment via a late-phase mod that runs AFTER typed
// withEntitlementsPlist mods — withDangerousMod is the last stage, so this
// wins.
const path = require('path');
const fs = require('fs');
const { withInfoPlist, withDangerousMod } = require('@expo/config-plugins');

module.exports = function withNoPush(config) {
    config = withInfoPlist(config, cfg => {
        const modes = cfg.modResults.UIBackgroundModes;
        if (Array.isArray(modes)) {
            cfg.modResults.UIBackgroundModes = modes.filter(
                m => m !== 'remote-notification',
            );
        }
        return cfg;
    });

    config = withDangerousMod(config, [
        'ios',
        cfg => {
            const projectName =
                cfg.modRequest.projectName ||
                path.basename(cfg.modRequest.projectRoot);
            const entitlementsPath = path.join(
                cfg.modRequest.platformProjectRoot,
                projectName,
                `${projectName}.entitlements`,
            );
            if (fs.existsSync(entitlementsPath)) {
                let contents = fs.readFileSync(entitlementsPath, 'utf8');
                contents = contents.replace(
                    /\s*<key>aps-environment<\/key>\s*<string>[^<]*<\/string>/,
                    '',
                );
                fs.writeFileSync(entitlementsPath, contents);
            }
            return cfg;
        },
    ]);

    return config;
};
