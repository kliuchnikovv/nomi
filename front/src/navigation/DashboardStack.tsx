import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { DashboardStackParamList } from './types';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { TasksScreen } from '../screens/tasks/TasksScreen';
import { TaskDetailScreen } from '../screens/tasks/TaskDetailScreen';

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export function DashboardStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="DashboardHome" component={DashboardScreen} />
            <Stack.Screen name="Tasks" component={TasksScreen} />
            <Stack.Screen name="TaskDetail" component={TaskDetailScreen} />
        </Stack.Navigator>
    );
}
