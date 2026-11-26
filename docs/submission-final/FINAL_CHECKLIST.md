# Final checklist (owner)

Deadline: **Monday 2026-11-30, 14:00 PT = 23:00 in Spain.**

- [ ] **Upload the video to YouTube.** File: `docs/submission-final/seen-aloud-demo-gemini-nano-4.mp4`. Public, with the title from VIDEO_SCRIPT_FINAL.md. Copy the link.
- [ ] **Open the existing project.** Devpost → https://devpost.com/software/seen-aloud → Edit (the existing project; do not create a new one).
- [ ] **Paste the text.** Each field of DEVPOST_FINAL.md: tagline, the story sections, Built with, Try it out links, Testing instructions.
- [ ] **Replace the video.** Paste the new YouTube link in the Video field.
- [ ] **Gallery.** Upload images 1 to 6 in the order of DEVPOST_FINAL.md and delete outdated ones.
- [ ] **Category.** Check that Web (Chrome) / Best Web is selected.
- [ ] **Save,** then open the public page in a private window: video plays, links open, text shows.
- [ ] **Freeze.** After that, no commits, deploys or Devpost edits until judging ends.
- [ ] **Keep the site up.** It must stay up until judging ends (2026-12-16); do not delete Firebase resources.

Already done: tests (132), typecheck, build, CI, deploy, link check, production check. See the final commit in `git log`. Rollback: Firebase Hosting release history, or `git revert` plus a redeploy.
