import React, { useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    PanResponder,
    Animated,
    StyleSheet,
    Platform,
    NativeSyntheticEvent,
    TextInputKeyPressEventData,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { PlanItem } from '../types';
import { PlanChipBadge } from './PlanChipBadge';

interface Props {
    item: PlanItem;
    onCheck: () => void;
    onTextChange: (text: string) => void;
    onIndent: (delta: -1 | 1) => void;
    onDelete: () => void;
    onAddAfter: () => void;
    onChipRemove: (chipId: string) => void;
    drag: () => void;
    isActive: boolean;
    inputRef?: React.RefObject<TextInput>;
}

export function PlanItemRow({
    item,
    onCheck,
    onTextChange,
    onIndent,
    onDelete,
    onAddAfter,
    onChipRemove,
    drag,
    isActive,
    inputRef,
}: Props) {
    const { theme } = useTheme();
    const scaleAnim = useRef(new Animated.Value(1)).current;

    // Animate scale when drag becomes active/inactive
    const prevActiveRef = useRef(isActive);
    if (prevActiveRef.current !== isActive) {
        prevActiveRef.current = isActive;
        Animated.spring(scaleAnim, {
            toValue: isActive ? 1.05 : 1,
            useNativeDriver: true,
            bounciness: 4,
        }).start();
    }

    // PanResponder on checkbox for swipe-to-indent
    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gs) =>
                Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy),
            onPanResponderRelease: (_, gs) => {
                if (gs.dx > 20) {
                    onIndent(1);
                } else if (gs.dx < -20) {
                    onIndent(-1);
                }
            },
        }),
    ).current;

    const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (e.nativeEvent.key === 'Backspace' && item.text === '') {
            onDelete();
        }
    };

    const checkboxBg = item.checked ? '#34C759' : 'transparent';
    const checkboxBorder = isActive ? '#007AFF' : item.checked ? '#34C759' : theme.border;

    return (
        <Animated.View
            style={[
                styles.rowContainer,
                {
                    paddingLeft: item.depth * 28 + 12,
                    paddingRight: 12,
                    transform: [{ scale: scaleAnim }],
                    ...(isActive && styles.activeRow),
                },
            ]}
        >
            {/* Checkbox — also handles long-press for drag and swipe for indent */}
            <TouchableOpacity
                onPress={onCheck}
                onLongPress={drag}
                delayLongPress={200}
                style={[
                    styles.checkbox,
                    {
                        backgroundColor: checkboxBg,
                        borderColor: checkboxBorder,
                        borderWidth: isActive ? 2 : 1.5,
                    },
                ]}
                {...panResponder.panHandlers}
                activeOpacity={0.7}
            >
                {item.checked && (
                    <Text style={styles.checkmark}>✓</Text>
                )}
            </TouchableOpacity>

            {/* Content: text input + chips */}
            <View style={styles.content}>
                <TextInput
                    ref={inputRef}
                    style={[
                        styles.textInput,
                        {
                            color: item.checked ? theme.textSecondary : theme.textPrimary,
                            textDecorationLine: item.checked ? 'line-through' : 'none',
                        },
                    ]}
                    value={item.text}
                    onChangeText={onTextChange}
                    placeholder={item.placeholder ?? 'Task…'}
                    placeholderTextColor={theme.textSecondary}
                    multiline={false}
                    returnKeyType="done"
                    onSubmitEditing={onAddAfter}
                    onKeyPress={handleKeyPress}
                    blurOnSubmit={false}
                />

                {item.chips.length > 0 && (
                    <View style={styles.chipsRow}>
                        {item.chips.map(chip => (
                            <PlanChipBadge
                                key={chip.id}
                                chip={chip}
                                onRemove={() => onChipRemove(chip.id)}
                            />
                        ))}
                    </View>
                )}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    rowContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 6,
        backgroundColor: 'transparent',
    },
    activeRow: {
        shadowColor: '#007AFF',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 6,
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Platform.OS === 'ios' ? 2 : 3,
        marginRight: 10,
        flexShrink: 0,
    },
    checkmark: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '700',
        lineHeight: 14,
    },
    content: {
        flex: 1,
        gap: 4,
    },
    textInput: {
        fontSize: 15,
        lineHeight: 22,
        paddingVertical: 0,
        // Remove default Android underline
        ...Platform.select({ android: { includeFontPadding: false } }),
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
    },
});
