/**
 * Unit tests for PlanItemRow component.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { PlanItemRow } from '../../src/screens/planner/components/PlanItemRow';
import { PlanItem } from '../../src/screens/planner/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../src/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      background: '#FFFFFF',
      textPrimary: '#000000',
      textSecondary: '#888888',
      border: '#E5E5EA',
    },
  }),
}));

jest.mock('react-native-draggable-flatlist', () => ({
  ScaleDecorator: ({ children }: any) => children,
}));

// Use fake timers to prevent Animated from leaking into teardown
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.runAllTimers());

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'item-1',
    text: 'Buy milk',
    depth: 0,
    checked: false,
    chips: [],
    ...overrides,
  };
}

const defaultProps = {
  item: makeItem(),
  onCheck: jest.fn(),
  onTextChange: jest.fn(),
  onIndent: jest.fn(),
  onDelete: jest.fn(),
  onAddAfter: jest.fn(),
  onChipRemove: jest.fn(),
  drag: jest.fn(),
  isActive: false,
  inputRef: (_ref: any) => {},
};

// ---------------------------------------------------------------------------
// Helper — recursively find nodes matching a predicate in JSON tree
// ---------------------------------------------------------------------------

function findNode(node: any, predicate: (n: any) => boolean): any {
  if (!node) return null;
  if (predicate(node)) return node;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
  }
  if (node.children) return findNode(node.children, predicate);
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanItemRow', () => {
  it('renders without crashing', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<PlanItemRow {...defaultProps} />);
    });
    expect(renderer!).toBeTruthy();
  });

  it('renders a TextInput with multiline={true}', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<PlanItemRow {...defaultProps} />);
    });

    const json = renderer!.toJSON();
    const multilineInput = findNode(json, n => n?.type === 'TextInput' && n?.props?.multiline === true);
    expect(multilineInput).not.toBeNull();
  });

  it('renders item text in the TextInput', () => {
    const item = makeItem({ text: 'Go to gym' });
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <PlanItemRow {...defaultProps} item={item} />,
      );
    });

    const json = renderer!.toJSON();
    const input = findNode(json, n => n?.type === 'TextInput' && n?.props?.value === 'Go to gym');
    expect(input).not.toBeNull();
  });

  it('TextInput has scrollEnabled={false}', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<PlanItemRow {...defaultProps} />);
    });

    const json = renderer!.toJSON();
    const input = findNode(json, n => n?.type === 'TextInput' && n?.props?.multiline === true);
    expect(input?.props?.scrollEnabled).toBe(false);
  });
});
