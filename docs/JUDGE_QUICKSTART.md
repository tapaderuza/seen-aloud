# Judge quickstart (about 5 minutes)

**Production:** https://seen-aloud.web.app · **Code:** https://github.com/tapaderuza/seen-aloud (Apache-2.0)

## Requirements

- Desktop Chrome 139 or later. Nothing to install, no login (an anonymous account is created only if you save a track in Hybrid or Cloud mode).
- Optional, to see frames described **on your computer**: Gemini Nano 4. In `chrome://flags` enable **Gemma 4 for Built-in AI** and `#prompt-api-for-gemini-nano-multimodal-input`, restart Chrome, then press **Download Gemini Nano** in the app header (several GB, once). The header says what your Chrome can do.

## The 1-minute path (works with or without Gemini Nano)

1. Open the site. Keep **Hybrid** selected.
2. Press **Try built-in sample video (45s)**. It ships with the site; nothing is fetched from elsewhere.
3. Press **Describe this video**.
   - With Gemini Nano: frames are described on your computer; only text goes to the cloud for the final script.
   - Without it: a dialog asks before any frame leaves your computer. Choose **Use the cloud for this video** to continue, or **Keep frames here** to see that nothing is sent.
4. When it says *Done*, press play. Each line is spoken in a pause; long ones pause the video until they finish (extended audio description). **Play from** on a line jumps there and speaks it.
5. Check **Where the AI ran**: requests on the device, requests in the cloud, frames that left the computer. **Request log** lists every call with its source, latency, retries and failures.
6. Export **WebVTT** (for `<track kind="descriptions">`) or **Script**. Every line is editable; **Fit to pause** and **Describe again** work per line.

Each finished line shows **Checks passed** or **Needs review** (local checks: empty, only on-screen text, longer than its pause, a number the frame notes do not show, a near repeat). They are hints for a reviewer, not a guarantee.

## The three modes

| Mode | What runs where | Try it |
| --- | --- | --- |
| **Hybrid** | Frames on Gemini Nano (`ONLY_ON_DEVICE` until you agree to the cloud, then `PREFER_ON_DEVICE`); the whole-track script in the cloud from text only (`PREFER_IN_CLOUD`). | The path above. |
| **Private** | Every AI step on Gemini Nano (`ONLY_ON_DEVICE`). Saved tracks stay in this browser (IndexedDB). Only voices installed on the computer read the track. | Select **Private**. Without Gemini Nano it refuses to run and says why; nothing is sent. |
| **Cloud** | One still frame per scene plus the text go to Gemini through Firebase AI Logic. | Select **Cloud** and describe the sample: no dialog; the ledger counts every frame sent. |

## More clips

Benchmark clips are served with the site under `/benchmark/` (software tutorial, conversation with pauses, motion, continuous narration, a fictional sensitive record). Download one and open it with **Choose video**, or use the console runner in [BENCHMARK.md](BENCHMARK.md).

## If something does not work

- **No Gemini Nano:** Hybrid asks before using the cloud; Cloud mode runs without asking. The track works the same.
- **"did not pass Firebase App Check":** a blocker or proxy stopped reCAPTCHA. Allow `www.google.com` and `www.gstatic.com`, or use a normal Chrome window.
- **"busy right now":** the cloud answered 429 or 503 after a retry and a fallback model. Wait a minute.
- **"Pauses could not be measured":** the soundtrack could not be read; every description then pauses the video so none covers dialogue. Add captions (WebVTT/SRT) for exact timing.

## Known limits

- One key frame per scene: motion inside a scene is not described (benchmark clip 04).
- Pauses are found by loudness; music or noise can hide them. Captions give exact timing.
- On-device speed depends on the GPU; older ones take minutes per video.
- Not yet tested with blind or low-vision users, nor in a full screen-reader session ([ACCESSIBILITY.md](ACCESSIBILITY.md)).
