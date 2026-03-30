import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    ActivityIndicator,
    StyleSheet,
    SafeAreaView,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Keyboard,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import DraggableFlatList, {
    RenderItemParams,
} from 'react-native-draggable-flatlist';
import { useTheme } from '../../context/ThemeContext';
import { PlanItem } from './types';
import { usePlanDocument } from './hooks/usePlanDocument';
import { PlanDocumentContext } from './PlanDocumentContext';
import { registerApplyPatches, unregisterApplyPatches } from './planDocumentRegistry';
import { DocumentHeader } from './components/DocumentHeader';
import { PlanItemRow } from './components/PlanItemRow';
import { AIEditBanner } from './components/AIEditBanner';
import { usePlannerChat } from './hooks/usePlannerChat';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(date: string, n: number): string {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentTimeStr(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildPlanningPrompt(items: PlanItem[], date: string): string {
    const uncheckedItems = items.filter(i => !i.checked);

    if (uncheckedItems.length === 0) {
        return `У меня пока нет задач на ${date}. Можешь посоветовать что мне запланировать?`;
    }

    const tasksList = uncheckedItems.map((item, idx) => {
        const indent = '  '.repeat(item.depth);
        const existingChips = item.chips.map(c => `[${c.type}: ${c.value}]`).join(' ');
        return `${idx + 1}. ID:${item.id} ${indent}${item.text}${existingChips ? ' ' + existingChips : ''}`.trim();
    }).join('\n');

    return `Помоги составить план дня. Сейчас ${currentTimeStr()}, дата: ${date}.

Список задач:
${tasksList}

Для каждой задачи, у которой ещё нет нужного чипа, определи и добавь:
- time: конкретный интервал "HH:MM-HH:MM" с учётом длительности (например "09:00-10:30")
- location: конкретное место или адрес (например "ул. Ленина 5", "дом", "супермаркет Перекрёсток")
- note: важные заметки (время в дороге, подготовка, звонки)

Правила:
1. Не дублируй чипы, которые уже есть у задачи (они показаны в скобках)
2. Учитывай уже расставленное время при планировании остальных задач
3. Если нужно — используй поиск в интернете чтобы уточнить часы работы места или время в пути
4. Расставь задачи в реалистичном порядке дня

Используй инструмент patch_plan_document чтобы применить все изменения одним вызовом.`;
}

// ---------------------------------------------------------------------------
// PlannerScreen
// ---------------------------------------------------------------------------

export function PlannerScreen() {
    const { theme } = useTheme();

    const [date, setDate] = useState<string>(today);
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [planning, setPlanning] = useState(false);

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

    const { sendMessage } = usePlannerChat();

    // Register applyPatches so ClientToolExecutor can call it
    useEffect(() => {
        registerApplyPatches(applyPatches);
        return () => { unregisterApplyPatches(); };
    }, [applyPatches]);

    // Track keyboard visibility
    useEffect(() => {
        const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
        const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
        return () => { show.remove(); hide.remove(); };
    }, []);

    // ---------------------------------------------------------------------------
    // Input focus management
    // ---------------------------------------------------------------------------

    // Map from item.id → TextInput ref
    const itemInputRefsMap = useRef<Map<string, TextInput>>(new Map());
    const pendingFocusIdRef = useRef<string | null>(null);

    const registerInputRef = useCallback((id: string, ref: TextInput | null) => {
        if (ref) itemInputRefsMap.current.set(id, ref);
        else itemInputRefsMap.current.delete(id);
    }, []);

    // After every render, check if there's a pending focus target
    useEffect(() => {
        const id = pendingFocusIdRef.current;
        if (!id) return;
        const ref = itemInputRefsMap.current.get(id);
        if (ref) {
            ref.focus();
            pendingFocusIdRef.current = null;
        }
    });

    // When loading finishes and list is empty, add first item and focus it
    const initialItemAddedRef = useRef(false);
    useEffect(() => {
        if (!loading && items.length === 0 && !initialItemAddedRef.current) {
            initialItemAddedRef.current = true;
            const id = addItem();
            pendingFocusIdRef.current = id;
        }
    }, [loading, items.length]);

    // Reset flag when date changes
    useEffect(() => {
        initialItemAddedRef.current = false;
    }, [date]);

    // Add item after existing one and focus new item
    const handleAddAfter = useCallback((afterId?: string) => {
        const newId = addItem(afterId);
        pendingFocusIdRef.current = newId;
    }, [addItem]);

    // ---------------------------------------------------------------------------
    // Planning day trigger
    // ---------------------------------------------------------------------------

    const handlePlanDay = useCallback(async () => {
        if (items.length === 0 || planning) return;
        setPlanning(true);
        try {
            // Persist current state to server before sending to AI
            await flushSync();
            const prompt = buildPlanningPrompt(items, date);
            sendMessage(prompt, { webSearch: true });
        } finally {
            setPlanning(false);
        }
    }, [items, date, planning, flushSync, sendMessage]);

    // ---------------------------------------------------------------------------
    // Render item for DraggableFlatList
    // ---------------------------------------------------------------------------

    const renderItem = ({ item, drag, isActive }: RenderItemParams<PlanItem>) => (
        <PlanItemRow
            item={item}
            onCheck={() => toggleChecked(item.id)}
            onTextChange={(text) => updateItem(item.id, { text })}
            onIndent={(delta) => indentItem(item.id, delta)}
            onDelete={() => removeItem(item.id)}
            onAddAfter={() => handleAddAfter(item.id)}
            onChipRemove={(chipId) =>
                updateItem(item.id, { chips: item.chips.filter(c => c.id !== chipId) })
            }
            drag={drag}
            isActive={isActive}
            inputRef={(ref) => registerInputRef(item.id, ref)}
        />
    );

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <PlanDocumentContext.Provider value={{ applyPatches }}>
            <GestureHandlerRootView>
            <View style={{ flex: 1 }}>
                <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]}>

                    {/* Date navigation header */}
                    <DocumentHeader
                        date={date}
                        onPrev={() => setDate(addDays(date, -1))}
                        onNext={() => setDate(addDays(date, 1))}
                    />

                    {/* List — tap outside items dismisses keyboard */}
                    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                        <View style={styles.listWrapper}>
                            {loading ? (
                                <View style={styles.loadingCenter}>
                                    <ActivityIndicator size="large" color="#007AFF" />
                                </View>
                            ) : (
                                <DraggableFlatList
                                    data={items}
                                    keyExtractor={(item) => item.id}
                                    renderItem={renderItem}
                                    onDragEnd={({ from, to }) => moveItem(from, to)}
                                    contentContainerStyle={styles.listContent}
                                    keyboardShouldPersistTaps="handled"
                                    // Tapping below the last item adds a new one
                                    ListFooterComponent={
                                        <TouchableWithoutFeedback onPress={() => handleAddAfter(items[items.length - 1]?.id)}>
                                            <View style={styles.listFooter} />
                                        </TouchableWithoutFeedback>
                                    }
                                />
                            )}
                        </View>
                    </TouchableWithoutFeedback>

                    {/* Bottom action bar */}
                    <View
                        style={[
                            styles.bottomBar,
                            { borderTopColor: theme.border, backgroundColor: theme.background },
                        ]}
                    >
                        {/* Скрыть клавиатуру — только когда она видна */}
                        {keyboardVisible && (
                            <TouchableOpacity
                                onPress={Keyboard.dismiss}
                                style={[styles.bottomBtn, styles.dismissBtn, { borderColor: theme.border }]}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.bottomBtnText, { color: theme.textSecondary }]}>
                                    ↓
                                </Text>
                            </TouchableOpacity>
                        )}

                        {/* Запланировать день */}
                        <TouchableOpacity
                            onPress={handlePlanDay}
                            disabled={items.length === 0 || planning}
                            style={[
                                styles.bottomBtn,
                                styles.planBtn,
                                { opacity: items.length === 0 || planning ? 0.4 : 1 },
                            ]}
                            activeOpacity={0.7}
                        >
                            <Text style={[styles.bottomBtnText, { color: '#FFFFFF' }]}>
                                {planning ? '⏳ Сохраняем…' : '🗓 Запланировать'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* AI edit banner */}
                    <AIEditBanner message={bannerMessage} onDismiss={clearBanner} />
                </SafeAreaView>
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
    listWrapper: {
        flex: 1,
    },
    loadingCenter: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        paddingTop: 8,
        paddingBottom: 16,
    },
    listFooter: {
        height: 120,
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
    dismissBtn: {
        flex: 0,
        width: 40,
        borderWidth: 1,
    },
    planBtn: {
        backgroundColor: '#5856D6',
    },
    bottomBtnText: {
        fontSize: 14,
        fontWeight: '600',
    },
});
