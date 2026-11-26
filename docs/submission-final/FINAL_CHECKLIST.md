# Final checklist (owner)

Deadline: **Monday 2026-11-30, 14:00 PT = 23:00 in Spain.**

- [x] **Upload the video to YouTube.** Done 2026-11-26: https://youtu.be/g2szbkyeOKI (Public). File: `docs/submission-final/seen-aloud-demo-FINAL.mp4`, with the captions file `seen-aloud-demo-FINAL.srt`. Title, description and visibility (Public) are in YOUTUBE_DESCRIPTION.md. Copy the link.
- [x] **Open the existing project.** Devpost → https://devpost.com/software/seen-aloud → Edit (the existing project; do not create a new one).
- [x] **Paste the text.** Each field of DEVPOST_FINAL.md: tagline, the story sections, Built with, Try it out links, Testing instructions.
- [x] **Replace the video.** Paste the new YouTube link in the Video field.
- [x] **Gallery.** Done: 6 new images with captions, the 4 old ones removed; thumbnail = 01-hero.png. Upload images 1 to 6 in the order of DEVPOST_FINAL.md and delete outdated ones.
- [x] **Category.** Web (Chrome) selected. Testing instructions and the technology field updated in the contest form; status SUBMITTED. Check that Web (Chrome) / Best Web is selected.
- [x] **Save,** then open the public page in a private window: video plays, links open, text shows.
- [ ] **Freeze.** After that, no commits, deploys or Devpost edits until judging ends.
- [ ] **Keep the site up.** It must stay up until judging ends (2026-12-16); do not delete Firebase resources.

Already done: tests (132), typecheck, build, CI, deploy, link check, production check. See the final commit in `git log`. Rollback: Firebase Hosting release history, or `git revert` plus a redeploy.
