/**
 * Watches a Gemini Nano download that Chrome may never start.
 *
 * Seen on Chrome 158: with too little free disk on the drive that holds the
 * Chrome profile (Chrome asks for about 22 GB), `LanguageModel.availability()`
 * still says `downloadable`, then `downloading` after the click, but no
 * download progress ever arrives and `create()` never settles. Without this
 * watch the app would wait forever with no explanation.
 */
export interface DownloadWatch {
  /** Chrome reported progress. Only a fraction above 0 counts as a started download. */
  progress(fraction: number): void;
  /** The download finished or failed: no stall notice after this. */
  stop(): void;
}

export function watchDownload(stallMs: number, onStall: () => void): DownloadWatch {
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    onStall();
  }, stallMs);
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    progress: (fraction) => {
      if (fraction > 0) clear();
    },
    stop: clear,
  };
}
