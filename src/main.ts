import './styles.css';
import {
  CloudConsentDeclinedError,
  DescriptionEngine,
  PrivacyGuardError,
  type AppMode,
  type DeviceAvailability,
  type Ledger,
} from './ai/engine';
import { watchDownload } from './ai/downloadWatch';
import { FirebaseModelProvider, readDeviceAvailability } from './ai/firebaseProvider';
import { analyzeVideo, type PausesFrom, type Stage } from './app/pipeline';
import { DEFAULT_SETTINGS, type AppSettings } from './config/settings';
import type { CaptionCue, Cue, CuePlan, DescriptionLanguage, Scene, SceneNote, TextSource } from './core/types';
import { connectFirebase, ensureSignedIn, readFirebaseEnv } from './firebase/client';
import { TrackLibrary, type SavedTrack } from './firebase/library';
import { captureFrame, loadVideo } from './media/video';
import { DescriptionPlayer, type VoicePolicy } from './player/describer';
import { LocalTrackLibrary } from './storage/localLibrary';
import { countWords } from './track/budget';
import { reviewCue, reviewSummary } from './track/review';
import { formatTimestamp, parseCaptions, serializeDescriptionsVtt, serializeScript } from './track/vtt';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  deviceStatus: $('device-status'),
  getNano: $<HTMLButtonElement>('get-nano'),
  modeHelp: $('mode-help'),
  deviceHint: $('device-hint'),
  language: $<HTMLSelectElement>('language'),
  banner: $('setup-banner'),
  dropzone: $('dropzone'),
  file: $<HTMLInputElement>('file'),
  captions: $<HTMLInputElement>('captions'),
  captionsNote: $('captions-note'),
  player: $('player'),
  video: $<HTMLVideoElement>('video'),
  overlay: $('overlay'),
  voice: $<HTMLInputElement>('voice'),
  extended: $<HTMLInputElement>('extended'),
  rate: $<HTMLInputElement>('rate'),
  analyze: $<HTMLButtonElement>('analyze'),
  cancel: $<HTMLButtonElement>('cancel'),
  changeVideo: $<HTMLButtonElement>('change-video'),
  progress: $('progress'),
  barFill: $('bar-fill'),
  progressText: $('progress-text'),
  trackEmpty: $('track-empty'),
  cues: $<HTMLOListElement>('cues'),
  downloadVtt: $<HTMLButtonElement>('download-vtt'),
  downloadScript: $<HTMLButtonElement>('download-script'),
  save: $<HTMLButtonElement>('save'),
  mDevice: $('m-device'),
  mCloud: $('m-cloud'),
  mFrames: $('m-frames'),
  ledgerNote: $('ledger-note'),
  log: $<HTMLOListElement>('log'),
  library: $<HTMLUListElement>('library'),
  libraryHint: $('library-hint'),
  consent: $<HTMLDialogElement>('consent'),
};

/** What each mode sends where, stated plainly: text is user content too. */
const MODE_HELP: Record<AppMode, string> = {
  hybrid:
    'Hybrid: Gemini Nano describes each frame on this computer. Then the scene notes, any on-screen text and any caption text near each scene go to Gemini in the cloud as text, to write the finished track. If Nano is missing, you are asked before any frame leaves this computer.',
  private:
    'Private: every AI step runs on Gemini Nano. No frames, descriptions, captions or file names are sent anywhere, saved tracks stay in this browser, and only voices installed on this computer read the track. Needs desktop Chrome with Gemini Nano downloaded.',
  cloud:
    'Cloud: one still frame per scene (JPEG), the scene notes, any on-screen text and any caption text are sent to Gemini in the cloud through Firebase AI Logic. The video file itself is never uploaded. For devices without Gemini Nano.',
};

const LIBRARY_HINT: Record<'private' | 'shared', string> = {
  private: 'Private mode saves tracks only in this browser (IndexedDB). Nothing is sent to Firestore.',
  shared:
    'Hybrid and Cloud mode save tracks in Firestore under an anonymous account: text, timings and the file name, never video or frames. Tracks saved in Private mode stay in this browser.',
};

const DEVICE_TEXT: Record<DeviceAvailability, string> = {
  unsupported: 'Gemini Nano: not in this browser',
  unavailable: 'Gemini Nano: not supported on this device',
  downloadable: 'Gemini Nano: ready to download',
  downloading: 'Gemini Nano: downloading…',
  available: 'Gemini Nano: ready on this device',
};

