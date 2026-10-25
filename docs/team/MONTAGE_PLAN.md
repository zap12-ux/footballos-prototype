# Landing montage plan (D-011, board item X5)

Status: waiting for the owner to link Figma to Weave and state a budget. No run has been
made. Per-clip cost will be reported to the owner before each run.

## Asset spec
- 6 to 8 clips, 4 to 6 s each, 1920x1080 (16:9), H.264 MP4, no audio, 24 or 30 fps.
- Files: `apps/web/public/montage/clip-01.mp4` … `clip-08.mp4`, plus `poster.jpg`
  (first frame of clip-01 or a designed still) and `manifest.json`:
  `{ "poster": "poster.jpg", "clips": [{ "src": "clip-01.mp4", "credit": "AI-generated (model, date)" }, …] }`.
- Total size target under 25 MB (re-encode with the bundled ffmpeg at CRF 26 if larger).
- Record for each clip: model name and version, prompt, date, cost, and the provider's
  terms for public/commercial use, in `apps/web/public/montage/CREDITS.md`.

## Content rules
- Fictional players only: no real team names, logos, numbers of real players, or real
  stadium branding. Jerseys in navy and crimson with gold accents to match the site.
- Action, not posed: tackles, runs, catches, line play, a kick. Wide and medium shots that
  read at small size behind text; no faces in close-up; no slow motion longer than 2 s.
- Fixed or gently moving camera, daylight or stadium lights, consistent grade across clips.

## Shot list (prompts, one run each)
1. Wide sideline shot, high-school football, running back breaks through the line and is
   tackled by a linebacker, navy jerseys versus crimson, stadium lights, crisp realistic
   footage, 5 s.
2. Medium shot from behind the offense, quarterback drops back and throws, offensive line
   in pass protection, dusk, 5 s.
3. Wide end-zone shot, receiver catches a pass over the middle and is wrapped up, 5 s.
4. Low sideline angle, defensive line and offensive line engage at the snap, pads collide,
   5 s.
5. Wide shot, kickoff return, returner cuts upfield past two defenders, 6 s.
6. Medium shot, safety comes downhill and makes an open-field tackle, 4 s.
7. Wide shot, punt or field-goal attempt, ball leaves the kicker's foot, crowd blurred,
   4 s.
8. Medium shot, players lining up pre-snap, hand signals, then the snap, 5 s.

## Acceptance (brief §4)
- Actual generated clips in place, manifest filled, playback verified in the browser:
  muted looping, pause control works, reduced-motion shows the poster, poster fallback
  when video fails.
- Terms recorded in CREDITS.md; no fabricated claims anywhere on the page.
