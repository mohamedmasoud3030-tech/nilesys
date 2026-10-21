/**
 * Finding N-1 — an idle pooled connection killed by the server must not take the API down.
 *
 * On 2026-10-14, PostgreSQL 18.4 terminating an idle pooled client (SQLSTATE 57P01, pg 8.23.1)
 * raised an `error` event on the Pool. An EventEmitter `error` with no listener throws, and the API
 * process exited. `attachPoolErrorHandler` in `engines/db/open.ts` is the fix.
 *
 * This file tests the wiring. The end-to-end test — kill a real backend while the pool is idle and
 * assert the process survives — needs a live PostgreSQL server and is listed as such in STATUS.md.
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachPoolErrorHandler } from '../open.js';

afterEach(() => vi.restoreAllMocks());

describe('N-1 pool error listener', () => {
  it('without a listener an emitted error throws — this is the crash being fixed', () => {
    const pool = new EventEmitter();
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).toThrow(
      /terminating connection/,
    );
  });

  it('with the handler attached the process survives and the error is reported', () => {
    const pool = new EventEmitter();
    const seen: string[] = [];
    attachPoolErrorHandler(pool as any, (err) => seen.push(err.message));

    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    expect(seen).toEqual(['terminating connection due to administrator command']);
  });

  it('the default handler logs instead of throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = new EventEmitter();
    attachPoolErrorHandler(pool as any);

    expect(() => pool.emit('error', new Error('57P01'))).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]?.[1])).toContain('57P01');
  });

  it('several idle-connection deaths in a row are all absorbed', () => {
    const pool = new EventEmitter();
    const seen: string[] = [];
    attachPoolErrorHandler(pool as any, (err) => seen.push(err.message));
    for (let i = 0; i < 3; i++) pool.emit('error', new Error(`kill-${i}`));
    expect(seen).toEqual(['kill-0', 'kill-1', 'kill-2']);
  });
});
