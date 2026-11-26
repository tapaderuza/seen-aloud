import { downmix } from './audio';
import { signatureFromRGBA, type FrameSignature } from './scenes';

/** Browser-only helpers: everything here reads the local file, nothing is uploaded. */

export async function loadVideo(url: string): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('This browser cannot decode the video. Try an MP4 (H.264) or WebM file.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', ok);
      video.removeEventListener('error', fail);
    };
    video.addEventListener('loadeddata', ok);
    video.addEventListener('error', fail);
  });
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new Error('The video has no readable duration.');
  }
  return video;
}

export function seekTo(video: HTMLVideoElement, time: number, timeoutMs = 8000): Promise<void> {
  const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', done);
      reject(new Error(`Seeking to ${target.toFixed(2)} s timed out`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = target;
  });
}

/** Samples the whole video at a fixed interval into tiny frame signatures. */
export async function sampleSignatures(
  video: HTMLVideoElement,
  intervalSec: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<FrameSignature[]> {
  const width = 32;
  const height = Math.max(8, Math.round((width * video.videoHeight) / Math.max(1, video.videoWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available.');

  const out: FrameSignature[] = [];
  const steps = Math.max(1, Math.ceil(video.duration / intervalSec));
  for (let i = 0; i < steps; i++) {
    signal?.throwIfAborted();
    const t = i * intervalSec;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, width, height);
    out.push(signatureFromRGBA(t, ctx.getImageData(0, 0, width, height).data, width, height));
    onProgress?.((i + 1) / steps);
  }
  return out;
}

export interface CapturedFrame {
  /** JPEG, base64 without the data: prefix, for the model. */
  base64: string;
  /** Small JPEG data URL for the scene card. */
  thumbnailUrl: string;
}

/** Grabs one frame as JPEG (one of the two image types Gemini Nano accepts). */
export async function captureFrame(video: HTMLVideoElement, time: number, maxWidth = 768): Promise<CapturedFrame> {
  await seekTo(video, time);
  const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available.');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

  const thumb = document.createElement('canvas');
  thumb.width = 192;
  thumb.height = Math.max(1, Math.round((192 * canvas.height) / canvas.width));
  thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height);

  return {
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    thumbnailUrl: thumb.toDataURL('image/jpeg', 0.7),
  };
}

/** Largest file we decode for pause detection; bigger ones need captions. */
const MAX_AUDIO_BYTES = 400 * 1024 * 1024;

/**
 * What pause detection got from the file. `unreadable` covers a file with no
 * audio track and one whose audio this browser cannot decode: Web Audio
 * reports both the same way, so the app cannot tell them apart.
 */
export type Soundtrack =
  | { status: 'decoded'; samples: Float32Array; sampleRate: number }
  | { status: 'too-large'; bytes: number }
  | { status: 'unreadable' };

/** Decodes the soundtrack to 16 kHz mono for pause detection. */
export async function decodeSoundtrack(file: Blob): Promise<Soundtrack> {
  if (file.size > MAX_AUDIO_BYTES) return { status: 'too-large', bytes: file.size };
  const sampleRate = 16000;
  try {
    const ctx = new OfflineAudioContext(1, sampleRate, sampleRate);
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    return { status: 'decoded', samples: downmix(channels), sampleRate: buffer.sampleRate };
  } catch {
    return { status: 'unreadable' };
  }
}
