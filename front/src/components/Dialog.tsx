import React from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { tokyoNight, tokyoNightPalette } from '../themes/tokyoNight';

export type DialogAction = {
  label: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'danger';
  testID?: string;
};

export type DialogProps = {
  visible: boolean;
  title?: string | React.ReactNode;
  children?: React.ReactNode;
  actions?: DialogAction[];
  onClose: () => void;
  dismissOnBackdrop?: boolean;
};

export default function Dialog({
  visible,
  title,
  children,
  actions = [],
  onClose,
  dismissOnBackdrop = true,
}: DialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.center}>
        <Pressable
          style={styles.backdrop}
          onPress={dismissOnBackdrop ? onClose : undefined}
          accessibilityRole="button"
          accessibilityLabel="Close dialog"
        />

        <KeyboardAvoidingView
          style={{ width: '100%' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.dialog} accessibilityRole="dialog">
            {typeof title === 'string' ? (
              <Text style={styles.title}>{title}</Text>
            ) : (
              title
            )}

            {children ? <View style={styles.content}>{children}</View> : null}

            {actions.length > 0 && (
              <View style={styles.actions}>
                {actions.map((a, idx) => (
                  <Pressable
                    key={idx}
                    onPress={a.onPress}
                    style={[styles.actionBtn, variantToStyle[a.variant ?? 'default']]}
                    accessibilityRole="button"
                    testID={a.testID}
                  >
                    <Text
                      style={[
                        styles.actionText,
                        a.variant && (a.variant === 'primary' || a.variant === 'danger')
                          ? styles.filledText
                          : undefined,
                      ]}
                    >
                      {a.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const variantToStyle = StyleSheet.create({
  default: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(192, 202, 245, 0.18)',
  },
  primary: {
    backgroundColor: tokyoNightPalette.blue,
  },
  danger: {
    backgroundColor: tokyoNightPalette.red,
  },
});

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  dialog: {
    backgroundColor: tokyoNight.surface,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: tokyoNight.border,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  title: { color: tokyoNight.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  content: {},
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginLeft: 8 },
  actionText: { color: tokyoNight.fadedText, fontSize: 14, fontWeight: '600' },
  filledText: { color: '#fff', fontWeight: '600' },
});
