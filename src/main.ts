import './styles.css';
import {
  CloudConsentDeclinedError,
  DescriptionEngine,
  PrivacyGuardError,
  type AppMode,
  type DeviceAvailability,
  type Ledger,
} from './ai/engine';
import { FirebaseModelProvider, readDeviceAvailability } from './ai/firebaseProvider';
import { analyzeVideo, type Stage } from './app/pipeline';
import { DEFAULT_SETTINGS, type AppSettings } from './config/settings';
import type { CaptionCue, Cue, CuePlan, DescriptionLanguage, Scene, SceneNote, TextSource } from './core/types';
import { connectFirebase, ensureSignedIn, readFirebaseEnv } from './firebase/client';
import { TrackLibrary, type SavedTrack } from './firebase/library';
import { captureFrame, loadVideo } from './media/video';
import { DescriptionPlayer } from './player/describer';
import { countWords } from './track/budget';
import { formatTimestamp, parseCaptions, serializeDescriptionsVtt, serializeScript } from './track/vtt';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  deviceStatus: $('device-status'),
  getNano: $<HTMLButtonElement>('get-nano'),
  modeHelp: $('mode-help'),
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
  consent: $<HTMLDialogElement>('consent'),
};

const MODE_HELP: Record<AppMode, string> = {
  hybrid:
    'Hybrid: Gemini Nano describes every frame on this computer, then Gemini in the cloud writes the finished track from text only. If Nano is missing you are asked before any frame leaves this computer.',
  private:
    'Private: every step runs on Gemini Nano and nothing is sent to the cloud. Needs Chrome on a desktop with Gemini Nano downloaded.',
  cloud: 'Cloud: every step runs on Gemini in the cloud through Firebase AI Logic. For devices without Gemini Nano.',
};

const DEVICE_TEXT: Record<DeviceAvailability, string> = {
  unsupported: 'Gemini Nano: not in this browser',
  unavailable: 'Gemini Nano: not supported on this device',
  downloadable: 'Gemini Nano: ready to download',
  downloading: 'Gemini Nano: downloading…',
  available: 'Gemini Nano: ready on this device',
};

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
  trackId: '',
  settings: DEFAULT_SETTINGS as AppSettings,
  availability: 'unsupported' as DeviceAvailability,
  mode: readPref('mode', 'hybrid') as AppMode,
  language: readPref('language', 'en') as DescriptionLanguage,
};

let engine: DescriptionEngine | null = null;
let library: TrackLibrary | null = null;
let analysisVideo: HTMLVideoElement | null = null;

const player = new DescriptionPlayer(ui.video, ui.overlay, () => state.cues, {
  voice: readPref('voice', 'true') === 'true',
  extendedPauses: readPref('extended', 'true') === 'true',
  rate: Number(readPref('rate', '1.1')),
  lang: state.language,
  wordsPerSecond: state.settings.wordsPerSecond,
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
      library = new TrackLibrary(services.db, () => ensureSignedIn(services.auth));
      void refreshLibrary();
    } catch (error) {
      showBanner(`Could not start Firebase: ${escapeHtml(messageOf(error))}`);
      ui.analyze.disabled = true;
    }
  }
  await refreshDevice();
}

