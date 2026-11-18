import type { Cue } from '../core/types';
import { speechSeconds } from '../track/budget';

/** The cue whose start was crossed between two playback positions, if any. */
export function cueCrossed(cues: readonly Cue[], from: number, to: number): Cue | null {
  if (to <= from || to - from > 1.5) return null; // a seek, not playback
  for (const cue of cues) {
    if (cue.text.trim() && cue.start > from && cue.start <= to) return cue;
  }
  return null;
}

/** Pause the video when the description would overrun the pause it sits in. */
export function needsPause(cue: Cue, wordsPerSecond: number): boolean {
  return cue.extended || speechSeconds(cue.text, wordsPerSecond) > cue.end - cue.start + 0.3;
}

export interface DescriberOptions {
  voice: boolean;
  extendedPauses: boolean;
  rate: number;
  lang: string;
  wordsPerSecond: number;
}

/**
 * Plays the description track over a <video>: shows each line, speaks it with
 * the browser's speech synthesis, lowers the soundtrack while speaking, and
 * pauses the video for descriptions that do not fit (extended description).
 */
export class DescriptionPlayer {
  private last = 0;
  private frame = 0;
  private pausedByUs = false;
  private speaking = false;
  private savedVolume = 1;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly overlay: HTMLElement,
    private readonly cues: () => readonly Cue[],
    private options: DescriberOptions,
  ) {
    video.addEventListener('play', this.onPlay);
    video.addEventListener('pause', this.onPause);
    video.addEventListener('seeking', this.onSeek);
  }

  setOptions(options: Partial<DescriberOptions>): void {
    this.options = { ...this.options, ...options };
    if (!this.options.voice) this.stopSpeech();
  }

  /** Speaks one cue now (used by the "play from here" buttons). */
  preview(cue: Cue): void {
    this.video.currentTime = cue.start;
    this.last = cue.start - 0.01;
    void this.video.play();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.stopSpeech();
    this.video.removeEventListener('play', this.onPlay);
    this.video.removeEventListener('pause', this.onPause);
    this.video.removeEventListener('seeking', this.onSeek);
  }

  private readonly onPlay = () => {
    if (!this.pausedByUs) this.stopSpeech();
    this.pausedByUs = false;
    this.last = this.video.currentTime;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
  };

  private readonly onPause = () => {
    cancelAnimationFrame(this.frame);
    if (!this.pausedByUs) this.stopSpeech();
  };

  private readonly onSeek = () => {
    this.last = this.video.currentTime;
    if (!this.pausedByUs) this.stopSpeech();
  };

  private readonly tick = () => {
    const now = this.video.currentTime;
    const cue = cueCrossed(this.cues(), this.last, now);
    this.last = now;
    if (cue) this.say(cue);
    if (!this.video.paused) this.frame = requestAnimationFrame(this.tick);
  };

  private say(cue: Cue): void {
    this.overlay.textContent = cue.text;
    this.overlay.hidden = false;
    if (!this.options.voice || typeof speechSynthesis === 'undefined') {
      window.setTimeout(() => this.hideIf(cue.text), Math.max(1500, (cue.end - cue.start) * 1000));
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cue.text);
    utterance.lang = this.options.lang;
    utterance.rate = this.options.rate;
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(this.options.lang));
    if (voice) utterance.voice = voice;

    if (this.options.extendedPauses && needsPause(cue, this.options.wordsPerSecond * this.options.rate)) {
      this.pausedByUs = true;
      this.video.pause();
    }
    this.speaking = true;
    this.savedVolume = this.video.volume;
    this.video.volume = Math.min(this.savedVolume, 0.35);
    utterance.onend = utterance.onerror = () => {
      this.speaking = false;
      this.video.volume = this.savedVolume;
      this.hideIf(cue.text);
      if (this.pausedByUs) void this.video.play();
    };
    speechSynthesis.speak(utterance);
  }

  private hideIf(text: string): void {
    if (this.overlay.textContent === text && !this.speaking) this.overlay.hidden = true;
  }

  private stopSpeech(): void {
    if (typeof speechSynthesis !== 'undefined' && this.speaking) speechSynthesis.cancel();
    if (this.speaking) this.video.volume = this.savedVolume;
    this.speaking = false;
    this.pausedByUs = false;
    this.overlay.hidden = true;
  }
}
