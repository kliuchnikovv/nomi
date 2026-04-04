import {
  subscribePlannerAction,
  emitPlannerAction,
} from '../../src/store/plannerActionStore';

describe('plannerActionStore', () => {
  it('delivers payload to the correct chatId subscriber', () => {
    const received: any[] = [];
    const unsub = subscribePlannerAction('chat-A', (p) => received.push(p));

    emitPlannerAction('chat-A', { tool: 'patch_plan_document' });
    expect(received).toHaveLength(1);
    expect(received[0].tool).toBe('patch_plan_document');
    unsub();
  });

  it('does not deliver to a different chatId', () => {
    const received: any[] = [];
    const unsub = subscribePlannerAction('chat-A', (p) => received.push(p));

    emitPlannerAction('chat-B', { tool: 'patch_plan_document' });
    expect(received).toHaveLength(0);
    unsub();
  });

  it('stops delivering after unsubscribe', () => {
    const received: any[] = [];
    const unsub = subscribePlannerAction('chat-A', (p) => received.push(p));
    unsub();

    emitPlannerAction('chat-A', { tool: 'patch_plan_document' });
    expect(received).toHaveLength(0);
  });

  it('allows re-subscribing with a new handler for the same chatId', () => {
    const first: any[] = [];
    const second: any[] = [];
    const unsub1 = subscribePlannerAction('chat-A', (p) => first.push(p));
    const unsub2 = subscribePlannerAction('chat-A', (p) => second.push(p));

    emitPlannerAction('chat-A', { tool: 'ask_user' });
    // Map allows only one per key — last writer wins
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
    unsub1();
    unsub2();
  });

  it('does not remove current handler when a replaced subscription unsubscribes', () => {
    const received: any[] = [];
    const unsub1 = subscribePlannerAction('chat-A', () => {});
    const unsub2 = subscribePlannerAction('chat-A', (p) => received.push(p));
    unsub1(); // should be a no-op since unsub1's handler was replaced
    emitPlannerAction('chat-A', { tool: 'patch_plan_document' });
    expect(received).toHaveLength(1);
    unsub2();
  });
});
