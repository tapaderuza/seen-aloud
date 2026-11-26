import { describe, expect, it, vi } from 'vitest';
import { CloudConsentDeclinedError } from '../src/ai/engine';
import { describeScenes } from '../src/app/pipeline';
import type { Scene, SceneNote } from '../src/core/types';

function scenes(count: number): Scene[] {
  return Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, index: i, start: i * 5, end: (i + 1) * 5, keyframeTime: i * 5 + 1 }));
}

const grab = async () => ({ base64: 'AAAA', thumbnailUrl: 'data:,' });
const callbacks = () => ({ onNote: vi.fn(), onProgress: vi.fn() });

/** An engine that describes every scene except those `fail` returns an error for. */
function engineThat(fail: (scene: Scene) => Error | null) {
  return {
    describeFrame: vi.fn(async (scene: Scene, _count: number, _image: unknown, previous?: string): Promise<SceneNote> => {
      const error = fail(scene);
      if (error) throw error;
      return { sceneId: scene.id, visual: `Scene ${scene.id}${previous ? ` after ${previous}` : ''}`, onScreenText: '', source: 'on_device' };
    }),
  };
}

describe('describing scenes', () => {
  it('leaves one bad scene empty and keeps going', async () => {
    const engine = engineThat((s) => (s.id === 's2' ? new Error('Frame description has no "visual" text') : null));
    const cb = callbacks();
    const { notes, failed } = await describeScenes(scenes(4), engine, grab, cb);
    expect(failed).toBe(1);
    expect(notes.get('s2')).toMatchObject({ visual: '', onScreenText: '' });
    // The next scene's context skips the empty one.
    expect(notes.get('s3')?.visual).toBe('Scene s3 after Scene s1');
    expect(cb.onNote).toHaveBeenCalledTimes(4);
    expect(cb.onProgress).toHaveBeenLastCalledWith(1);
  });

  it('stops at once when the person keeps frames on the device', async () => {
    const engine = engineThat(() => new CloudConsentDeclinedError());
    await expect(describeScenes(scenes(4), engine, grab, callbacks())).rejects.toBeInstanceOf(CloudConsentDeclinedError);
    expect(engine.describeFrame).toHaveBeenCalledTimes(1);
  });

  it('stops when the first scenes all fail, since the problem is not one frame', async () => {
    const engine = engineThat(() => new Error('App Check token is invalid'));
    await expect(describeScenes(scenes(10), engine, grab, callbacks())).rejects.toThrow('App Check');
    expect(engine.describeFrame).toHaveBeenCalledTimes(3);
  });

  it('fails when no scene at all could be described', async () => {
    const engine = engineThat(() => new Error('model busy'));
    await expect(describeScenes(scenes(2), engine, grab, callbacks())).rejects.toThrow('model busy');
  });

  it('drops the answer of a request that was in flight when Stop was pressed', async () => {
    const controller = new AbortController();
    const engine = {
      describeFrame: vi.fn(async (scene: Scene): Promise<SceneNote> => {
        controller.abort(); // Stop pressed while the model was working
        return { sceneId: scene.id, visual: 'A late answer.', onScreenText: '', source: 'in_cloud' };
      }),
    };
    const cb = callbacks();
    await expect(describeScenes(scenes(3), engine, grab, cb, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(cb.onNote).not.toHaveBeenCalled();
  });

  it('stops between scenes when the person presses Stop', async () => {
    const controller = new AbortController();
    const engine = engineThat((s) => {
      if (s.id === 's1') controller.abort();
      return null;
    });
    await expect(describeScenes(scenes(3), engine, grab, callbacks(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(engine.describeFrame).toHaveBeenCalledTimes(1);
  });
});
