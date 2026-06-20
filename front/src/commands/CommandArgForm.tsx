/**
 * CommandArgForm — renders an inline form from a CommandSpec's JSON Schema
 * and submits validated args.
 *
 * Validator: hand-written (no Ajv). Covers the v1 schema shapes listed in
 * the task brief: string/number/integer/boolean/enum/array + required +
 * minLength/maxLength. No extra dependency needed.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Switch,
  Pressable,
  StyleSheet,
} from 'react-native';
import type { CommandSpec } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CommandArgFormProps {
  spec: CommandSpec;
  onSubmit: (args: object) => Promise<void> | void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Internal schema helpers
// ---------------------------------------------------------------------------

interface PropSchema {
  type?: string;
  format?: string;
  enum?: string[];
  items?: { type?: string };
  minLength?: number;
  maxLength?: number;
  description?: string;
  default?: unknown;
}

interface ObjectSchema {
  type: string;
  required?: string[];
  properties?: Record<string, PropSchema>;
}

function castSchema(raw: object): ObjectSchema {
  return raw as ObjectSchema;
}

// ---------------------------------------------------------------------------
// Hand-written validator
// ---------------------------------------------------------------------------

function validateField(
  key: string,
  schema: PropSchema,
  value: unknown,
  required: string[],
): string | null {
  const isRequired = required.includes(key);

  // Determine "empty" per type
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0 && schema.type === 'array');

  if (isRequired && isEmpty) {
    return `${key} is required`;
  }

  if (isEmpty) {
    return null; // optional + empty → ok
  }

  if (schema.type === 'string' && typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `Must be at least ${schema.minLength} characters`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `Must be at most ${schema.maxLength} characters`;
    }
    if (schema.enum && !schema.enum.includes(value)) {
      return `Must be one of: ${schema.enum.join(', ')}`;
    }
    if (schema.format === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      return 'Invalid email';
    }
  }

  if (
    (schema.type === 'number' || schema.type === 'integer') &&
    typeof value !== 'number'
  ) {
    return 'Must be a number';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CommandArgForm({
  spec,
  onSubmit,
  onCancel,
}: CommandArgFormProps): React.ReactElement {
  const schema = castSchema(spec.args_schema);
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  // Initialise state from defaults
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(properties)) {
      if ('default' in prop) {
        init[key] = prop.default;
      } else if (prop.type === 'array') {
        init[key] = [];
      } else if (prop.type === 'boolean') {
        init[key] = false;
      } else {
        init[key] = '';
      }
    }
    return init;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  function set(key: string, val: unknown) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function handleSubmit() {
    const newErrors: Record<string, string> = {};
    for (const [key, prop] of Object.entries(properties)) {
      const err = validateField(key, prop, values[key], required);
      if (err) newErrors[key] = err;
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    onSubmit(values);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{spec.title}</Text>

      {Object.entries(properties).map(([key, prop]) =>
        renderField(key, prop, required, values[key], errors[key], set),
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.button, styles.cancelButton]}
          onPress={onCancel}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.submitButton]}
          onPress={handleSubmit}
          accessibilityRole="button"
        >
          <Text style={styles.submitText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Per-field renderer
// ---------------------------------------------------------------------------

function renderField(
  key: string,
  prop: PropSchema,
  required: string[],
  value: unknown,
  error: string | undefined,
  onChange: (key: string, val: unknown) => void,
): React.ReactElement {
  const label = prop.description ?? key;
  const isRequired = required.includes(key);

  return (
    <View key={key} style={styles.field}>
      <Text style={styles.label}>
        {label}
        {isRequired ? ' *' : ''}
      </Text>

      {renderInput(key, prop, value, onChange)}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function renderInput(
  key: string,
  prop: PropSchema,
  value: unknown,
  onChange: (key: string, val: unknown) => void,
): React.ReactElement {
  // boolean → Switch
  if (prop.type === 'boolean') {
    return (
      <Switch
        accessibilityLabel={key}
        value={Boolean(value)}
        onValueChange={(v) => onChange(key, v)}
      />
    );
  }

  // number / integer → numeric TextInput
  if (prop.type === 'number' || prop.type === 'integer') {
    return (
      <TextInput
        accessibilityLabel={key}
        style={styles.input}
        keyboardType="numeric"
        value={value != null && value !== '' ? String(value) : ''}
        onChangeText={(t) =>
          onChange(key, t === '' ? '' : prop.type === 'integer' ? parseInt(t, 10) : parseFloat(t))
        }
      />
    );
  }

  // array of string → comma-separated TextInput
  if (prop.type === 'array' && prop.items?.type === 'string') {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <TextInput
        accessibilityLabel={key}
        style={styles.input}
        value={arr.join(', ')}
        placeholder="comma-separated"
        onChangeText={(t) =>
          onChange(
            key,
            t
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
      />
    );
  }

  // string + enum (≤6 options) → chip row
  if (prop.type === 'string' && prop.enum && prop.enum.length <= 6) {
    return (
      <View style={styles.chipRow}>
        {prop.enum.map((opt) => (
          <Pressable
            key={opt}
            accessibilityLabel={key}
            style={[styles.chip, value === opt && styles.chipSelected]}
            onPress={() => onChange(key, opt)}
          >
            <Text style={value === opt ? styles.chipTextSelected : styles.chipText}>
              {opt}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  // string (long: name in {body,description} or maxLength>=500) → multiline
  const isLong =
    ['body', 'description'].includes(key) ||
    (prop.maxLength !== undefined && prop.maxLength >= 500);

  // string + email format
  const keyboardType =
    prop.format === 'email' ? ('email-address' as const) : ('default' as const);

  return (
    <TextInput
      accessibilityLabel={key}
      style={[styles.input, isLong && styles.inputMultiline]}
      keyboardType={keyboardType}
      multiline={isLong}
      value={typeof value === 'string' ? value : ''}
      onChangeText={(t) => onChange(key, t)}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles (no ThemeContext dependency — safe for tests without ThemeProvider)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  field: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    color: '#d32f2f',
    fontSize: 12,
    marginTop: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipSelected: {
    backgroundColor: '#1976d2',
    borderColor: '#1976d2',
  },
  chipText: {
    fontSize: 13,
  },
  chipTextSelected: {
    fontSize: 13,
    color: '#fff',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#ccc',
  },
  submitButton: {
    backgroundColor: '#1976d2',
  },
  cancelText: {
    fontSize: 14,
  },
  submitText: {
    fontSize: 14,
    color: '#fff',
  },
});
