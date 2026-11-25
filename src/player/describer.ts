import type { Cue } from '../core/types';
import { speechSeconds } from '../track/budget';

/**
 * How far behind the playhead a line may start and still be spoken when the
 * person presses play or seeks: the line at 0:00, and the one a "Play from"
 * button jumps to, start exactly where playback starts.
 */
const START_SLACK_SEC = 0.05;
/** Chrome sometimes never fires `onend`; past this margin the player stops waiting. */
const WATCHDOG_MARGIN_MS = 4000;

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
  /**
   * Only the newest line may change the player's state. Chrome reports the
   * 'interrupted' end of a cancelled line after the next one is queued.
   */
  private utteranceId = 0;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  /** Chrome can garbage-collect an utterance nothing points to, and then never fire `onend`. */
  private readonly inFlight = new Set<SpeechSynthesisUtterance>();

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
    this.stopSpeech();
    this.video.currentTime = cue.start;
    this.last = cue.start - START_SLACK_SEC;
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
    const resumedByUs = this.pausedByUs;
    if (!resumedByUs) this.stopSpeech();
    this.pausedByUs = false;
    // After our own pause, carry on past the line just spoken. After the person
    // presses play, a line that starts right here must still be spoken.
    this.last = resumedByUs ? this.video.currentTime : this.video.currentTime - START_SLACK_SEC;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
  };

  private readonly onPause = () => {
    cancelAnimationFrame(this.frame);
    if (!this.pausedByUs) this.stopSpeech();
  };

  private readonly onSeek = () => {
    this.last = this.video.currentTime - START_SLACK_SEC;
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
    const id = ++this.utteranceId;
    clearTimeout(this.watchdog);
    this.inFlight.clear();
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
    // While an earlier line still ducks the soundtrack, the level to restore is
    // the one the person chose, not the ducked one.
    if (!this.speaking) this.savedVolume = this.video.volume;
    this.speaking = true;
    this.video.volume = Math.min(this.savedVolume, 0.35);
    const finish = () => {
      if (id !== this.utteranceId) return; // a line that was already replaced or stopped
      this.utteranceId++;
      clearTimeout(this.watchdog);
      this.inFlight.clear();
      this.speaking = false;
      this.video.volume = this.savedVolume;
      this.hideIf(cue.text);
      if (this.pausedByUs) void this.video.play();
    };
    utterance.onend = utterance.onerror = finish;
    // Never leave the video paused for good if Chrome loses `onend` (long lines, network voices).
    this.watchdog = setTimeout(
      () => {
        if (id !== this.utteranceId) return;
        finish();
        speechSynthesis.cancel(); // a stalled line must not start talking over the video later
      },
      speechSeconds(cue.text, 2 * this.options.rate) * 1000 + WATCHDOG_MARGIN_MS,
    );
    this.inFlight.add(utterance);
    speechSynthesis.speak(utterance);
  }

  private hideIf(text: string): void {
    if (this.overlay.textContent === text && !this.speaking) this.overlay.hidden = true;
  }

  private stopSpeech(): void {
    this.utteranceId++; // whatever the cancelled line reports later must not change state
    clearTimeout(this.watchdog);
    this.inFlight.clear();
    if (typeof speechSynthesis !== 'undefined' && this.speaking) speechSynthesis.cancel();
    if (this.speaking) this.video.volume = this.savedVolume;
    this.speaking = false;
    this.pausedByUs = false;
    this.overlay.hidden = true;
  }
}
