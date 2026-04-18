import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Modal,
    Pressable,
    StyleSheet,
    Animated,
} from 'react-native';
import { Clock, MapPin, Link, EditPencil } from 'iconoir-react-native';
import { PlanChip, ChipType } from '../types';

interface ChipStyle {
    bg: string;
    text: string;
}

const CHIP_STYLES: Record<ChipType, ChipStyle> = {
    time:     { bg: '#E8F4FF', text: '#007AFF' },
    location: { bg: '#FFF0E8', text: '#FF6B00' },
    link:     { bg: '#F0FFF0', text: '#34C759' },
    note:     { bg: '#F5F0FF', text: '#9B59B6' },
};

const CHIP_ICONS: Record<ChipType, React.FC<{ width: number; height: number; color: string }>> = {
    time: Clock,
    location: MapPin,
    link: Link,
    note: EditPencil,
};

interface Props {
    chip: PlanChip;
    onRemove?: () => void;
    onLocationPress?: () => void;
}

export function PlanChipBadge({ chip, onRemove, onLocationPress }: Props) {
    const glowAnim = useRef(new Animated.Value(0)).current;
    const [modalVisible, setModalVisible] = useState(false);

    const isPlaceholder =
        chip.value.startsWith('[') && chip.value.endsWith(']');

    useEffect(() => {
        if (!chip.isNew) return;

        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(glowAnim, {
                    toValue: 1,
                    duration: 400,
                    useNativeDriver: true,
                }),
                Animated.timing(glowAnim, {
                    toValue: 0,
                    duration: 400,
                    useNativeDriver: true,
                }),
            ]),
            { iterations: 2 },
        );
        pulse.start();
        return () => pulse.stop();
    }, [chip.isNew, glowAnim]);

    const chipStyle = CHIP_STYLES[chip.type];
    const IconComponent = CHIP_ICONS[chip.type];

    const borderOpacity = glowAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
    });

    if (isPlaceholder) {
        return (
            <View style={[styles.pill, styles.placeholderPill]}>
                <IconComponent width={12} height={12} color="#FF6B00" />
                <Text style={[styles.valueText, styles.placeholderText, { color: '#FF6B00' }]}>
                    {chip.value}
                </Text>
            </View>
        );
    }

    if (chip.type === 'note') {
        return (
            <>
                <View style={styles.wrapper}>
                    <Animated.View
                        style={[
                            styles.glowBorder,
                            { opacity: borderOpacity },
                        ]}
                    />
                    <TouchableOpacity
                        onPress={() => setModalVisible(true)}
                        activeOpacity={0.7}
                    >
                        <View style={[styles.pill, { backgroundColor: chipStyle.bg }]}>
                            <IconComponent width={12} height={12} color={chipStyle.text} />
                            <Text style={[styles.valueText, { color: chipStyle.text }]}>инфо</Text>
                            {onRemove && (
                                <TouchableOpacity
                                    onPress={onRemove}
                                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                                    style={styles.removeBtn}
                                >
                                    <Text style={[styles.removeText, { color: chipStyle.text }]}>×</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </TouchableOpacity>
                </View>

                <Modal
                    visible={modalVisible}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setModalVisible(false)}
                >
                    <Pressable style={styles.backdrop} onPress={() => setModalVisible(false)}>
                        <Pressable style={styles.card}>
                            <Text style={styles.noteText}>{chip.value}</Text>
                            <TouchableOpacity
                                onPress={() => setModalVisible(false)}
                                style={styles.closeBtn}
                            >
                                <Text style={styles.closeBtnText}>Закрыть</Text>
                            </TouchableOpacity>
                        </Pressable>
                    </Pressable>
                </Modal>
            </>
        );
    }

    const pillContent = (
        <View style={[styles.pill, { backgroundColor: chipStyle.bg }]}>
            <IconComponent width={12} height={12} color={chipStyle.text} />
            <Text style={[styles.valueText, { color: chipStyle.text }]}>
                {chip.value}
            </Text>
            {onRemove && (
                <TouchableOpacity
                    onPress={onRemove}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    style={styles.removeBtn}
                >
                    <Text style={[styles.removeText, { color: chipStyle.text }]}>×</Text>
                </TouchableOpacity>
            )}
        </View>
    );

    return (
        <View style={styles.wrapper}>
            <Animated.View
                style={[
                    styles.glowBorder,
                    { opacity: borderOpacity },
                ]}
            />
            {chip.type === 'location' && onLocationPress ? (
                <TouchableOpacity onPress={onLocationPress} activeOpacity={0.7}>
                    {pillContent}
                </TouchableOpacity>
            ) : (
                pillContent
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'relative',
    },
    glowBorder: {
        position: 'absolute',
        inset: -2,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#007AFF',
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        gap: 4,
    },
    placeholderPill: {
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: '#FF6B00',
        backgroundColor: 'transparent',
    },
    valueText: {
        fontSize: 12,
        fontWeight: '500',
    },
    placeholderText: {
        fontStyle: 'italic',
    },
    removeBtn: {
        marginLeft: 2,
    },
    removeText: {
        fontSize: 14,
        fontWeight: '600',
        lineHeight: 16,
    },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    card: {
        backgroundColor: '#fff',
        borderRadius: 16,
        padding: 20,
        width: '100%',
        maxWidth: 360,
        gap: 16,
    },
    noteText: {
        fontSize: 15,
        lineHeight: 22,
        color: '#1C1C1E',
    },
    closeBtn: {
        alignSelf: 'flex-end',
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: '#F5F0FF',
        borderRadius: 10,
    },
    closeBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#9B59B6',
    },
});
