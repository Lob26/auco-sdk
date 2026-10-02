/**
 * What the e2e may rely on: where the fake frame is served and the control
 * API it exposes as `window.fakeAuco` (driven through `frame.evaluate`).
 */

/** Host pages live on :5173 (packages/e2e); a different port is a different origin. */
export const FAKE_FRAME_PORT = 5174;
export const FAKE_FRAME_ORIGIN = `http://localhost:${FAKE_FRAME_PORT}`;

/** One `message` event the frame window received, as it arrived. */
export interface ReceivedMessage {
  readonly origin: string;
  readonly data: unknown;
  /** `event.source === window.parent`: written by the embedding page. */
  readonly fromParent: boolean;
}

export interface FakeAuco {
  /**
   * The `targetOrigin` every outgoing message uses, or `null` when none could
   * be resolved (then `send`/`sendRaw` throw `unusableReason`).
   */
  readonly parentOrigin: string | null;
  readonly unusableReason: string | null;
  /** Sendable keys: `<id>` or `<id>.<variant>` of every frame→host fixture. */
  fixtures(): string[];
  /** Posts the fixture's `data` verbatim, e.g. `send('frame.close', 'sign')`. */
  send(fixtureId: string, variant?: string): void;
  /** Posts anything, for hostile cases the fixtures do not cover. */
  sendRaw(data: unknown): void;
  /** Every message received since load (or the last `clear`), in order. */
  received(): ReceivedMessage[];
  clear(): void;
  /**
   * Reloads the frame document on the next task, so the `evaluate` that called
   * it returns first. The new document runs its scenario again (by default it
   * posts `frame.ready`) and starts with an empty `received()` log.
   */
  reload(): void;
}

declare global {
  interface Window {
    fakeAuco: FakeAuco;
  }
}
