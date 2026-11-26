import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchDownload } from '../src/ai/downloadWatch';

describe('Gemini Nano download watch', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a download that never starts (Chrome 158 with too little disk)', () => {
    const onStall = vi.fn();
    watchDownload(30_000, onStall);
    vi.advanceTimersByTime(29_999);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('stays quiet once real progress arrives', () => {
    const onStall = vi.fn();
    const watch = watchDownload(30_000, onStall);
    vi.advanceTimersByTime(5_000);
    watch.progress(0.12);
    vi.advanceTimersByTime(600_000);
    expect(onStall).not.toHaveBeenCalled();
  });

  it('does not count a progress of zero as a started download', () => {
    const onStall = vi.fn();
    const watch = watchDownload(30_000, onStall);
    watch.progress(0);
    vi.advanceTimersByTime(30_000);
    expect(onStall).toHaveBeenCalledTimes(1);
  });

  it('stays quiet after stop', () => {
    const onStall = vi.fn();
    const watch = watchDownload(30_000, onStall);
    watch.stop();
    vi.advanceTimersByTime(60_000);
    expect(onStall).not.toHaveBeenCalled();
  });
});
