import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Project } from '../../main/models';

interface Props {
    project: Project;
    onAccept: () => void;
    onDismiss: () => void;
    accentColor: string;
    surfaceColor: string;
    textPrimaryColor: string;
    textSecondaryColor: string;
    borderColor: string;
    /** If true, shows a "Нет" text button instead of just the X icon (for blocking mode) */
    showNoButton?: boolean;
}

export function ProjectSuggestionBanner({
    project,
    onAccept,
    onDismiss,
    accentColor,
    surfaceColor,
    textPrimaryColor,
    textSecondaryColor,
    borderColor,
    showNoButton = false,
}: Props) {
    return (
        <View style={[styles.container, { backgroundColor: surfaceColor, borderColor }]}>
            <Text style={styles.projectIcon}>{project.icon}</Text>
            <View style={styles.text}>
                <Text style={[styles.label, { color: textSecondaryColor }]}>
                    Add to project?
                </Text>
                <Text style={[styles.name, { color: textPrimaryColor }]} numberOfLines={1}>
                    {project.name}
                </Text>
            </View>
            {showNoButton ? (
                <TouchableOpacity
                    style={styles.noBtn}
                    onPress={onDismiss}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Text style={[styles.noBtnText, { color: textSecondaryColor }]}>Нет</Text>
                </TouchableOpacity>
            ) : (
                <TouchableOpacity
                    onPress={onDismiss}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="close" size={18} color={textSecondaryColor} />
                </TouchableOpacity>
            )}
            <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: accentColor }]}
                onPress={onAccept}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        gap: 10,
    },
    projectIcon: { fontSize: 20 },
    text: { flex: 1 },
    label: { fontSize: 11, fontWeight: '500' },
    name: { fontSize: 14, fontWeight: '600', marginTop: 1 },
    noBtn: { paddingHorizontal: 8 },
    noBtnText: { fontSize: 14, fontWeight: '500' },
    addBtn: {
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    addBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
