/** Where a piece of text came from. `manual` means the person typed or edited it. */
export type TextSource = 'on_device' | 'in_cloud' | 'manual';

export interface TimeRange {
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds from the start of the video. Always greater than `start`. */
  end: number;
}

export interface Scene extends TimeRange {
  id: string;
  index: number;
  /** The moment we grab a still frame from, away from the cut itself. */
  keyframeTime: number;
}

/** What the vision step saw in one scene's key frame. */
export interface SceneNote {
  sceneId: string;
  visual: string;
  onScreenText: string;
  source: TextSource;
}

/** Where a description can be spoken without covering dialogue. */
export interface CuePlan {
  sceneId: string;
  start: number;
  end: number;
  /** How many words fit in the pause at the configured speaking rate. */
  budgetWords: number;
  /**
   * True when the scene has no pause long enough. The player then pauses the
   * video while it speaks (WCAG 2.2 SC 1.2.7, extended audio description).
   */
  extended: boolean;
}

/** One line of the finished description track. */
export interface Cue extends CuePlan {
  text: string;
  source: TextSource;
}

export interface CaptionCue extends TimeRange {
  text: string;
}

export type DescriptionLanguage = 'en' | 'es';
