# Demo video: final

**Files:**

- `seen-aloud-demo-FINAL.mp4`: 2:17, 1920x1080, H.264 with AAC stereo audio at 48 kHz, -16.5 LUFS integrated, 2.9 LU loudness range.
- `seen-aloud-demo-FINAL.srt`: English captions, with the narrator and the audio description marked apart.

| Time | Picture | Sound |
| --- | --- | --- |
| 0:00 | The sample lecture clip, first frame | Narrator: as a blind viewer hears it |
| 0:03 | ORIGINAL CLIP, 0:00 to 0:08.5 | The clip own audio, no description |
| 0:12 | The same clip, still frame | Narrator: now with Seen Aloud |
| 0:17 | WITH SEEN ALOUD: page captures of the live app playing its track (Gemini Nano 4, Hybrid) | **Real system audio recorded over WASAPI loopback.** The app pauses the video, lowers its volume to 0.35 and the browser voice reads the line; this happens for two lines, and after each one the clip resumes |
| 0:45 | chrome://on-device-internals: Gemma 4 (Gemini Nano 4) installed | Narrator |
| 0:58 | Real Hybrid run, sped up (labelled) | Narrator |
| 1:17 | Ledger: 5 on the device, 1 in the cloud, 0 frames sent | Narrator |
| 1:28 | Private mode, fictional record, 2x speed, last frame held | Narrator |
| 1:43 | Evidence card (six clips, three modes) | Narrator |
| 2:01 | Limits card | Narrator |
| 2:12 | Try it | Narrator |

**How it was made, on 2026-11-26:**

- **Footage:** Google Chrome 158 with Gemini Nano 4, on the live site. Page captures came over the Chrome DevTools Protocol, on the same clock as the system audio (pyaudiowpatch, WASAPI loopback).
- **Playback log:** `av/play-log.json` in the working folder records video time, pause state, volume and speaking state every 120 ms.
- **Narrator:** Piper TTS (MIT), voice en_US-libritts_r-medium, speaker 300, LibriTTS-R dataset under CC BY 4.0 (credited in the YouTube description).
- **Edit:** FFmpeg, with loudness normalised per segment (loudnorm, -16 LUFS).

**Not shown:** volume ducking under dialogue without a pause. In this clip every line is extended, so the video is paused while the voice speaks. The log shows the volume set to 0.35 during each line, but that is not audible while the video is paused.

**Not checked by a person:** the sound. Sync was checked against the playback log and the frames; nobody listened to it.
