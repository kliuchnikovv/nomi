import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    SafeAreaView,
    KeyboardAvoidingView,
    Platform,
    TouchableOpacity,
    TextInput,
    Keyboard,
    Linking,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ChatBubble, Calendar as CalendarIcon, Plus } from 'iconoir-react-native';
import { useTheme } from '../../context/ThemeContext';
import { TAB_BAR_ICON_HEIGHT } from '../../navigation/MainTabs';
import { PlanItem } from './types';
import { PlanDocumentContext } from './PlanDocumentContext';
import { registerApplyPatches, unregisterApplyPatches } from './planDocumentRegistry';
import { usePlanDocument } from './hooks/usePlanDocument';
import { usePlanRemindersSync } from './hooks/usePlanRemindersSync';
import { PlanItemRow } from './components/PlanItemRow';
import { AIEditBanner } from './components/AIEditBanner';
import { ChatBottomSheet } from './components/ChatBottomSheet';
import { DocumentHeader } from './components/DocumentHeader';
import { AddChipMenu } from './components/AddChipMenu';
import { TimePickerModal } from './components/TimePickerModal';
import { PlanLocationPickerModal } from './components/PlanLocationPickerModal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(date: string, delta: number): string {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// PlannerScreen
// ---------------------------------------------------------------------------