/** Chrome's own reasons for not downloading are on this page (turn on debugging pages in chrome://chrome-urls first). */
const WHY_NO_DOWNLOAD =
  'Chrome needs about 22 GB free on the drive that holds your Chrome profile and an unmetered connection. chrome://on-device-internals shows its reason under Broker State (turn on debugging pages in chrome://chrome-urls first). Until then, Hybrid asks before any frame goes to the cloud.';

/** What happens next on this machine, for anyone (judges included) whose Chrome has no Gemini Nano yet. */
const DEVICE_HINT: Partial<Record<DeviceAvailability, string>> = {
  unsupported:
    'No Gemini Nano in this browser, so frames would be described in the cloud: Hybrid asks you first, Cloud just runs. To keep frames on this computer, use Google Chrome 148 or later on a desktop (Windows 10 or 11, macOS 13+, Linux or a Chromebook Plus).',
  unavailable:
    'Gemini Nano cannot describe images here, so frames would be described in the cloud: Hybrid asks you first, Cloud just runs. The finished track works the same either way. Chrome needs a GPU with more than 4 GB of memory, or 16 GB of RAM and 4 CPU cores; chrome://on-device-internals shows its reason.',
  downloadable:
    'Press Download Gemini Nano (about 4 GB, once) to describe frames on this computer. Until then, Hybrid asks before any frame goes to the cloud.',
  downloading: `Chrome says Gemini Nano is downloading. If it never finishes: ${WHY_NO_DOWNLOAD}`,
};

/** No download progress this long after the click means Chrome did not start it. */
const DOWNLOAD_STALL_MS = 30_000;

const SOURCE_LABEL: Record<TextSource, string> = {
  on_device: 'On device',
  in_cloud: 'Cloud',
  manual: 'Edited',
};

const state = {
  file: null as File | null,
  videoUrl: '',
  captions: [] as CaptionCue[],
  scenes: [] as Scene[],
  plans: new Map<string, CuePlan>(),
  notes: new Map<string, SceneNote>(),
  thumbs: new Map<string, string>(),
  cues: [] as Cue[],
  running: null as AbortController | null,
  /** Bumped when another video is opened: answers for the old one are dropped. */
  generation: 0,
  /** Jobs in flight; while any runs, the privacy mode and language are locked. */
  busy: 0,
  trackId: '',
  trackStore: 'device' as 'device' | 'cloud',
  settings: DEFAULT_SETTINGS as AppSettings,
  availability: 'unsupported' as DeviceAvailability,
  mode: readPref('mode', 'hybrid') as AppMode,
  language: readPref('language', 'en') as DescriptionLanguage,
};

let engine: DescriptionEngine | null = null;
/** Firestore library, for Hybrid and Cloud mode. Private mode never touches it. */
let cloudLibrary: TrackLibrary | null = null;
const localLibrary = new LocalTrackLibrary();
let analysisVideo: HTMLVideoElement | null = null;
let warnedNoVoice = false;

/** Private mode only speaks with voices installed on this computer: a network voice would send the text away. */
const voicePolicyFor = (mode: AppMode): VoicePolicy => (mode === 'private' ? 'local-only' : 'prefer-local');

const player = new DescriptionPlayer(ui.video, ui.overlay, () => state.cues, {
  voice: readPref('voice', 'true') === 'true',
  extendedPauses: readPref('extended', 'true') === 'true',
  rate: Number(readPref('rate', '1.1')),
  lang: state.language,
  wordsPerSecond: state.settings.wordsPerSecond,
  voicePolicy: voicePolicyFor(state.mode),
  onNoAllowedVoice: (lang) => {
    if (warnedNoVoice) return;
    warnedNoVoice = true;
    ui.progress.hidden = false;
    ui.progressText.classList.remove('error');
    ui.progressText.textContent = `No ${lang === 'es' ? 'Spanish' : 'English'} voice is installed on this computer, so Private mode shows each description as text (screen readers announce it) instead of sending it to a network voice. Install a system voice for this language, or use Hybrid mode.`;
  },
});

void init();

