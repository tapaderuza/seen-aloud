# Security

| Area | State |
| --- | --- |
| App Check | Required by Firebase AI Logic; reCAPTCHA Enterprise in production, debug provider only in local development. No debug token in the repository or the production bundle (checked 2026-11-25). |
| Secrets | The Firebase web config identifies the project and is not a secret. `.env.local` is git-ignored; the history has no API keys or tokens (scanned for common key formats). |
| Firestore rules | Each anonymous user reads and writes only `users/{uid}/tracks`. Writes must contain only the fields the app writes, with types and sizes checked, a server timestamp, and a mode of `hybrid` or `cloud`. Everything else is denied. Deployed 2026-11-26. **Not covered by emulator tests**: the Firestore emulator needs Java, which is not installed on the build machine. The rules compile and deploy. |
| Prompt injection | Text in the video, in on-screen text and in captions is passed as quoted data, and every prompt states that it is content to describe, never instructions. Model output is parsed as JSON into plain text and only shown with `textContent`. |
| XSS | All model and user text is rendered with `textContent`; the only `innerHTML` is a fixed setup banner, with the Firebase error escaped. |
| Cost and abuse | Remote Config values are validated and clamped. Cloud retries are bounded (one retry, one fallback model). Firebase AI Logic applies per-user rate limits; the project runs on the free tier. Anonymous accounts could each store tracks: the rules cap each document (600 lines, 200-character title) and Firestore caps documents at 1 MiB, but there is no per-user document count limit. |
| Files | Videos never leave the browser. Soundtracks over 400 MB are not decoded; pauses are then marked as unknown and every description pauses the video. |
| Dependencies | `npm audit --omit=dev` reports `@grpc/grpc-js` advisories through `@firebase/firestore`. That package is the Node.js transport; the browser bundle uses WebChannel and does not include grpc-js. The suggested fix (downgrading Firebase to 9.x) is not applied. CI prints the audit on every push. |

Suggested console settings for the owner (not verifiable from the repository): restrict the browser API key to the HTTP referrers of the site and to `firebasevertexai.googleapis.com` plus the Firebase APIs in use; enable AI monitoring; consider App Check replay protection with limited-use tokens.
