# Competitor analysis

#BuildHybridAI 2026, public project pages read on 2026-11-26. The gallery is not public yet; these are the projects named in the audit brief. The reading is ours, not the judges.

| Project | Problem and audience | Hybrid use | Evidence |
| --- | --- | --- | --- |
| **Second Look** | Appealing denied health-insurance claims; patients | Reads letters and photos with `ONLY_ON_DEVICE`; drafts the appeal in the cloud from a masked copy; opens offline after one visit; labels answers with `inferenceSource` | Live site, repo, video; Web only |
| **FlowWitness** | UI state verification for front-end and QA engineers | Gemini Nano as a triage sieve, cloud for root cause; `ONLY_ON_DEVICE` guard for confidential screens | 12-scenario routing benchmark, ADRs, live site, video |
| **Triage Copilot** | Incident triage for DevOps teams | Triage `PREFER_ON_DEVICE`, diagnosis streamed from the cloud; source and latency on every card | Live site, repo, video, built-in samples |
| **AI Research Desk** | Summarizing private research notes | `PREFER_ON_DEVICE` short tasks; any of the four modes selectable; route badge | Live site, repo, video |

## Where Seen Aloud is stronger

- **Image input on the device**, matching the image-captioning use case Firebase itself describes, for a problem with legal deadlines behind it (WCAG 1.2.5, EN 301 549, ADA Title II) and a clear audience.
- **Consent that holds even if Gemini Nano disappears mid-video**, and a ledger that counts failed uploads and retries, not only successes.
- **A complete product loop**: scene and pause detection, extended audio description in the player, WebVTT export, per-line review.
- **A scored benchmark on real runs**, including what failed and was fixed.

## Where it is weaker

- **No offline mode** (Second Look opens offline after one visit).
- **No masking of personal data** in the text sent to the cloud in Hybrid mode; on-screen names in the scene notes reach the cloud script. Second Look masks before drafting.
- **Single platform**, like the four above; multi-platform entries get "strong consideration" for the Grand Prize.
- **Motion within a scene is not described.**

No features, code or text were taken from these projects.