function bindEvents(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((input) =>
    input.addEventListener('change', () => {
      if (!input.checked) return;
      state.mode = input.value as AppMode;
      writePref('mode', state.mode);
      ui.modeHelp.textContent = MODE_HELP[state.mode];
      engine?.update({ mode: state.mode });
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
    try {
      // Must start from this click: Chrome only downloads on a user gesture.
      state.availability = await engine.prepareDevice((fraction) => {
        ui.deviceStatus.dataset.state = 'downloading';
        ui.deviceStatus.textContent = `Downloading Gemini Nano… ${Math.round(fraction * 100)}%`;
      });
    } catch (error) {
      ui.deviceStatus.textContent = `Gemini Nano: ${messageOf(error)}`;
    } finally {
      ui.getNano.disabled = false;
      await refreshDevice();
    }
  });

  ui.file.addEventListener('change', () => {
    const file = ui.file.files?.[0];
    if (file) openVideo(file);
    ui.file.value = '';
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
  ui.cancel.addEventListener('click', () => state.running?.abort());

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
  ui.getNano.hidden = !engine || !(state.availability === 'downloadable' || state.availability === 'downloading');
}

function openVideo(file: File): void {
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
          setSteps(stage);
          ui.progressText.textContent = `${detail}…`;
        },
        onProgress: (fraction) => {
          ui.barFill.style.width = `${Math.round(fraction * 100)}%`;
        },
        onScenes: (scenes, plans) => {
          state.scenes = scenes;
          state.plans = new Map(plans.map((p) => [p.sceneId, p]));
          renderCues();
        },
        onNote: (note, thumbnailUrl) => {
          state.notes.set(note.sceneId, note);
          state.thumbs.set(note.sceneId, thumbnailUrl);
          renderCues();
        },
      },
      state.captions,
      controller.signal,
    );
    state.cues = result.cues;
    renderCues();
    const pauses = { captions: 'your captions', audio: 'the soundtrack', none: 'no soundtrack (silent video)' }[result.pausesFrom];
    ui.progressText.textContent = `Done: ${result.scenes.length} scenes, ${result.cues.filter((c) => c.text).length} descriptions. Pauses came from ${pauses}. Press play to hear them.`;
  } catch (error) {
    ui.progressText.classList.add('error');
    ui.progressText.textContent =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'Stopped.'
        : error instanceof PrivacyGuardError || error instanceof CloudConsentDeclinedError
          ? error.message
          : `Something went wrong: ${messageOf(error)}`;
  } finally {
    state.running = null;
    ui.analyze.disabled = false;
    ui.cancel.hidden = true;
    updateExportButtons();
  }
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
  const list = rows();
  ui.trackEmpty.hidden = list.length > 0;
  ui.cues.replaceChildren(...list.map(renderRow));
  updateExportButtons();
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

  if (row.source) meta.append(badge(SOURCE_LABEL[row.source], row.source));
  if (row.extended) meta.append(badge('Pauses video', 'extended'));
  const words = document.createElement('span');
  const count = countWords(row.text);
  words.className = `words${row.budget && count > row.budget ? ' over' : ''}`;
  words.textContent = row.draft ? (row.text ? 'draft' : 'waiting…') : `${count}/${row.budget} words`;
  meta.append(words);
  body.append(meta);

  const textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.value = row.text;
  textarea.readOnly = row.draft;
  textarea.setAttribute('aria-label', `Description for scene ${index + 1}, at ${formatTimestamp(row.start)}`);
  textarea.addEventListener('input', () => {
    const cue = state.cues.find((c) => c.sceneId === row.sceneId);
    if (!cue) return;
    cue.text = textarea.value;
    cue.source = 'manual';
    const n = countWords(cue.text);
    words.textContent = `${n}/${cue.budgetWords} words`;
    words.classList.toggle('over', n > cue.budgetWords);
  });
  body.append(textarea);

  if (!row.draft) {
    const actions = document.createElement('div');
    actions.className = 'cue-actions';
    actions.append(
      actionButton('Fit to pause', () => fitCue(row.sceneId)),
      actionButton('Describe again', () => redescribe(row.sceneId)),
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

function actionButton(label: string, run: () => Promise<void>): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link';
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await run();
    } catch (error) {
      ui.progress.hidden = false;
      ui.progressText.classList.add('error');
      ui.progressText.textContent = messageOf(error);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

async function fitCue(sceneId: string): Promise<void> {
  const index = state.cues.findIndex((c) => c.sceneId === sceneId);
  if (!engine || index < 0) return;
  const cue = state.cues[index];
  const result = await engine.fit(cue.text, cue.budgetWords, state.cues[index - 1]?.text);
  cue.text = result.text;
  cue.source = result.source ?? cue.source;
  renderCues();
}

async function redescribe(sceneId: string): Promise<void> {
  const scene = state.scenes.find((s) => s.id === sceneId);
  const cue = state.cues.find((c) => c.sceneId === sceneId);
  if (!engine || !scene || !cue || !state.videoUrl) return;
  analysisVideo ??= await loadVideo(state.videoUrl);
  const frame = await captureFrame(analysisVideo, scene.keyframeTime);
  const previous = state.cues[state.cues.indexOf(cue) - 1]?.text;
  const note = await engine.describeFrame(scene, state.scenes.length, { mimeType: 'image/jpeg', data: frame.base64 }, previous);
  const fitted = await engine.fit(note.visual, cue.budgetWords, previous);
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
  ui.save.disabled = !ready || !library;
}

function renderLedger(ledger: Ledger): void {
  ui.mDevice.textContent = String(ledger.onDevice);
  ui.mCloud.textContent = String(ledger.inCloud);
  ui.mFrames.textContent = String(ledger.framesInCloud);
  (ui.mFrames.parentElement as HTMLElement).dataset.nonzero = String(ledger.framesInCloud > 0);
  ui.ledgerNote.textContent =
    ledger.framesInCloud === 0
      ? `${ledger.framesOnDevice} frame${ledger.framesOnDevice === 1 ? '' : 's'} described on this computer. No pixels have left it.`
      : `${ledger.framesInCloud} frame${ledger.framesInCloud === 1 ? '' : 's'} were described in the cloud because Gemini Nano was not available.`;
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
  if (!library || !engine || !state.cues.length) return;
  ui.save.disabled = true;
  try {
    const track: SavedTrack = {
      id: state.trackId,
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
    state.trackId = await library.save(track);
    ui.save.textContent = 'Saved';
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
  if (!library) return;
  try {
    const tracks = await library.list();
    if (!tracks.length) {
      const li = document.createElement('li');
      li.textContent = 'Nothing saved yet.';
      ui.library.replaceChildren(li);
      return;
    }
    ui.library.replaceChildren(...tracks.map(renderSaved));
  } catch (error) {
    const li = document.createElement('li');
    li.textContent = `Library unavailable: ${messageOf(error)}`;
    ui.library.replaceChildren(li);
  }
}

function renderSaved(track: SavedTrack): HTMLLIElement {
  const li = document.createElement('li');
  const info = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = track.title;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const when = track.updatedAt ? new Date(track.updatedAt).toLocaleString() : 'saving…';
  meta.textContent = `${track.cues.length} lines · ${track.ledger.onDevice} on device, ${track.ledger.inCloud} cloud · ${when}`;
  info.append(title, meta);

  const actions = document.createElement('div');
  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'link';
  load.textContent = 'Load';
  load.addEventListener('click', () => {
    state.cues = track.cues.map((c) => ({ ...c }));
    state.trackId = track.id;
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
  remove.addEventListener('click', async () => {
    if (!library || !confirm(`Delete the saved track "${track.title}"? This cannot be undone.`)) return;
    await library.remove(track.id);
    await refreshLibrary();
  });
  actions.append(load, document.createTextNode(' · '), remove);
  li.append(info, actions);
  return li;
}

function askCloudConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    ui.consent.returnValue = '';
    ui.consent.addEventListener('close', () => resolve(ui.consent.returnValue === 'yes'), { once: true });
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