export function PlannerScreen() {
    const { theme } = useTheme();
    const [date, setDate] = useState(today());

    const {
        items,
        loading,
        addItem,
        removeItem,
        updateItem,
        moveItem,
        indentItem,
        toggleChecked,
        applyPatches,
        flushSync,
        bannerMessage,
        clearBanner,
    } = usePlanDocument(date);

    const { isSyncing, sync: syncToReminders } = usePlanRemindersSync(date, items);

    const [chatOpen, setChatOpen] = useState(false);
    const [autoSendTrigger, setAutoSendTrigger] = useState(false);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
    const [chipMenuItemId, setChipMenuItemId] = useState<string | null>(null);
    const [timePickerItemId, setTimePickerItemId] = useState<string | null>(null);
    const [locationPickerItemId, setLocationPickerItemId] = useState<string | null>(null);


    useEffect(() => {
        const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true));
        const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardVisible(false));
        return () => { show.remove(); hide.remove(); };
    }, []);

    // ---------------------------------------------------------------------------
    // Register applyPatches in registry
    // ---------------------------------------------------------------------------

    useEffect(() => {
        registerApplyPatches(applyPatches);
        return () => { unregisterApplyPatches(); };
    }, [applyPatches]);

    // ---------------------------------------------------------------------------
    // Input focus management
    // ---------------------------------------------------------------------------

    const itemInputRefsMap = useRef<Map<string, TextInput>>(new Map());
    const pendingFocusIdRef = useRef<string | null>(null);

    const registerInputRef = useCallback((id: string, ref: TextInput | null) => {
        if (ref) itemInputRefsMap.current.set(id, ref);
        else itemInputRefsMap.current.delete(id);
    }, []);

    useEffect(() => {
        const id = pendingFocusIdRef.current;
        if (!id) return;
        const ref = itemInputRefsMap.current.get(id);
        if (ref) {
            ref.focus();
            pendingFocusIdRef.current = null;
        }
    });

    // Reset auto-add flag whenever we navigate to a different date
    const initialItemAddedRef = useRef(false);
    useEffect(() => {
        initialItemAddedRef.current = false;
    }, [date]);

    // Auto-add first item when the day is empty
    useEffect(() => {
        if (!loading && items.length === 0 && !initialItemAddedRef.current) {
            initialItemAddedRef.current = true;
            const id = addItem();
            pendingFocusIdRef.current = id;
        }
    }, [loading, items.length]);

    // ---------------------------------------------------------------------------
    // Item handlers
    // ---------------------------------------------------------------------------

    const handleRemoveItem = useCallback((id: string) => {
        const idx = items.findIndex(i => i.id === id);
        if (idx > 0) {
            pendingFocusIdRef.current = items[idx - 1].id;
        }
        removeItem(id);
    }, [items, removeItem]);

    const handleAddAfter = useCallback((afterId?: string) => {
        const lastItem = items[items.length - 1];
        if (lastItem && lastItem.text.trim() === '') {
            pendingFocusIdRef.current = lastItem.id;
            return;
        }
        const newId = addItem(afterId);
        pendingFocusIdRef.current = newId;
    }, [items, addItem]);

    const handleLocationChipPress = useCallback((itemId: string) => {
        // Apple Maps uses + for spaces, not %20
        const encodeStop = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
        const stops: string[] = [];
        for (const item of items) {
            const locationChip = item.chips.find(c => c.type === 'location');
            const isTapped = item.id === itemId;
            // Collect unchecked items; always include tapped item as destination
            if (locationChip && (!item.checked || isTapped)) {
                stops.push(locationChip.value);
            }
            if (isTapped) break;
        }
        if (stops.length === 0) return;
        const encoded = stops.map(encodeStop);
        // Omit saddr — Apple Maps defaults to current location.
        // Multi-stop: daddr=first+to:second+to:third
        const url = `maps://?daddr=${encoded.join('+to:')}`;
        Linking.openURL(url).catch((err: unknown) => {
            console.warn('Failed to open Maps:', err);
        });
    }, [items]);

    // ---------------------------------------------------------------------------
    // "Plan day" — opens chat with auto-prompt
    // ---------------------------------------------------------------------------

    const handlePlanDay = useCallback(async () => {
        const namedItems = items.filter(i => i.text.trim() !== '');
        if (namedItems.length === 0) return;
        Keyboard.dismiss();
        await flushSync();
        setAutoSendTrigger(true);
        setChatOpen(true);
    }, [items, flushSync]);

    // ---------------------------------------------------------------------------
    // Render item
    // ---------------------------------------------------------------------------

    const handleTimeChipConfirm = useCallback((value: string) => {
        if (!timePickerItemId) return;
        const item = items.find(i => i.id === timePickerItemId);
        if (!item) return;
        updateItem(timePickerItemId, {
            chips: [
                ...item.chips.filter(c => c.type !== 'time'),
                { id: generateId(), type: 'time', value, isNew: true, source: 'user' },
            ],
        });
        setTimePickerItemId(null);
    }, [timePickerItemId, items, updateItem]);

    const handleLocationChipAdd = useCallback((value: string) => {
        if (!locationPickerItemId) return;
        const item = items.find(i => i.id === locationPickerItemId);
        if (!item) return;
        updateItem(locationPickerItemId, {
            chips: [
                ...item.chips.filter(c => c.type !== 'location'),
                { id: generateId(), type: 'location', value, isNew: true, source: 'user' },
            ],
        });
        setLocationPickerItemId(null);
    }, [locationPickerItemId, items, updateItem]);

    const renderItem = useCallback(({ item, drag, isActive }: RenderItemParams<PlanItem>) => (
        <ScaleDecorator>
            <PlanItemRow
                item={item}
                onCheck={() => toggleChecked(item.id)}
                onTextChange={(text) => updateItem(item.id, { text })}
                onIndent={(delta) => indentItem(item.id, delta)}
                onDelete={() => handleRemoveItem(item.id)}
                onAddAfter={() => handleAddAfter(item.id)}
                onChipRemove={(chipId) =>
                    updateItem(item.id, { chips: item.chips.filter(c => c.id !== chipId) })
                }
                onFocus={() => setFocusedItemId(item.id)}
                onLocationChipPress={() => handleLocationChipPress(item.id)}
                drag={drag}
                isActive={isActive}
                inputRef={(ref) => registerInputRef(item.id, ref)}
            />
        </ScaleDecorator>
    ), [toggleChecked, updateItem, indentItem, handleRemoveItem, handleAddAfter, registerInputRef, handleLocationChipPress]);

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <PlanDocumentContext.Provider value={{ applyPatches }}>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.background }}>
                <View style={{ flex: 1, backgroundColor: theme.background }}>
                    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>
                        <KeyboardAvoidingView
                            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                            style={{ flex: 1 }}
                        >
                            {/* Header + list fill all available space above the bottom bar */}
                            <View style={{ flex: 1 }}>
                                <View style={[styles.screenHeader, { borderBottomColor: theme.border }]}>
                                    <Text style={[styles.screenTitle, { color: theme.textPrimary }]}>Planner</Text>
                                </View>
                                <DocumentHeader
                                    date={date}
                                    onPrev={() => setDate(shiftDate(date, -1))}
                                    onNext={() => setDate(shiftDate(date, 1))}
                                    isSyncing={isSyncing}
                                    onSync={syncToReminders}
                                />

                                <DraggableFlatList
                                    data={items}
                                    keyExtractor={(item) => item.id}
                                    renderItem={renderItem}
                                    onDragEnd={({ from, to }) => moveItem(from, to)}
                                    containerStyle={{ flex: 1 }}
                                    contentContainerStyle={styles.listContent}
                                    keyboardShouldPersistTaps="handled"
                                    ListFooterComponent={<View style={styles.listFooter} />}
                                />
                            </View>

                            {/* Bottom action bar — sits below the flex:1 area, gets pushed up by keyboard */}
                            <View
                                style={[
                                    styles.bottomBar,
                                    { borderTopColor: theme.border, backgroundColor: theme.background },
                                ]}
                            >
                                <TouchableOpacity
                                    onPress={() => focusedItemId && setChipMenuItemId(focusedItemId)}
                                    style={[
                                        styles.addChipBtn,
                                        { borderColor: theme.border, backgroundColor: theme.surface, opacity: focusedItemId ? 1 : 0.35 },
                                    ]}
                                    activeOpacity={0.7}
                                    disabled={!focusedItemId}
                                >
                                    <Plus width={18} height={18} color={theme.textPrimary} />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={() => { Keyboard.dismiss(); setChatOpen(true); }}
                                    style={[styles.bottomBtn, styles.chatBtn, { borderColor: theme.border, backgroundColor: theme.surface }]}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.bottomBtnContent}>
                                        <ChatBubble width={16} height={16} color={theme.textPrimary} />
                                        <Text style={[styles.bottomBtnText, { color: theme.textPrimary }]}>Chat</Text>
                                    </View>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={handlePlanDay}
                                    style={[styles.bottomBtn, styles.planBtn]}
                                    activeOpacity={0.7}
                                >
                                    <View style={styles.bottomBtnContent}>
                                        <CalendarIcon width={16} height={16} color="#FFFFFF" />
                                        <Text style={[styles.bottomBtnText, { color: '#FFFFFF' }]}>Plan</Text>
                                    </View>
                                </TouchableOpacity>
                            </View>

                            {/* Spacer so bottom bar clears the floating tab bar (hidden when keyboard is open) */}
                            {!keyboardVisible && <View style={{ height: TAB_BAR_ICON_HEIGHT }} />}

                            {/* AI edit banner */}
                            <AIEditBanner message={bannerMessage} onDismiss={clearBanner} />
                        </KeyboardAvoidingView>
                    </SafeAreaView>

                    <ChatBottomSheet
                        isOpen={chatOpen}
                        onClose={() => setChatOpen(false)}
                        date={date}
                        items={items}
                        autoSend={autoSendTrigger}
                        autoSendWebSearch={true}
                        onAutoSendHandled={() => setAutoSendTrigger(false)}
                    />
                </View>

                <AddChipMenu
                    visible={chipMenuItemId !== null}
                    onClose={() => setChipMenuItemId(null)}
                    onSelectTime={() => {
                        setTimePickerItemId(chipMenuItemId);
                        setChipMenuItemId(null);
                    }}
                    onSelectLocation={() => {
                        setLocationPickerItemId(chipMenuItemId);
                        setChipMenuItemId(null);
                    }}
                />

                <TimePickerModal
                    visible={timePickerItemId !== null}
                    initialValue={
                        timePickerItemId
                            ? items.find(i => i.id === timePickerItemId)?.chips.find(c => c.type === 'time')?.value
                            : undefined
                    }
                    onConfirm={handleTimeChipConfirm}
                    onCancel={() => setTimePickerItemId(null)}
                />

                <PlanLocationPickerModal
                    visible={locationPickerItemId !== null}
                    onClose={() => setLocationPickerItemId(null)}
                    onSelect={handleLocationChipAdd}
                />
            </GestureHandlerRootView>
        </PlanDocumentContext.Provider>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    screenHeader: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    screenTitle: {
        fontSize: 28,
        fontWeight: '700',
    },
    listContent: {
        paddingBottom: 8,
    },
    listFooter: {
        height: 8,
    },
    bottomBar: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    bottomBtn: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addChipBtn: {
        width: 44,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chatBtn: {
        borderWidth: 1,
    },
    planBtn: {
        backgroundColor: '#5856D6',
    },
    bottomBtnContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    bottomBtnText: {
        fontSize: 14,
        fontWeight: '600',
    },
});
