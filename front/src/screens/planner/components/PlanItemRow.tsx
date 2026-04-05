import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    TextInput,
    TouchableOpacity,
    Animated,
    StyleSheet,
    Platform,
    Keyboard,
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
    const [localText, setLocalText] = useState(item.text);
    // Tracks whether indent was already fired for this gesture (prevent double-fire)
    const indentFired = useRef(false);

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

    // Fire indent as soon as horizontal threshold is crossed during the active gesture.
    // Keep the direction check loose (just abs(X) > abs(Y)) so left swipes are not filtered
    // out by the tighter *2 requirement.
    const onGestureEvent = (e: any) => {
        const { translationX, translationY } = e.nativeEvent;
        if (
            !indentFired.current &&
            Math.abs(translationX) > 20 &&
            Math.abs(translationX) > Math.abs(translationY)
        ) {
            indentFired.current = true;
            onIndent(translationX > 0 ? 1 : -1);
        }
    };

    const onHandlerStateChange = (e: any) => {
        const { state } = e.nativeEvent;
        if (state === State.BEGAN) {
            indentFired.current = false;
        }
    };

    const timeChip = item.chips.find(c => c.type === 'time');
    const otherChips = item.chips.filter(c => c.type !== 'time');

    return (
        <Animated.View
            style={[
                styles.rowContainer,
                {
                    transform: [{ scale: scaleAnim }],
                    ...(isActive && styles.activeRow),
                },
            ]}
        >
            {/* Single dot — tap = check/uncheck, long-press = drag, swipe L/R = indent */}
            <PanGestureHandler
                activeOffsetX={[-8, 8]}
                failOffsetY={[-20, 20]}
                onGestureEvent={onGestureEvent}
                onHandlerStateChange={onHandlerStateChange}
            >
                <TouchableOpacity
                    onPress={onCheck}
                    onLongPress={handleLongPress}
                    delayLongPress={200}
                    style={styles.dotArea}
                    activeOpacity={0.6}
                >
                    <View
                        style={[
                            styles.dot,
                            { backgroundColor: item.checked ? '#34C759' : theme.border },
                        ]}
                    />
                </TouchableOpacity>
            </PanGestureHandler>

            {/* Indented content — shifts right with nesting depth */}
            <View style={[styles.indentedContent, { marginLeft: item.depth * 24 }]}>
                <View style={styles.content}>
                    {/* Time chip (inline) + text on one line, other chips below */}
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
        alignItems: 'flex-start',
        paddingVertical: 6,
        paddingLeft: 4,
        paddingRight: 12,
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
    dotArea: {
        width: 32,
        paddingTop: 7,   // aligns dot center with the first text line (~12px from content top)
        alignItems: 'center',
        flexShrink: 0,
    },
    dot: {
        width: 9,
        height: 9,
        borderRadius: 4.5,
    },
    indentedContent: {
        flex: 1,
    },
    content: {
        flex: 1,
        gap: 4,
    },
    textRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',  // chip and text both start at the top, so dot aligns with line 1
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
    },
});
