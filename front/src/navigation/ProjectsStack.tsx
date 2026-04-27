import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ProjectsStackParamList } from './types';
import { ProjectsScreen } from '../screens/projects/ProjectsScreen';
import { ProjectDetailScreen } from '../screens/projects/ProjectDetailScreen';
import { CreateEditProjectScreen } from '../screens/projects/CreateEditProjectScreen';

const Stack = createNativeStackNavigator<ProjectsStackParamList>();

export function ProjectsStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ProjectsList" component={ProjectsScreen} />
            <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
            <Stack.Screen name="CreateEditProject" component={CreateEditProjectScreen} />
        </Stack.Navigator>
    );
}
