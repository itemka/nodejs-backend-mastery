import type { Clock } from '../../src/shared/clock.js';

/** A clock that moves only when a test advances it. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: Date | string) {
    this.current = new Date(start).getTime();
  }

  advance(ms: number): void {
    this.current += ms;
  }

  now(): Date {
    return new Date(this.current);
  }
}
