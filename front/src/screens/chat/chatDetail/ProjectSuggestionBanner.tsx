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
    /** If true, shows a "No" text button instead of just the X icon (for blocking mode) */
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
        <View
            style={[
                styles.container,
                { backgroundColor: surfaceColor, borderColor },
            ]}
        >
            <View
                style={[
                    styles.iconChip,
                    { backgroundColor: `${accentColor}20` },
                ]}
            >
                <Text style={styles.projectIcon}>{project.icon}</Text>
            </View>
            <View style={styles.text}>
                <Text style={[styles.label, { color: textSecondaryColor }]}>
                    Add to project?
                </Text>
                <Text
                    style={[styles.name, { color: textPrimaryColor }]}
                    numberOfLines={1}
                >
                    {project.name}
                </Text>
            </View>
            {showNoButton ? (
                <TouchableOpacity
                    style={styles.noBtn}
                    onPress={onDismiss}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Text
                        style={[
                            styles.noBtnText,
                            { color: textSecondaryColor },
                        ]}
                    >
                        No
                    </Text>
                </TouchableOpacity>
            ) : (
                <TouchableOpacity
                    style={styles.closeBtn}
                    onPress={onDismiss}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons
                        name="close"
                        size={18}
                        color={textSecondaryColor}
                    />
                </TouchableOpacity>
            )}
            <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: accentColor }]}
                onPress={onAccept}
                activeOpacity={0.85}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <Ionicons
                    name="add"
                    size={16}
                    color="#fff"
                    style={styles.addIcon}
                />
                <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        gap: 10,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
    },
    iconChip: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    projectIcon: { fontSize: 18 },
    text: { flex: 1 },
    label: { fontSize: 11, fontWeight: '500' },
    name: { fontSize: 14, fontWeight: '600', marginTop: 1 },
    noBtn: { paddingHorizontal: 10, paddingVertical: 6 },
    noBtnText: { fontSize: 14, fontWeight: '600' },
    closeBtn: { padding: 4 },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 2,
    },
    addIcon: { marginLeft: -2 },
    addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