async function init(): Promise<void> {
  // Restore preferences.
  (document.querySelector(`input[name="mode"][value="${state.mode}"]`) as HTMLInputElement | null)?.click();
  ui.language.value = state.language;
  ui.voice.checked = readPref('voice', 'true') === 'true';
  ui.extended.checked = readPref('extended', 'true') === 'true';
  ui.rate.value = readPref('rate', '1.1');
  ui.modeHelp.textContent = MODE_HELP[state.mode];
  bindEvents();

  const env = readFirebaseEnv();
  if (!env) {
    showBanner(
      'Firebase is not configured yet. Copy <code>.env.example</code> to <code>.env.local</code>, fill in your web app config and restart <code>npm run dev</code>. The README explains each value.',
    );
    ui.analyze.disabled = true;
  } else {
    // Until Firebase is ready the button would do nothing, so say so instead.
    ui.analyze.disabled = true;
    ui.analyze.textContent = 'Connecting…';
    try {
      const services = await connectFirebase(env);
      state.settings = services.settings;
      player.setOptions({ wordsPerSecond: state.settings.wordsPerSecond });
      engine = new DescriptionEngine(new FirebaseModelProvider(services.ai, () => state.settings), {
        mode: state.mode,
        language: state.language,
        frameMaxWords: state.settings.frameMaxWords,
        styleNotes: state.settings.styleNotes,
        confirmCloudFrames: askCloudConsent,
        onLedgerChange: renderLedger,
      });
      // Created now, used only outside Private mode: Auth and Firestore start on first use.
      cloudLibrary = new TrackLibrary(services.db, () => ensureSignedIn(services.auth()));
      ui.analyze.disabled = false;
    } catch (error) {
      showBanner(`Could not start Firebase: ${escapeHtml(messageOf(error))}`);
      ui.analyze.disabled = true;
    } finally {
      ui.analyze.textContent = 'Describe this video';
    }
  }
  void refreshLibrary();
  await refreshDevice();
}

/** While a job runs, the privacy mode and language are locked: a run never switches policy halfway. */
function setBusy(delta: 1 | -1): void {
  state.busy = Math.max(0, state.busy + delta);
  const locked = state.busy > 0;
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((input) => (input.disabled = locked));
  ui.language.disabled = locked;
}

