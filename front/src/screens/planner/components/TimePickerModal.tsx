import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Modal,
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    StyleSheet,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function parseInitial(value?: string): [number, number] {
    if (!value) {
        const now = new Date();
        return [now.getHours(), 0];
    }
    const [h, m] = value.split(':').map(Number);
    return [isNaN(h) ? 0 : h, isNaN(m) ? 0 : m];
}

interface WheelProps {
    items: number[];
    initialIndex: number;
    onIndexChange: (index: number) => void;
    textColor: string;
    borderColor: string;
}

function Wheel({ items, initialIndex, onIndexChange, textColor, borderColor }: WheelProps) {
    const scrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        // Scroll to initial position after mount without animation
        const timer = setTimeout(() => {
            scrollRef.current?.scrollTo({ y: initialIndex * ITEM_HEIGHT, animated: false });
        }, 50);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const raw = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
        const index = Math.max(0, Math.min(items.length - 1, raw));
        scrollRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
        onIndexChange(index);
    }, [items.length, onIndexChange]);

    return (
        <View style={styles.wheelWrapper}>
            <View
                style={[styles.selectionHighlight, { borderColor }]}
                pointerEvents="none"
            />
            <ScrollView
                ref={scrollRef}
                style={{ height: PICKER_HEIGHT }}
                contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM_HEIGHT}
                decelerationRate="fast"
                onMomentumScrollEnd={handleScrollEnd}
                onScrollEndDrag={handleScrollEnd}
            >
                {items.map(val => (
                    <View key={val} style={styles.wheelItem}>
                        <Text style={[styles.wheelItemText, { color: textColor }]}>
                            {pad(val)}
                        </Text>
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

interface Props {
    visible: boolean;
    initialValue?: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}

export function TimePickerModal({ visible, initialValue, onConfirm, onCancel }: Props) {
    const { theme } = useTheme();
    const [initial] = useState(() => parseInitial(initialValue));
    const hourRef = useRef(initial[0]);
    const minuteRef = useRef(initial[1]);

    const handleConfirm = () => {
        onConfirm(`${pad(hourRef.current)}:${pad(minuteRef.current)}`);
    };

    const cardBg = (theme as any).surface ?? theme.background;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onCancel}
        >
            <View style={styles.backdrop}>
                <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onCancel} activeOpacity={1} />
                <View style={[styles.card, { backgroundColor: cardBg }]}>
                    <Text style={[styles.title, { color: theme.textPrimary }]}>Set Time</Text>

                    <View style={styles.wheels}>
                        <Wheel
                            items={HOURS}
                            initialIndex={initial[0]}
                            onIndexChange={i => { hourRef.current = i; }}
                            textColor={theme.textPrimary}
                            borderColor={theme.border}
                        />
                        <Text style={[styles.colon, { color: theme.textPrimary }]}>:</Text>
                        <Wheel
                            items={MINUTES}
                            initialIndex={initial[1]}
                            onIndexChange={i => { minuteRef.current = i; }}
                            textColor={theme.textPrimary}
                            borderColor={theme.border}
                        />
                    </View>

                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={[styles.btn, styles.cancelBtn, { borderColor: theme.border }]}
                            onPress={onCancel}
                            activeOpacity={0.7}
                        >
                            <Text style={[styles.btnText, { color: theme.textSecondary }]}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.btn, styles.confirmBtn]}
                            onPress={handleConfirm}
                            activeOpacity={0.7}
                        >
                            <Text style={[styles.btnText, { color: '#fff' }]}>Done</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    card: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 20,
        paddingBottom: 36,
        paddingHorizontal: 24,
        gap: 20,
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        textAlign: 'center',
    },
    wheels: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    wheelWrapper: {
        width: 80,
        overflow: 'hidden',
        position: 'relative',
    },
    selectionHighlight: {
        position: 'absolute',
        top: ITEM_HEIGHT * 2,
        left: 0,
        right: 0,
        height: ITEM_HEIGHT,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        zIndex: 1,
    },
    wheelItem: {
        height: ITEM_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    wheelItemText: {
        fontSize: 22,
        fontWeight: '400',
    },
    colon: {
        fontSize: 28,
        fontWeight: '600',
        marginHorizontal: 8,
        marginBottom: 2,
    },
    actions: {
        flexDirection: 'row',
        gap: 12,
    },
    btn: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    cancelBtn: {
        borderWidth: 1,
    },
    confirmBtn: {
        backgroundColor: '#007AFF',
    },
    btnText: {
        fontSize: 16,
        fontWeight: '600',
    },
});
