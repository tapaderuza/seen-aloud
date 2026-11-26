# Builds the benchmark clips in public/benchmark/ (served at https://seen-aloud.web.app/benchmark/).
# Needs ffmpeg on PATH. Clip 03 uses the Windows speech synthesizer (System.Speech) for two
# Spanish voices; any other TTS works if you keep the same lines and pauses.
# Sources: 01 is the app's bundled sample; 02 and 05 are the author's own recordings
# (paths below, not in the repo); 03, 04 and 06 are synthetic. Everything is CC0 or the author's.
param(
  [string]$Demo = "samples/seen-aloud-demo.mp4",
  [string]$Talk = "D:/FacelessYT/data/video/01-outlier-agent.mp4",
  [string]$Font = "C:/Windows/Fonts/arial.ttf"
)
$ErrorActionPreference = "Stop"
$out = "public/benchmark"
New-Item -ItemType Directory -Force $out | Out-Null
$font = $Font -replace '^([A-Za-z]):', '$1\:'
$work = Join-Path $env:TEMP "seen-aloud-bench"
New-Item -ItemType Directory -Force $work | Out-Null

# 02: software tutorial (the app's own demo recording), 40 s.
ffmpeg -y -loglevel error -ss 27 -t 40 -i $Demo -vf "scale=960:-2" -c:v libx264 -crf 30 -preset veryfast -c:a aac -b:a 64k "$out/02-software-tutorial.mp4"

# 03: a conversation with pauses: two speakers, real synthetic speech, ~2.5 s pauses.
Add-Type -AssemblyName System.Speech
$lines = @(
  @{ voice = "Helena"; text = "Hola Luis. Ya tengo los datos del trimestre." },
  @{ voice = "Pablo";  text = "Perfecto. Enséñame el gráfico de ventas." },
  @{ voice = "Helena"; text = "Aquí está. Las ventas subieron un cuarenta y dos por ciento." },
  @{ voice = "Pablo";  text = "Muy buena noticia. Gracias, Ana." }
)
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$i = 0
foreach ($line in $lines) {
  $voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -like "*$($line.voice)*" } | Select-Object -First 1
  if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }
  $synth.SetOutputToWaveFile("$work/line$i.wav")
  $synth.Speak($line.text)
  $i++
}
$synth.SetOutputToNull()
# Speech timeline: each line, then 2.5 s of silence.
ffmpeg -y -loglevel error -f lavfi -i "anullsrc=r=16000:cl=mono" -t 2.5 "$work/pause.wav"
$list = @()
for ($k = 0; $k -lt $lines.Count; $k++) { $list += "file 'line$k.wav'"; $list += "file 'pause.wav'" }
Set-Content -Encoding ascii "$work/audio.txt" $list
ffmpeg -y -loglevel error -f concat -safe 0 -i "$work/audio.txt" -ar 16000 -ac 1 "$work/talk.wav"
$dur = [double](ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$work/talk.wav")
$third = [math]::Round($dur / 3, 2)
ffmpeg -y -loglevel error `
  -f lavfi -i "color=c=0x1565c0:s=960x540:d=$third" -f lavfi -i "color=c=0xef6c00:s=960x540:d=$third" -f lavfi -i "color=c=0xfafafa:s=960x540:d=$third" -i "$work/talk.wav" `
  -filter_complex "[0:v]drawtext=fontfile='$font':text='ANA':fontcolor=white:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2[a];[1:v]drawtext=fontfile='$font':text='LUIS':fontcolor=white:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2[b];[2:v]drawbox=x=200:y=330:w=120:h=120:color=0x90a4ae:t=fill,drawbox=x=420:y=250:w=120:h=200:color=0x42a5f5:t=fill,drawbox=x=640:y=130:w=120:h=320:color=0x1e88e5:t=fill,drawtext=fontfile='$font':text='VENTAS +42%':expansion=none:fontcolor=0x263238:fontsize=64:x=(w-text_w)/2:y=40[c];[a][b][c]concat=n=3:v=1:a=0[v]" `
  -map "[v]" -map 3:a -c:v libx264 -crf 28 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 64k -shortest "$out/03-conversation-pauses.mp4"
for ($k = 0; $k -lt $lines.Count; $k++) {
  $len = [double](ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$work/line$k.wav")
  Write-Output ("03 line {0}: {1:N2} s of speech, then 2.5 s pause" -f $k, $len)
}

# 04: motion and actions, with a silent soundtrack. The shapes are overlays, because
# drawbox does not evaluate time expressions in every ffmpeg build (the first version of
# this clip rendered blank screens; see docs/BENCHMARK.md).
ffmpeg -y -loglevel error `
  -f lavfi -i "color=c=white:s=960x540:d=6" -f lavfi -i "color=c=red:s=100x100:d=6" `
  -f lavfi -i "color=c=black:s=960x540:d=6" -f lavfi -i "color=c=0x2962ff:s=100x100:d=6" `
  -f lavfi -i "color=c=0x37474f:s=960x540:d=4" -f lavfi -i "anullsrc=r=16000:cl=mono" `
  -filter_complex "[0:v][1:v]overlay=x='40+t*140':y=220[a];[2:v][3:v]overlay=x=430:y='440-t*60'[b];[4:v]drawtext=fontfile='$font':text='THE END':fontcolor=0x69f0ae:fontsize=96:x=(w-text_w)/2:y=(h-text_h)/2[c];[a][b][c]concat=n=3:v=1:a=0[v]" `
  -map "[v]" -map 5:a -t 16 -c:v libx264 -crf 28 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 32k "$out/04-motion-actions.mp4"

# 05: continuous narration (the author's own explainer), 45 s.
ffmpeg -y -loglevel error -t 45 -i $Talk -vf "scale=960:-2" -c:v libx264 -crf 30 -preset veryfast -c:a aac -b:a 64k "$out/05-continuous-dialogue.mp4"

# 06: a fictional sensitive record, for the privacy comparison. Silent soundtrack.
ffmpeg -y -loglevel error -f lavfi -i "color=c=0xfff8e1:s=960x540:d=8" -f lavfi -i "anullsrc=r=16000:cl=mono" `
  -filter_complex "[0:v]drawtext=fontfile='$font':text='FICTIONAL TEST RECORD':fontcolor=0xb71c1c:fontsize=48:x=60:y=60,drawtext=fontfile='$font':text='Patient\: Jane Example':fontcolor=black:fontsize=44:x=60:y=180,drawtext=fontfile='$font':text='Date of birth\: 01/02/1980':fontcolor=black:fontsize=44:x=60:y=260,drawtext=fontfile='$font':text='Account 0000-1111':fontcolor=black:fontsize=44:x=60:y=340[v]" `
  -map "[v]" -map 1:a -t 8 -c:v libx264 -crf 28 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 32k "$out/06-sensitive-fictional.mp4"

Get-ChildItem $out | Select-Object Name, Length
