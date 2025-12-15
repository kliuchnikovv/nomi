import { StyleSheet } from 'react-native';
import { tokyoNight, tokyoNightTheme } from '../../../themes/tokyoNight';

const palette = tokyoNightTheme.palette;

export const styles = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 999,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.45)',
    },
    sheet: {
        backgroundColor: tokyoNight.surface,
        borderRadius: 12,
        padding: 16,
        width: '100%',
        maxWidth: 480,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokyoNight.border,
    },
    dialogTitle: {
        color: tokyoNight.text,
        fontSize: 17,
        fontWeight: '700',
        marginBottom: 8,
    },
    callbackInfo: {
        color: tokyoNight.fadedText,
        fontSize: 12,
        marginBottom: 8,
    },
    scrollContent: { paddingTop: 4, paddingBottom: 6 },
    sectionTitle: {
        color: tokyoNight.fadedText,
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 10,
    },
    loadingText: {
        color: tokyoNight.fadedText,
        fontSize: 12,
        textAlign: 'center',
        marginTop: 8,
    },
    card: {
        backgroundColor: 'rgba(192, 202, 245, 0.03)',
        paddingVertical: 8,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(192, 202, 245, 0.08)',
        marginBottom: 24,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
        gap: 8,
    },
    row: {
        minHeight: 56,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    connectBtn: {
        backgroundColor: tokyoNight.accent,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        marginRight: 10,
    },
    connectBtnPressed: { opacity: 0.85 },
    connectText: { color: palette.bg, fontWeight: '700' },
    connectedText: { color: tokyoNight.text, marginRight: 10 },
    rowPressed: {
        backgroundColor: 'rgba(192, 202, 245, 0.06)',
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: tokyoNight.border,
        marginLeft: 64,
    },
    iconBubble: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconText: {
        color: palette.bg,
        fontSize: 18,
    },
    rowTitle: {
        color: tokyoNight.text,
        fontSize: 16,
    },
    switchWrap: {
        marginRight: 12,
    },
    titleBlock: {
        flex: 1,
        marginLeft: 12,
        justifyContent: 'center',
        gap: 2,
    },
    statusText: {
        color: tokyoNight.fadedText,
        fontSize: 12,
    },
    emptyRow: {
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        color: tokyoNight.fadedText,
        fontSize: 14,
    },
    addAccountButton: {
        backgroundColor: tokyoNight.accent,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
    },
    addAccountButtonText: {
        color: palette.bg,
        fontWeight: '700',
    },
    syncRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 12,
    },
    syncTextBlock: {
        flex: 1,
        gap: 2,
        paddingRight: 8,
    },
    syncButton: {
        backgroundColor: tokyoNight.text,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
    },
    syncButtonDisabled: {
        opacity: 0.8,
    },
    syncButtonText: {
        color: palette.bg,
        fontWeight: '700',
    },
    inputGroup: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        gap: 4,
    },
    inputLabel: {
        color: tokyoNight.fadedText,
        fontSize: 12,
        fontWeight: '600',
    },
    syncInput: {
        backgroundColor: 'rgba(192, 202, 245, 0.06)',
        color: tokyoNight.text,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokyoNight.border,
    },
    syncStatus: {
        color: tokyoNight.fadedText,
        fontSize: 12,
        paddingHorizontal: 14,
        paddingBottom: 10,
    },
});
