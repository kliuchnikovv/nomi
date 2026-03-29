import React from 'react';
import { View } from 'react-native';
import SettingsModal from '../settings/screen';

export function SettingsTabScreen() {
    return (
        <View style={{ flex: 1 }}>
            <SettingsModal visible={true} onClose={() => {}} renderAsScreen={true} />
        </View>
    );
}