function bindEvents(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((input) =>
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.mode = input.value as AppMode;
      writePref('mode', state.mode);
      ui.modeHelp.textContent = MODE_HELP[state.mode];
      engine?.update({ mode: state.mode });
      player.setOptions({ voicePolicy: voicePolicyFor(state.mode) });
      warnedNoVoice = false;
      void refreshDevice();
      void refreshLibrary();
    }),
  );

  ui.language.addEventListener('change', () => {
    state.language = ui.language.value as DescriptionLanguage;
    writePref('language', state.language);
    engine?.update({ language: state.language });
    player.setOptions({ lang: state.language });
    void refreshDevice();
  });

  ui.getNano.addEventListener('click', async () => {
    if (!engine) return;
    ui.getNano.disabled = true;
    ui.deviceStatus.dataset.state = 'downloading';
    ui.deviceStatus.textContent = 'Gemini Nano: starting the download…';
    // Chrome may accept the request and never download (too little disk): say so instead of waiting in silence.
    const watch = watchDownload(DOWNLOAD_STALL_MS, () => {
      ui.deviceStatus.textContent = 'Gemini Nano: Chrome has not started the download';
      ui.deviceHint.textContent = `No download progress after ${DOWNLOAD_STALL_MS / 1000} seconds. ${WHY_NO_DOWNLOAD}`;
      ui.deviceHint.hidden = false;
    });
    try {
      // Must start from this click: Chrome only downloads on a user gesture.
      state.availability = await engine.prepareDevice((fraction) => {
        watch.progress(fraction);
        ui.deviceStatus.dataset.state = 'downloading';
        ui.deviceStatus.textContent = `Downloading Gemini Nano… ${Math.round(fraction * 100)}%`;
      });
    } catch (error) {
      ui.deviceStatus.textContent = `Gemini Nano: ${messageOf(error)}`;
    } finally {
      watch.stop();
      ui.getNano.disabled = false;
      await refreshDevice();
    }
  });

  ui.file.addEventListener('change', () => {
    const file = ui.file.files?.[0];
    if (file) openVideo(file);
    ui.file.value = '';
  });

  // One click for judges and visitors without a video at hand: a 45-second explainer bundled with the site.
  const sampleButton = document.getElementById('sample') as HTMLButtonElement | null;
  sampleButton?.addEventListener('click', async () => {
    sampleButton.disabled = true;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/sample-explainer-45s.mp4`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      openVideo(new File([blob], 'sample-explainer-45s.mp4', { type: 'video/mp4' }));
    } catch (error) {
      ui.progress.hidden = false;
      ui.progressText.classList.add('error');
      ui.progressText.textContent = `Could not load the sample video: ${messageOf(error)}`;
    } finally {
      sampleButton.disabled = false;
    }
  });

  ui.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    ui.dropzone.classList.add('dragging');
  });
  ui.dropzone.addEventListener('dragleave', () => ui.dropzone.classList.remove('dragging'));
  ui.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    ui.dropzone.classList.remove('dragging');
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('video/'));
    if (file) openVideo(file);
  });

  ui.captions.addEventListener('change', async () => {
    const file = ui.captions.files?.[0];
    if (!file) return;
    state.captions = parseCaptions(await file.text());
    ui.captionsNote.textContent = state.captions.length
      ? `${state.captions.length} caption lines loaded from ${file.name}. Descriptions will go in the pauses between them.`
      : `No caption lines found in ${file.name}. Seen Aloud will listen for pauses instead.`;
    ui.captions.value = '';
  });

  ui.changeVideo.addEventListener('click', () => {
    ui.video.pause();
    ui.player.hidden = true;
    ui.dropzone.hidden = false;
    ui.progress.hidden = true;
  });

  ui.voice.addEventListener('change', () => {
    writePref('voice', String(ui.voice.checked));
    player.setOptions({ voice: ui.voice.checked });
  });
  ui.extended.addEventListener('change', () => {
    writePref('extended', String(ui.extended.checked));
    player.setOptions({ extendedPauses: ui.extended.checked });
  });
  ui.rate.addEventListener('change', () => {
    writePref('rate', ui.rate.value);
    player.setOptions({ rate: Number(ui.rate.value) });
  });

  ui.analyze.addEventListener('click', () => void runAnalysis());
  ui.cancel.addEventListener('click', () => {
    if (!state.running) return;
    state.running.abort();
    // A request already sent cannot be recalled; the run stops as soon as it returns, and its answer is dropped.
    ui.progressText.textContent = 'Stopping… a request already on its way is left to finish, and its answer is dropped.';
  });

  ui.downloadVtt.addEventListener('click', () =>
    download(`${baseName()}.descriptions.vtt`, serializeDescriptionsVtt(state.cues, baseName()), 'text/vtt'),
  );
  ui.downloadScript.addEventListener('click', () =>
    download(`${baseName()}.description-script.txt`, serializeScript(state.cues), 'text/plain'),
  );
  ui.save.addEventListener('click', () => void saveTrack());

  ui.video.addEventListener('timeupdate', highlightActiveCue);
}

async function refreshDevice(): Promise<void> {
  state.availability = engine
    ? await engine.refreshAvailability()
    : await readDeviceAvailability(state.language);
  ui.deviceStatus.dataset.state = state.availability;
  ui.deviceStatus.textContent = DEVICE_TEXT[state.availability];
  const hint = state.mode === 'cloud' ? undefined : DEVICE_HINT[state.availability];
  ui.deviceHint.textContent = hint ?? '';
  ui.deviceHint.hidden = !hint;
  ui.getNano.hidden = !engine || !(state.availability === 'downloadable' || state.availability === 'downloading');
}

function openVideo(file: File): void {
  // A new video ends whatever was running for the old one, and drops its answers.
  state.generation++;
  state.running?.abort();
  if (state.videoUrl) URL.revokeObjectURL(state.videoUrl);
  state.file = file;
  state.videoUrl = URL.createObjectURL(file);
  analysisVideo = null;
  ui.video.src = state.videoUrl;
  ui.dropzone.hidden = true;
  ui.player.hidden = false;
  ui.progress.hidden = true;
  resetTrack();
}

function resetTrack(): void {
  state.scenes = [];
  state.plans.clear();
  state.notes.clear();
  state.thumbs.clear();
  state.cues = [];
  state.trackId = '';
  renderCues();
}

async function runAnalysis(): Promise<void> {
  if (!engine || !state.file || state.running) return;
  const controller = new AbortController();
  state.running = controller;
  // Answers that arrive after another video was opened belong to the old one: drop them.
  const generation = state.generation;
  const stale = () => generation !== state.generation;
  setBusy(1);
  resetTrack();
  ui.analyze.disabled = true;
  ui.cancel.hidden = false;
  ui.progress.hidden = false;
  ui.progressText.classList.remove('error');
  setSteps(null);

  try {
    const result = await analyzeVideo(
      state.file,
      engine,
      state.settings,
      {
        onStage: (stage, detail) => {
          if (stale()) return;
          setSteps(stage);
          ui.progressText.textContent = `${detail}…`;
        },
        onProgress: (fraction) => {
          if (stale()) return;
          ui.barFill.style.width = `${Math.round(fraction * 100)}%`;
        },
        onScenes: (scenes, plans) => {
          if (stale()) return;
          state.scenes = scenes;
          state.plans = new Map(plans.map((p) => [p.sceneId, p]));
          renderCues();
        },
        onNote: (note, thumbnailUrl) => {
          if (stale()) return;
          state.notes.set(note.sceneId, note);
          state.thumbs.set(note.sceneId, thumbnailUrl);
          renderCues();
        },
      },
      state.captions,
      controller.signal,
    );
    if (stale()) return;
    state.cues = result.cues;
    renderCues();
    const failed = result.failedScenes;
    const failedNote = failed
      ? ` ${failed} scene${failed === 1 ? '' : 's'} could not be described: write ${failed === 1 ? 'it' : 'them'} by hand or press Describe again.`
      : '';
    ui.progressText.textContent = `Done: ${result.scenes.length} scenes, ${result.cues.filter((c) => c.text).length} descriptions.${pausesSentence(result.pausesFrom, result.pauseNote)} Press play to hear them.${failedNote}`;
  } catch (error) {
    if (stale()) return;
    ui.progressText.classList.add('error');
    ui.progressText.textContent =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'Stopped. Nothing from this run was kept.'
        : error instanceof PrivacyGuardError || error instanceof CloudConsentDeclinedError
          ? error.message
          : friendlyError(error);
  } finally {
    state.running = null;
    setBusy(-1);
    ui.analyze.disabled = false;
    ui.cancel.hidden = true;
    updateExportButtons();
    // Stop and the consent dialog may have held the focus; never leave it on the page body.
    if (!stale() && (!document.activeElement || document.activeElement === document.body)) ui.analyze.focus();
  }
}

function pausesSentence(from: PausesFrom, note?: string): string {
  if (from === 'unknown') {
    return ` Pauses could not be measured: ${note ?? 'the soundtrack could not be read'}. Every description pauses the video so it never covers dialogue; add captions (WebVTT or SRT) for exact timing.`;
  }
  const source = { captions: 'your captions', audio: 'the soundtrack', silent: 'the soundtrack, which is silent' }[from];
  return ` Pauses came from ${source}.`;
}

/** Plain words for the failures a visitor can act on; anything else keeps its own message. */
function friendlyError(error: unknown): string {
  const message = messageOf(error);
  if (/app ?check|recaptcha/iu.test(message)) {
    return 'The cloud model refused the request because this browser did not pass Firebase App Check (reCAPTCHA). Allow www.google.com and www.gstatic.com, or try a normal Chrome window without blockers. With Gemini Nano, Private mode still works.';
  }
  if (/\[(429|500|502|503|504)\b/u.test(message)) {
    return 'The cloud model is busy right now. Wait a minute and press Describe this video again.';
  }
  if (!navigator.onLine || /failed to fetch|networkerror|network request failed|internet_disconnected/iu.test(message)) {
    return 'The cloud could not be reached (this computer may be offline). The cloud steps need a connection; with Gemini Nano installed, Private mode runs on this computer.';
  }
  return `Something went wrong: ${message}`;
}

function setSteps(active: Stage | null): void {
  const order: Stage[] = ['scenes', 'pauses', 'describe', 'script'];
  const index = active === 'done' ? order.length : active ? order.indexOf(active) : -1;
  ui.progress.querySelectorAll<HTMLLIElement>('.steps li').forEach((li, i) => {
    li.dataset.state = i < index ? 'done' : i === index ? 'active' : '';
  });
}

interface Row {
  sceneId: string;
  start: number;
  text: string;
  source: TextSource | null;
  budget: number;
  extended: boolean;
  draft: boolean;
}

function rows(): Row[] {
  if (state.cues.length) {
    return state.cues.map((c) => ({
      sceneId: c.sceneId,
      start: c.start,
      text: c.text,
      source: c.source,
      budget: c.budgetWords,
      extended: c.extended,
      draft: false,
    }));
  }
  return state.scenes.map((s) => {
    const plan = state.plans.get(s.id);
    const note = state.notes.get(s.id);
    return {
      sceneId: s.id,
      start: plan?.start ?? s.start,
      text: note?.visual ?? '',
      source: note?.source ?? null,
      budget: plan?.budgetWords ?? 0,
      extended: plan?.extended ?? false,
      draft: true,
    };
  });
}

function renderCues(): void {
  // Re-rendering replaces every row; keep the keyboard focus on the same control.
  const focused = document.activeElement;
  const focusName = focused instanceof HTMLElement && ui.cues.contains(focused) ? focused.getAttribute('aria-label') : null;
  const list = rows();
  ui.trackEmpty.hidden = list.length > 0;
  ui.cues.replaceChildren(...list.map(renderRow));
  if (focusName) focusInCues(focusName);
  updateExportButtons();
}

function focusInCues(accessibleName: string): void {
  ui.cues.querySelector<HTMLElement>(`[aria-label="${CSS.escape(accessibleName)}"]`)?.focus();
}

function renderRow(row: Row, index: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `cue${row.draft ? ' draft' : ''}`;
  li.dataset.id = row.sceneId;

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.alt = '';
  const src = state.thumbs.get(row.sceneId);
  if (src) thumb.src = src;
  li.append(thumb);

  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'cue-meta';

  const time = document.createElement('button');
  time.type = 'button';
  time.className = 'time';
  time.textContent = shortTime(row.start);
  time.setAttribute('aria-label', `Play from ${formatTimestamp(row.start)}`);
  time.addEventListener('click', () => {
    const cue = state.cues.find((c) => c.sceneId === row.sceneId);
    if (cue && !ui.player.hidden) player.preview(cue);
    else if (!ui.player.hidden) ui.video.currentTime = row.start;
  });
  meta.append(time);

  // An empty line (a scene that could not be described) has no source to show.
  if (row.source && row.text.trim()) meta.append(badge(SOURCE_LABEL[row.source], row.source));
  if (row.extended) meta.append(badge('Pauses video', 'extended'));
  if (!row.draft) {
    // Local checks only: no model is asked. "Checks passed" is not a guarantee the line is right.
    const cue = state.cues[index];
    const flags = cue ? reviewCue(cue, state.notes.get(row.sceneId), state.cues[index - 1]?.text) : [];
    const review = flags.length ? badge('Needs review', 'review') : badge('Checks passed', 'checked');
    review.title = flags.length ? reviewSummary(flags) : 'Passed the local checks: not empty, fits its pause, no new numbers, no repeat.';
    review.setAttribute('aria-label', flags.length ? `Needs review: ${reviewSummary(flags)}` : 'Local checks passed');
    meta.append(review);
  }
  const words = document.createElement('span');
  const count = countWords(row.text);
  words.className = `words${row.budget && count > row.budget ? ' over' : ''}`;
  words.textContent = row.draft ? (row.text ? 'draft' : 'waiting…') : `${count}/${row.budget} words`;
  words.id = `words-${row.sceneId}`;
  // Announced politely while editing, so a screen-reader user hears when a line runs over its pause.
  words.setAttribute('aria-live', 'polite');
  meta.append(words);
  body.append(meta);

  const textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.value = row.text;
  textarea.readOnly = row.draft;
  textarea.setAttribute('aria-label', `Description for scene ${index + 1}, at ${formatTimestamp(row.start)}`);
  textarea.setAttribute('aria-describedby', words.id);
  textarea.addEventListener('input', () => {
    const cue = state.cues.find((c) => c.sceneId === row.sceneId);
    if (!cue) return;
    cue.text = textarea.value;
    cue.source = 'manual';
    const n = countWords(cue.text);
    const over = n > cue.budgetWords;
    words.textContent = over
      ? `${n}/${cue.budgetWords} words, too long for the pause`
      : `${n}/${cue.budgetWords} words`;
    words.classList.toggle('over', over);
  });
  body.append(textarea);

  if (!row.draft) {
    const actions = document.createElement('div');
    actions.className = 'cue-actions';
    actions.append(
      actionButton('Fit to pause', () => fitCue(row.sceneId), `Fit scene ${index + 1} to its pause`),
      actionButton('Describe again', () => redescribe(row.sceneId), `Describe scene ${index + 1} again`),
    );
    body.append(actions);
  }
  li.append(body);
  return li;
}

function badge(text: string, kind: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = `badge ${kind}`;
  span.textContent = text;
  return span;
}

function actionButton(label: string, run: () => Promise<void>, accessibleName?: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link';
  button.textContent = label;
  if (accessibleName) button.setAttribute('aria-label', accessibleName);
  button.addEventListener('click', async () => {
    button.disabled = true;
    setBusy(1);
    try {
      await run();
    } catch (error) {
      ui.progress.hidden = false;
      ui.progressText.classList.add('error');
      ui.progressText.textContent =
        error instanceof PrivacyGuardError || error instanceof CloudConsentDeclinedError ? error.message : friendlyError(error);
    } finally {
      setBusy(-1);
      button.disabled = false;
      // The row was re-rendered while this ran: if the focus fell to the page body, put it
      // back on the same action in the new row.
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && !button.isConnected && accessibleName) focusInCues(accessibleName);
    }
  });
  return button;
}

async function fitCue(sceneId: string): Promise<void> {
  const index = state.cues.findIndex((c) => c.sceneId === sceneId);
  if (!engine || index < 0) return;
  const cue = state.cues[index];
  const generation = state.generation;
  const result = await engine.fit(cue.text, cue.budgetWords, state.cues[index - 1]?.text);
  if (generation !== state.generation) return; // another video was opened meanwhile
  cue.text = result.text;
  cue.source = result.source ?? cue.source;
  renderCues();
}

async function redescribe(sceneId: string): Promise<void> {
  const scene = state.scenes.find((s) => s.id === sceneId);
  const cue = state.cues.find((c) => c.sceneId === sceneId);
  if (!engine || !scene || !cue || !state.videoUrl) return;
  const generation = state.generation;
  analysisVideo ??= await loadVideo(state.videoUrl);
  const frame = await captureFrame(analysisVideo, scene.keyframeTime);
  const previous = state.cues[state.cues.indexOf(cue) - 1]?.text;
  const note = await engine.describeFrame(scene, state.scenes.length, { mimeType: 'image/jpeg', data: frame.base64 }, previous);
  const fitted = await engine.fit(note.visual, cue.budgetWords, previous);
  if (generation !== state.generation) return; // another video was opened meanwhile
  cue.text = fitted.text;
  cue.source = fitted.source ?? note.source;
  state.thumbs.set(sceneId, frame.thumbnailUrl);
  renderCues();
}

function highlightActiveCue(): void {
  const t = ui.video.currentTime;
  const active = state.cues.find((c) => t >= c.start && t < c.end);
  ui.cues.querySelectorAll<HTMLLIElement>('.cue').forEach((li) => {
    li.classList.toggle('active', li.dataset.id === active?.sceneId);
  });
}

function updateExportButtons(): void {
  const ready = state.cues.some((c) => c.text.trim()) && !state.running;
  ui.downloadVtt.disabled = !ready;
  ui.downloadScript.disabled = !ready;
  ui.save.disabled = !ready;
}

function renderLedger(ledger: Ledger): void {
  ui.mDevice.textContent = String(ledger.onDevice);
  ui.mCloud.textContent = String(ledger.inCloud);
  // A frame whose cloud request failed may still have been uploaded, so it counts as having left.
  const left = ledger.framesInCloud + ledger.framesMaybeInCloud;
  ui.mFrames.textContent = String(left);
  (ui.mFrames.parentElement as HTMLElement).dataset.nonzero = String(left > 0);
  ui.ledgerNote.textContent =
    left === 0
      ? `${ledger.framesOnDevice} frame${ledger.framesOnDevice === 1 ? '' : 's'} described on this computer. No pixels have left it.`
      : ledger.framesMaybeInCloud > 0
        ? `${left} frame${left === 1 ? '' : 's'} may have left this computer: ${ledger.framesInCloud} described in the cloud, ${ledger.framesMaybeInCloud} in cloud requests that failed.`
        : `${ledger.framesInCloud} frame${ledger.framesInCloud === 1 ? '' : 's'} were described in the cloud.`;
  if (ledger.retries > 0) {
    // One inference can be several network requests; say so rather than hide it.
    ui.ledgerNote.textContent += ` ${ledger.retries} cloud request${ledger.retries === 1 ? ' was' : 's were'} sent again after a busy answer.`;
  }
  const taskLabel = { frameNote: 'Frame', script: 'Script', fit: 'Fit' } as const;
  ui.log.replaceChildren(
    ...ledger.events
      .slice(-60)
      .reverse()
      .map((event) => {
        const li = document.createElement('li');
        const where = event.source ? SOURCE_LABEL[event.source] : 'Note';
        li.textContent = `${taskLabel[event.task]} · ${where}${event.ms ? ` · ${event.ms} ms` : ''}${event.note ? ` · ${event.note}` : ''}`;
        return li;
      }),
  );
}

async function saveTrack(): Promise<void> {
  if (!engine || !state.cues.length) return;
  // Private mode keeps saved tracks in this browser; Hybrid and Cloud use Firestore when it is set up.
  const where: 'device' | 'cloud' = state.mode === 'private' || !cloudLibrary ? 'device' : 'cloud';
  // A track id belongs to one store; saving it somewhere else makes a new track.
  const id = state.trackStore === where ? state.trackId : '';
  ui.save.disabled = true;
  try {
    const track: SavedTrack = {
      id,
      title: baseName(),
      fileName: state.file?.name ?? '',
      durationSec: Number.isFinite(ui.video.duration) ? ui.video.duration : 0,
      language: state.language,
      mode: state.mode,
      cues: state.cues,
      ledger: {
        onDevice: engine.ledger.onDevice,
        inCloud: engine.ledger.inCloud,
        framesOnDevice: engine.ledger.framesOnDevice,
        framesInCloud: engine.ledger.framesInCloud,
      },
      updatedAt: 0,
    };
    state.trackId = where === 'device' ? await localLibrary.save(track) : await cloudLibrary!.save(track);
    state.trackStore = where;
    ui.save.textContent = where === 'device' ? 'Saved in this browser' : 'Saved';
    setTimeout(() => (ui.save.textContent = 'Save'), 2000);
    await refreshLibrary();
  } catch (error) {
    ui.progress.hidden = false;
    ui.progressText.classList.add('error');
    ui.progressText.textContent = `Could not save: ${messageOf(error)}`;
  } finally {
    updateExportButtons();
  }
}

async function refreshLibrary(): Promise<void> {
  ui.libraryHint.textContent = LIBRARY_HINT[state.mode === 'private' ? 'private' : 'shared'];
  const rows: Array<{ track: SavedTrack; where: 'device' | 'cloud' }> = [];
  const problems: string[] = [];
  try {
    rows.push(...(await localLibrary.list()).map((track) => ({ track, where: 'device' as const })));
  } catch (error) {
    problems.push(`This browser's library is unavailable: ${messageOf(error)}`);
  }
  // Private mode never signs in or talks to Firestore, so it lists only this browser's tracks.
  if (state.mode !== 'private' && cloudLibrary) {
    try {
      rows.push(...(await cloudLibrary.list()).map((track) => ({ track, where: 'cloud' as const })));
    } catch (error) {
      problems.push(`Cloud library unavailable: ${messageOf(error)}`);
    }
  }
  rows.sort((a, b) => b.track.updatedAt - a.track.updatedAt);
  const items = rows.map(({ track, where }) => renderSaved(track, where));
  for (const problem of problems) {
    const li = document.createElement('li');
    li.textContent = problem;
    items.push(li);
  }
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = 'Nothing saved yet.';
    items.push(li);
  }
  ui.library.replaceChildren(...items);
}

