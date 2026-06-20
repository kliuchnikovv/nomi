import React from 'react';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import type { ChatStackParamList } from '../../navigation/types';
import { CUSTOM_COMMAND_SCREENS } from '../../commands/index';

type CommandScreenRouteProp = RouteProp<ChatStackParamList, 'CommandScreen'>;

export function CommandScreen() {
    const route = useRoute<CommandScreenRouteProp>();
    const navigation = useNavigation();
    const { spec } = route.params;

    const CustomScreen = CUSTOM_COMMAND_SCREENS[spec.name];
    if (!CustomScreen) {
        // Fallback: should not happen since we only navigate here for known custom screens
        navigation.goBack();
        return null;
    }

    return (
        <CustomScreen
            spec={spec}
            onResult={() => {
                // Result delivered; navigate back
                navigation.goBack();
            }}
            onCancel={() => navigation.goBack()}
        />
    );
}
