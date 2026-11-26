# Accessibility

The people this is for use screen readers, so the app itself has to work with one. Target: WCAG 2.2 AA.

## What was tested (2026-11-26, production)

| Check | Result |
| --- | --- |
| axe-core 4.10.2, WCAG 2.0, 2.1 and 2.2 A and AA plus best practices: start screen | 0 violations |
| Same, after a track was generated (scene cards, review badges, ledger, request log open) | 0 violations |
| Same, with the cloud consent dialog open | 0 violations; focus starts on the safe choice, Keep frames here |
| Same, dark colour scheme | 0 violations |
| Same, 375 px wide viewport (reflow) | 0 violations, no horizontal scrolling |
| Focus after closing the consent dialog | moves to Stop (after Use the cloud) or back to Describe this video (after Keep frames here); never to the page body |
| Focus after Fit to pause or Describe again | stays on the same control in the re-rendered row |

## Built in

- Skip link, landmarks, one live status region for progress and errors, labelled mode radios and language select.
- Every scene line, word counter and action names its scene; word counters announce "too long for the pause".
- The consent dialog is a native modal dialog with a title and a description; Escape means no.
- Descriptions shown as text (voice off, or no installed voice in Private mode) are announced by screen readers through `aria-live`; when the browser voice reads them, the overlay is not announced twice.
- Mode and language are locked during a run. `prefers-reduced-motion` turns off transitions.
- The player pauses the video for descriptions longer than their pause (WCAG 2.2 SC 1.2.7, extended audio description).

## Not tested yet

- A session with blind or low-vision users.
- A full run with NVDA, JAWS or VoiceOver.
- Keyboard-only end-to-end tests in CI (the checks above were scripted in a browser, not run with Playwright).

Seen Aloud writes a first draft of a description track for a person to review. It does not, by itself, make a video conform to WCAG or the ADA.
