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
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ChatBubble, Calendar as CalendarIcon } from 'iconoir-react-native';
import { useTheme } from '../../context/ThemeContext';
import { PlanItem } from './types';
import { PlanDocumentContext } from './PlanDocumentContext';
import { registerApplyPatches, unregisterApplyPatches } from './planDocumentRegistry';
import { usePlanDocument } from './hooks/usePlanDocument';
import { PlanItemRow } from './components/PlanItemRow';
import { AIEditBanner } from './components/AIEditBanner';
import { ChatBottomSheet } from './components/ChatBottomSheet';
import { DocumentHeader } from './components/DocumentHeader';

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

    const [chatOpen, setChatOpen] = useState(false);
    const [autoSendTrigger, setAutoSendTrigger] = useState(false);

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
                drag={drag}
                isActive={isActive}
                inputRef={(ref) => registerInputRef(item.id, ref)}
            />
        </ScaleDecorator>
    ), [toggleChecked, updateItem, indentItem, handleRemoveItem, handleAddAfter, registerInputRef]);

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
                                <DocumentHeader
                                    date={date}
                                    onPrev={() => setDate(shiftDate(date, -1))}
                                    onNext={() => setDate(shiftDate(date, 1))}
                                />

                                <DraggableFlatList
                                    data={items}
                                    keyExtractor={(item) => item.id}
                                    renderItem={renderItem}
                                    onDragEnd={({ from, to }) => moveItem(from, to)}
                                    containerStyle={{ flex: 1 }}
                                    contentContainerStyle={styles.listContent}
                                    keyboardShouldPersistTaps="handled"
                                    ListFooterComponent={
                                        <TouchableOpacity
                                            onPress={() => handleAddAfter(items[items.length - 1]?.id)}
                                            style={styles.addRow}
                                            activeOpacity={0.5}
                                        >
                                            <Text style={[styles.addRowText, { color: theme.textSecondary }]}>
                                                + Task
                                            </Text>
                                        </TouchableOpacity>
                                    }
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
                                    onPress={() => { Keyboard.dismiss(); setChatOpen(true); }}
                                    style={[styles.bottomBtn, styles.chatBtn, { borderColor: theme.border }]}
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
    listContent: {
        paddingBottom: 8,
    },
    addRow: {
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    addRowText: {
        fontSize: 15,
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
