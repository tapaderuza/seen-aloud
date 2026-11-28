# Privacy

Seen Aloud reads the video file inside the browser; the file itself is never uploaded. What can leave the computer depends on the mode, and the app says so before it happens.

## What each mode sends

| | Private | Hybrid | Cloud |
| --- | --- | --- | --- |
| Still frames (JPEG, one per scene) | never | only after you agree in the dialog, and only if Gemini Nano cannot describe them | yes |
| Scene notes, on-screen text, caption text near each scene (text) | never | yes, to write the whole track (`PREFER_IN_CLOUD`) | yes |
| File name, descriptions in saved tracks | stays in this browser (IndexedDB) | Firestore, under an anonymous account, if you press Save | Firestore, if you press Save |
| Voice that reads the track | only voices installed on the computer (`localService`); otherwise the line is shown as text | prefers an installed voice; a network voice may receive the text | same as Hybrid |

## How it is enforced in code

- **Private mode never asks the cloud.** Every inference uses `ONLY_ON_DEVICE`; without Gemini Nano the engine throws `PrivacyGuardError` before any request (`src/ai/engine.ts`). The Firebase SDK would fall back to the cloud when Chrome has no `LanguageModel` at all, so this check belongs to the app, not the SDK. Test: "in private mode only ever asks for ONLY_ON_DEVICE" in `tests/engine.test.ts`.
- **Hybrid asks before the first frame leaves.** Until you agree, frames go with `ONLY_ON_DEVICE`, so the SDK cannot quietly reroute a frame to the cloud if Gemini Nano becomes unavailable mid-video. A failure then goes through the consent check. No consent callback means no consent.
- **Private mode does not start Auth or Firestore.** They are created on first use, and Private mode never uses them. Verified on the live site on 2026-11-26: loading in Private mode contacted only App Check (reCAPTCHA Enterprise), with no Authentication or Firestore traffic.
- **Mode and language are locked while a job runs**, so a run never changes policy halfway.
- **Firestore rules refuse tracks marked Private** and accept only the fields the app writes (`firestore.rules`).

## The ledger ("Where the AI ran")

It counts, per video: requests on the device, requests in the cloud, frames described on the device, frames sent to the cloud, and frames whose cloud request failed after it may have been uploaded (counted as having left). The request log adds the source of each call (from `response.inferenceSource`), its latency, every retry (one inference can be up to three network requests: the model, the same model again, a fallback model) and every failure.

## Limits we state plainly

- Private mode still loads Firebase App Check (reCAPTCHA Enterprise) and may fetch Remote Config, so the page can switch to Hybrid or Cloud later. Neither carries video, frames or text from the video.
- **Verified with a real Gemini Nano** on 2026-11-26 (Chrome 158, network captured outside the page; [GEMINI_NANO_VALIDATION.md](GEMINI_NANO_VALIDATION.md)):
  - **Private:** no request to the AI endpoint and no Auth or Firestore request.
  - **Hybrid:** no frame left; one text request per video went to the cloud.
- **Hybrid masks personal-looking text before it leaves (since 2026-11-28).** Names after a label, dates, numbers of 7 or more digits and e-mails are replaced by tokens on the device, then put back locally in the finished line. In a real run on the fictional record (Gemini Nano 4, captured over CDP), no name, date of birth or account number reached any request; on 26 Nov all three did. The masking works by patterns, so names without a label and other details may still be sent. Use Private for sensitive footage.
- **Free-tier data use.** The live site uses the Gemini Developer API free tier, whose content Google's pricing page says is used to improve its products. That applies to what Hybrid and Cloud send.
- A network voice in Hybrid or Cloud mode sends the description text to the speech service of the browser.
- Saving in Hybrid or Cloud mode stores the file name and the descriptions in Firestore.
