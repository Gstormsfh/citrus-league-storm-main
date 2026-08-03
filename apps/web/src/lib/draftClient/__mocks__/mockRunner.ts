// F22 structural (2026-08-03 architect ruling): shared mock-runner
// factory typed against the real DraftClientRunner interface.
//
// The mechanism of F22 was THREE hand-copied mock runner classes
// (DraftRoomV2.test.tsx, DraftRoomV2.dr3.test.tsx, DraftRoomV2.f11.test.tsx)
// drifting from the real interface independently. When 11g.10 added
// `setDraftActive` to runner.ts, none of the three mocks got the
// method; every test in all three files threw TypeError before its
// first assertion, and the suite went dark for the entire chunk
// window.
//
// The vi.fn() patch (F22 primary fix) resolved the current instance.
// This module resolves the SPECIES: the type check at line 34 makes
// adding a new public method to DraftClientRunner fail at typecheck
// here — loudly, at authoring — instead of at runtime in a suite
// nobody reads.
//
// USAGE (in a test file):
//
//   import {
//     MockDraftClientRunner,
//     runnerHandles,
//     resetRunnerHandles,
//   } from '@/lib/draftClient/__mocks__/mockRunner';
//
//   vi.mock('@/lib/draftClient/runner', () => ({
//     DraftClientRunner: MockDraftClientRunner,
//   }));
//
//   beforeEach(() => resetRunnerHandles());
//   // Assert on runnerHandles.connect / .setDraftActive / etc.

import { vi, type Mock } from 'vitest';
import type { DraftClientRunner } from '../runner';

/**
 * Public method keys of the real DraftClientRunner class. Derived
 * from the class type via a conditional-type mapping — if a new
 * public method is added to runner.ts, this alias EXPANDS
 * AUTOMATICALLY.
 */
type PublicMethodKeys<T> = {
  [K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T];
type RunnerMethodKey = PublicMethodKeys<DraftClientRunner>;

/**
 * Stable handles object — tests import this and assert on the vi.fn
 * spies. The `satisfies Record<RunnerMethodKey, Mock>` clause is
 * LOAD-BEARING: it fails at typecheck when a new public method is
 * added to DraftClientRunner but no handle is added here. That
 * failure is the whole point — it forces the mock to stay in sync
 * with the real interface, at authoring, not at runtime.
 */
export const runnerHandles = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  getState: vi.fn(() => ({ kind: 'idle' as const })),
  requestResyncForGap: vi.fn(),
  setDraftActive: vi.fn(),
} satisfies Record<RunnerMethodKey, Mock>;

/**
 * Mock class shape. Instances proxy every method to the corresponding
 * runnerHandles.<method>. Constructor is a no-op. Pass this class
 * (or a wrapping factory) to vi.mock's module factory.
 */
export class MockDraftClientRunner {
  connect = runnerHandles.connect;
  disconnect = runnerHandles.disconnect;
  subscribe = runnerHandles.subscribe;
  getState = runnerHandles.getState;
  requestResyncForGap = runnerHandles.requestResyncForGap;
  setDraftActive = runnerHandles.setDraftActive;
}

/**
 * Reset every handle between tests. Preserves the object identity
 * (so previously-constructed MockDraftClientRunner instances still
 * proxy to the SAME `runnerHandles.connect` etc. after reset) — only
 * the spies' internal state clears. Call in beforeEach.
 */
export function resetRunnerHandles(): void {
  runnerHandles.connect.mockReset();
  runnerHandles.disconnect.mockReset();
  runnerHandles.subscribe.mockReset().mockImplementation(() => () => {});
  runnerHandles.getState
    .mockReset()
    .mockImplementation(() => ({ kind: 'idle' as const }));
  runnerHandles.requestResyncForGap.mockReset();
  runnerHandles.setDraftActive.mockReset();
}
