import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    ActivityIndicator,
    StyleSheet,
    SafeAreaView,
    TouchableOpacity,
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
import { ChatBottomSheet } from './components/ChatBottomSheet';

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

// ---------------------------------------------------------------------------
// PlannerScreen
// ---------------------------------------------------------------------------

export function PlannerScreen() {
    const { theme } = useTheme();

    // Date state
    const [date, setDate] = useState<string>(today);

    // Plan document hook
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
        bannerMessage,
        clearBanner,
    } = usePlanDocument(date);

    // Register applyPatches in the global registry so ClientToolExecutor can call it
    useEffect(() => {
        registerApplyPatches(applyPatches);
        return () => {
            unregisterApplyPatches();
        };
    }, [applyPatches]);

    // Chat bottom sheet state
    const [chatOpen, setChatOpen] = useState(false);

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
            onAddAfter={() => addItem(item.id)}
            onChipRemove={(chipId) =>
                updateItem(item.id, {
                    chips: item.chips.filter((c) => c.id !== chipId),
                })
            }
            drag={drag}
            isActive={isActive}
        />
    );

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <PlanDocumentContext.Provider value={{ applyPatches }}>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <SafeAreaView
                    style={[styles.root, { backgroundColor: theme.background }]}
                >
                    {/* Date navigation header */}
                    <DocumentHeader
                        date={date}
                        onPrev={() => setDate(addDays(date, -1))}
                        onNext={() => setDate(addDays(date, 1))}
                    />

                    {/* Content */}
                    {loading ? (
                        <View style={styles.loadingCenter}>
                            <ActivityIndicator size="large" color="#007AFF" />
                        </View>
                    ) : items.length === 0 ? (
                        <View style={styles.emptyCenter}>
                            <Text
                                style={[
                                    styles.emptyText,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                Нажми + Пункт чтобы начать
                            </Text>
                        </View>
                    ) : (
                        <DraggableFlatList
                            data={items}
                            keyExtractor={(item) => item.id}
                            renderItem={renderItem}
                            onDragEnd={({ from, to }) => moveItem(from, to)}
                            contentContainerStyle={styles.listContent}
                        />
                    )}

                    {/* Bottom action bar */}
                    <View
                        style={[
                            styles.bottomBar,
                            {
                                borderTopColor: theme.border,
                                backgroundColor: theme.background,
                            },
                        ]}
                    >
                        {/* + Пункт */}
                        <TouchableOpacity
                            onPress={() => addItem()}
                            style={[
                                styles.bottomBtn,
                                { backgroundColor: theme.surface, borderColor: theme.border },
                            ]}
                            activeOpacity={0.7}
                        >
                            <Text
                                style={[styles.bottomBtnText, { color: theme.textPrimary }]}
                            >
                                ＋ Пункт
                            </Text>
                        </TouchableOpacity>

                        {/* ✦ Спросить */}
                        <TouchableOpacity
                            onPress={() => setChatOpen(true)}
                            style={[styles.bottomBtn, styles.genieBtn]}
                            activeOpacity={0.7}
                        >
                            <Text style={[styles.bottomBtnText, { color: '#FFFFFF' }]}>
                                ✦ Спросить
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {/* AI edit banner (slides up from bottom) */}
                    <AIEditBanner
                        message={bannerMessage}
                        onDismiss={clearBanner}
                    />

                    {/* Chat bottom sheet */}
                    <ChatBottomSheet
                        isOpen={chatOpen}
                        onClose={() => setChatOpen(false)}
                        date={date}
                    />
                </SafeAreaView>
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
    loadingCenter: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyCenter: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyText: {
        fontSize: 16,
        textAlign: 'center',
    },
    listContent: {
        paddingBottom: 80,
    },
    bottomBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        gap: 10,
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
        borderWidth: 1,
    },
    genieBtn: {
        backgroundColor: '#007AFF',
        borderColor: '#007AFF',
    },
    bottomBtnText: {
        fontSize: 15,
        fontWeight: '600',
    },
});
