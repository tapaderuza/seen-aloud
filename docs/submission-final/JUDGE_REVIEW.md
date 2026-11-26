# Five-minute judge review (simulated, 2026-11-26)

**First 15 seconds** (tagline, video start, hero image): a judge sees an audio description tool for blind and low-vision viewers, frames described on the computer, and a real ledger with 0 frames sent. The problem is clear. The Firebase AI Logic angle (a mode per task, the cloud for text only) is clear by the second card of the video.

| Check | Result |
| --- | --- |
| Reach the app | Yes: public URL, no login |
| Try it without Gemini Nano | Yes: the built-in sample, Hybrid asks before the cloud, or Cloud mode |
| Gemini Nano 4 visible | Yes, once the new video and gallery image 5 are on Devpost; the current video does not show it |
| Hear a description | Yes in the app; the video shows the lines but does not carry the browser's voice |
| Find the benchmark | Testing instructions link to GEMINI_NANO_VALIDATION.md and BENCHMARK.md |
| Contradictions | Fixed: the old video's tagline ("for any video") goes when the video is replaced. Instructions now say how to get Gemini Nano 4 instead of calling the flag optional. README, app and Devpost text use the same numbers |

| Criterion | Score (1–5) | Why |
| --- | --- | --- |
| Technological implementation | 4.5 | Four inference modes used deliberately; privacy enforced in code and checked against the network; real Nano and Nano 4 runs; 132 tests and CI |
| Design and user experience | 4.0 | Clear modes and ledger, editable lines, extended description, keyboard and axe-clean. On-device runs are slow on a 4 GB GPU, and short pauses give thin lines |
| Potential impact | 4.5 | A legal and human need (WCAG 1.2.5, ADA Title II dates), privacy-sensitive footage, near-zero cost per video |
| Quality of the idea | 4.5 | A non-obvious hybrid split (pixels local, text to the cloud), a good fit for the Firebase hybrid image-captioning pattern |

**What could cost points:**

1. A video without Gemini Nano 4. Replace it.
2. Hybrid sending on-screen text. It is stated plainly; a privacy-minded judge may still mark it down.
3. Speed on modest hardware.
4. A small benchmark.

**Disqualification risks:** none found, provided the new video is public on YouTube before the deadline and nothing changes after it.
