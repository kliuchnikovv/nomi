import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { CommandScreenProps } from '..';
import { CommandArgForm } from '../CommandArgForm';
import { useChat } from '../../screens/chat/context';

export function PlanBuildScreen({ spec, onResult, onCancel }: CommandScreenProps) {
  const { runCommand } = useChat();
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Build Day Plan</Text>
      <CommandArgForm
        spec={spec}
        onCancel={onCancel}
        onSubmit={async (args) => {
          const result = await runCommand(spec.name, args);
          onResult(result);
          navigation.goBack();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
});
