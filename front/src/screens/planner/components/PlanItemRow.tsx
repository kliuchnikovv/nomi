import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Animated,
    StyleSheet,
    Platform,
    Keyboard,
    NativeSyntheticEvent,
    TextInputKeyPressEventData,
} from 'react-native';
import { PanGestureHandler, State } from 'react-native-gesture-handler';
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
    inputRef?: (ref: TextInput | null) => void;
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

    // Local text state — drives the TextInput. Keeps display in sync even when
    // React Native doesn't propagate value prop changes to a recently-focused input.
    const [localText, setLocalText] = useState(item.text);
    useEffect(() => {
        setLocalText(item.text);
    }, [item.text]);

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

    const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (e.nativeEvent.key === 'Backspace' && localText === '') {
            onDelete();
        }
    };

    const handleTextChange = (text: string) => {
        const newlineIndex = text.indexOf('\n');
        if (newlineIndex !== -1) {
            const trimmed = text.slice(0, newlineIndex);
            setLocalText(trimmed);
            onTextChange(trimmed);
            // Defer list mutation so iOS finishes processing the text event first,
            // preventing NSMutableRLEArray out-of-bounds crash.
            setTimeout(onAddAfter, 0);
        } else {
            setLocalText(text);
            onTextChange(text);
        }
    };

    const handleLongPress = () => {
        Keyboard.dismiss();
        drag();
    };

    const checkboxBg = item.checked ? '#34C759' : 'transparent';
    const checkboxBorder = isActive ? '#007AFF' : item.checked ? '#34C759' : theme.border;

    return (
        <Animated.View
            style={[
                styles.rowContainer,
                {
                    paddingLeft: item.depth * 28 + 12,
                    paddingRight: 4,
                    transform: [{ scale: scaleAnim }],
                    ...(isActive && styles.activeRow),
                },
            ]}
        >
            {/* Checkbox — tap to check, swipe to indent */}
            <PanGestureHandler
                activeOffsetX={[-15, 15]}
                failOffsetY={[-15, 15]}
                onHandlerStateChange={(e) => {
                    if (e.nativeEvent.state === State.END) {
                        const { translationX, translationY } = e.nativeEvent;
                        if (Math.abs(translationX) > Math.abs(translationY) && Math.abs(translationX) > 20) {
                            onIndent(translationX > 0 ? 1 : -1);
                        }
                    }
                }}
            >
                <TouchableOpacity
                    onPress={onCheck}
                    style={[
                        styles.checkbox,
                        {
                            backgroundColor: checkboxBg,
                            borderColor: checkboxBorder,
                            borderWidth: isActive ? 2 : 1.5,
                        },
                    ]}
                    activeOpacity={0.7}
                >
                    {item.checked && (
                        <Text style={styles.checkmark}>✓</Text>
                    )}
                </TouchableOpacity>
            </PanGestureHandler>

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
                    value={localText}
                    onChangeText={handleTextChange}
                    placeholder={item.placeholder ?? 'Задача…'}
                    placeholderTextColor={theme.textSecondary}
                    multiline={true}
                    scrollEnabled={false}
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

            {/* Drag handle — long-press to reorder */}
            <TouchableOpacity
                onLongPress={handleLongPress}
                delayLongPress={200}
                style={styles.dragHandle}
                activeOpacity={0.4}
            >
                <Text style={[styles.dragHandleIcon, { color: theme.textSecondary }]}>⠿</Text>
            </TouchableOpacity>
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
        borderWidth: 1.5,
        borderColor: '#007AFF',
        borderRadius: 8,
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
        ...Platform.select({ android: { includeFontPadding: false } }),
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
    },
    dragHandle: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        alignSelf: 'center',
    },
    dragHandleIcon: {
        fontSize: 18,
        opacity: 0.4,
    },
});