function renderSaved(track: SavedTrack, where: 'device' | 'cloud'): HTMLLIElement {
  const li = document.createElement('li');
  const info = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = track.title;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const when = track.updatedAt ? new Date(track.updatedAt).toLocaleString() : 'saving…';
  meta.textContent = `${where === 'device' ? 'This browser' : 'Cloud'} · ${track.cues.length} lines · ${track.ledger.onDevice} on device, ${track.ledger.inCloud} cloud · ${when}`;
  info.append(title, meta);

  const actions = document.createElement('div');
  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'link';
  load.textContent = 'Load';
  load.setAttribute('aria-label', `Load saved track "${track.title}"`);
  load.addEventListener('click', () => {
    state.cues = track.cues.map((c) => ({ ...c }));
    state.trackId = track.id;
    state.trackStore = where;
    state.scenes = track.cues.map((c, i) => ({ id: c.sceneId, index: i, start: c.start, end: c.end, keyframeTime: c.start }));
    renderCues();
    ui.progress.hidden = false;
    ui.progressText.classList.remove('error');
    ui.progressText.textContent = state.file
      ? `Loaded "${track.title}".`
      : `Loaded "${track.title}". Open ${track.fileName || 'the same video'} to play it with descriptions.`;
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link';
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete saved track "${track.title}"`);
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete the saved track "${track.title}"? This cannot be undone.`)) return;
    try {
      if (where === 'device') await localLibrary.remove(track.id);
      else await cloudLibrary?.remove(track.id);
    } catch (error) {
      ui.progress.hidden = false;
      ui.progressText.classList.add('error');
      ui.progressText.textContent = `Could not delete: ${messageOf(error)}`;
    }
    await refreshLibrary();
  });
  actions.append(load, document.createTextNode(' · '), remove);
  li.append(info, actions);
  return li;
}

function askCloudConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    ui.consent.returnValue = '';
    ui.consent.addEventListener(
      'close',
      () => {
        const allowed = ui.consent.returnValue === 'yes';
        // The dialog hands focus back to Describe, which is disabled while the job runs.
        if (allowed && !ui.cancel.hidden) ui.cancel.focus();
        resolve(allowed);
      },
      { once: true },
    );
    ui.consent.showModal();
  });
}

function showBanner(html: string): void {
  ui.banner.innerHTML = html;
  ui.banner.hidden = false;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseName(): string {
  return (state.file?.name ?? 'video').replace(/\.[^.]+$/u, '') || 'video';
}

function shortTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (c) => `&#${c.charCodeAt(0)};`);
}

function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(`seen-aloud:${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(`seen-aloud:${key}`, value);
  } catch {
    // Preferences are a convenience; private windows may block storage.
  }
}
