import { StyleSheet } from 'react-native';
import { oneDarkPalette } from '../../../themes/oneDark.ts';

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
        backgroundColor: '#2b2f36',
        borderRadius: 12,
        padding: 16,
        width: '100%',
        maxWidth: 480,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(171, 178, 191, 0.06)',
    },
    dialogTitle: {
        color: oneDarkPalette.white,
        fontSize: 17,
        fontWeight: '700',
        marginBottom: 8,
    },
    callbackInfo: {
        color: 'rgba(171, 178, 191, 0.8)',
        fontSize: 12,
        marginBottom: 8,
    },
    scrollContent: { paddingTop: 4, paddingBottom: 6 },
    sectionTitle: {
        color: 'rgba(171, 178, 191, 0.8)',
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 10,
    },
    loadingText: {
        color: 'rgba(171, 178, 191, 0.6)',
        fontSize: 12,
        textAlign: 'center',
        marginTop: 8,
    },
    card: {
        backgroundColor: '#30343b',
        paddingVertical: 8,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(171, 178, 191, 0.08)',
    },
    row: {
        minHeight: 56,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    connectBtn: {
        backgroundColor: '#3a7bf6',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        marginRight: 10,
    },
    connectBtnPressed: { opacity: 0.85 },
    connectText: { color: '#fff', fontWeight: '700' },
    connectedText: { color: 'rgba(171, 178, 191, 0.9)', marginRight: 10 },
    rowPressed: {
        backgroundColor: 'rgba(171, 178, 191, 0.06)',
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: 'rgba(171, 178, 191, 0.12)',
        marginLeft: 64,
    },
    iconBubble: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    iconText: {
        color: '#fff',
        fontSize: 18,
    },
    rowTitle: {
        color: oneDarkPalette.white,
        fontSize: 16,
        flex: 1,
    },
    switchWrap: {
        marginRight: 12,
    },
    titleBlock: {
        flex: 1,
        marginLeft: 4,
    },
    statusText: {
        color: 'rgba(171, 178, 191, 0.6)',
        fontSize: 11,
        marginTop: 2,
    },
    emptyRow: {
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        color: 'rgba(171, 178, 191, 0.5)',
        fontSize: 14,
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
        backgroundColor: oneDarkPalette.white,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
    },
    syncButtonDisabled: {
        opacity: 0.8,
    },
    syncButtonText: {
        color: oneDarkPalette.black,
        fontWeight: '700',
    },
    inputGroup: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        gap: 4,
    },
    inputLabel: {
        color: 'rgba(171, 178, 191, 0.8)',
        fontSize: 12,
        fontWeight: '600',
    },
    syncInput: {
        backgroundColor: '#262a31',
        color: oneDarkPalette.white,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(171, 178, 191, 0.15)',
    },
    syncStatus: {
        color: 'rgba(171, 178, 191, 0.85)',
        fontSize: 12,
        paddingHorizontal: 14,
        paddingBottom: 10,
    },
});
