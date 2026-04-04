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
} from 'react-native';
import { Check } from 'iconoir-react-native';
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

    // Local text state keeps display in sync even when React Native doesn't
    // propagate value prop changes to a recently-focused input.
    const [localText, setLocalText] = useState(item.text);
    useEffect(() => {
        setLocalText(item.text);
    }, [item.text]);

    // Animate scale when drag becomes active / inactive
    const prevActiveRef = useRef(isActive);
    if (prevActiveRef.current !== isActive) {
        prevActiveRef.current = isActive;
        Animated.spring(scaleAnim, {
            toValue: isActive ? 1.05 : 1,
            useNativeDriver: true,
            bounciness: 4,
        }).start();
    }

    const handleKeyPress = (e: any) => {
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

    // Separate time chip (shown inline before text) from other chips (shown below)
    const timeChip = item.chips.find(c => c.type === 'time');
    const otherChips = item.chips.filter(c => c.type !== 'time');

    const checkboxBg = item.checked ? '#34C759' : 'transparent';
    const checkboxBorder = isActive ? '#007AFF' : item.checked ? '#34C759' : theme.border;

    return (
        <Animated.View
            style={[
                styles.rowContainer,
                {
                    paddingRight: 4,
                    transform: [{ scale: scaleAnim }],
                    ...(isActive && styles.activeRow),
                },
            ]}
        >
            {/* Drag handle — left edge, fixed position.
                Swipe left/right  → change indent depth.
                Long-press        → reorder via DraggableFlatList. */}
            <PanGestureHandler
                activeOffsetX={[-20, 20]}
                failOffsetY={[-10, 10]}
                onHandlerStateChange={(e) => {
                    if (e.nativeEvent.state === State.END) {
                        const { translationX, translationY } = e.nativeEvent;
                        if (
                            Math.abs(translationX) > Math.abs(translationY) &&
                            Math.abs(translationX) > 20
                        ) {
                            onIndent(translationX > 0 ? 1 : -1);
                        }
                    }
                }}
            >
                <TouchableOpacity
                    onLongPress={handleLongPress}
                    delayLongPress={200}
                    style={styles.dragHandle}
                    activeOpacity={0.4}
                >
                    <Text style={[styles.dragHandleIcon, { color: theme.textSecondary }]}>⠿</Text>
                </TouchableOpacity>
            </PanGestureHandler>

            {/* Indented content — shifts right with depth */}
            <View style={[styles.indentedContent, { marginLeft: item.depth * 24 }]}>
                {/* Checkbox — tap to check */}
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
                        <Check width={14} height={14} color="#007AFF" />
                    )}
                </TouchableOpacity>

                {/* Content: time chip + text on one row, other chips below */}
                <View style={styles.content}>
                    <View style={styles.textRow}>
                        {timeChip && (
                            <PlanChipBadge
                                chip={timeChip}
                                onRemove={() => onChipRemove(timeChip.id)}
                            />
                        )}
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
                            placeholder={item.placeholder ?? 'Task…'}
                            placeholderTextColor={theme.textSecondary}
                            multiline={true}
                            scrollEnabled={false}
                            onKeyPress={handleKeyPress}
                            blurOnSubmit={false}
                        />
                    </View>

                    {otherChips.length > 0 && (
                        <View style={styles.chipsRow}>
                            {otherChips.map(chip => (
                                <PlanChipBadge
                                    key={chip.id}
                                    chip={chip}
                                    onRemove={() => onChipRemove(chip.id)}
                                />
                            ))}
                        </View>
                    )}
                </View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    rowContainer: {
        flexDirection: 'row',
        alignItems: 'center',   // vertically center all left-side controls
        paddingVertical: 6,
        paddingLeft: 4,
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
    dragHandle: {
        paddingHorizontal: 4,
        paddingVertical: 6,
        flexShrink: 0,
    },
    dragHandleIcon: {
        fontSize: 18,
        opacity: 0.35,
    },
    indentedContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    checkbox: {
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
        flexShrink: 0,
    },
    content: {
        flex: 1,
        gap: 4,
    },
    textRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
    },
    textInput: {
        flex: 1,
        minWidth: 60,
        fontSize: 15,
        lineHeight: 22,
        paddingVertical: 0,
        ...Platform.select({ android: { includeFontPadding: false } }),
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginLeft: 0,
    },
});
