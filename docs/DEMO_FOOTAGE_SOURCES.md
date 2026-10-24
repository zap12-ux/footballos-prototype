# Real football footage available for the FootballOS demo

Compiled 2026-10-24. **Used in the prototype:** six snaps from SWOSU item 71 (end-zone
angle, 11/06/2010 vs UCO), one per demo play, each trimmed to a single play, live at
`public/demo-film/play-1.mp4` … `play-6.mp4` and are credited in the app and in the
README. Every item below was checked on its host page for a stated
license. The prototype's film screen plays a local MP4 / MOV / M4V / WebM file in the
browser (object URL, nothing uploaded), so any of these can be trimmed to a short clip
and loaded on Screen 3, or bundled as the "demo film" if kept small (under ~20 MB for
GitHub Pages).

**License notes for this project.** FootballOS is a non-commercial Georgetown course
project, so Creative Commons *NonCommercial* (NC) terms are fine. Avoid *NoDerivatives*
(ND) items: trimming a clip is arguably a derivative. Prefer CC0, Public Domain,
CC BY, CC BY-SA, CC BY-NC and CC BY-NC-SA. Always credit the source in the UI or README.

---

## Tier 1 — real coaching film (end-zone / sideline / wide angles, no audio)

### Southwestern Oklahoma State University football game film, 2010–2011
- **Collection:** https://dc.swosu.edu/football_vid/
- **License:** Creative Commons Attribution-NonCommercial 4.0 (CC BY-NC 4.0), stated on
  every item page ("unless stated otherwise within this repository collection").
- **What it is:** NCAA Division II game film shot the way coaches shoot it: separate
  end-zone, sideline, tight and wide angles, compiled from individual play clips, no
  audio. This is the closest match to what a position coach would grade in FootballOS
  (offensive line on inside zone). 1080p stream available.
- **End-zone angle items (best for O-line):**
  - 11/06/2010 SWOSU vs UCO (endzone angle) — https://dc.swosu.edu/football_vid/71
  - 10/24/2010 SWOSU vs Texas A&M Commerce (endzone angle) — https://dc.swosu.edu/football_vid/69
  - 10/09/2010 SWOSU vs SEOSU (endzone angle) — https://dc.swosu.edu/football_vid/68
  - 10/02/2010 SWOSU vs ENMU (end zone angle) — https://dc.swosu.edu/football_vid/64
- **Sideline / tight angle items:** 84 (ECU 2011, sideline), 75 (UCO 2010, sideline),
  72 (ENMU 2010, sideline), 63 (ECU 2010, sideline), 83 / 80 / 89 / 87 / 93 / 76 / 97 /
  78 / 95 / 91 (2011 tight angle). Each 2011 game also has a matching wide-angle item.
- **How to download:** the page embeds a JW Player HLS stream (`.m3u8` on
  `s3.amazonaws.com/bepress-streaming-outbox-production/...`). View page source, copy the
  `.m3u8` URL from the `jwplayer(...)` call, then:
  ```bash
  ffmpeg -i "<m3u8 url>" -t 60 -c copy swosu-clip.mp4
  ```
  (ffmpeg is not installed on this Mac yet: `brew install ffmpeg`.) Verified stream for
  item 84: 480x270 / 640x360 / 1920x1080 variants.
- **Credit line:** "Game film: Southwestern Oklahoma State University, SWOSU Football
  Videos (dc.swosu.edu), CC BY-NC 4.0."

---

## Tier 2 — full high-school game broadcasts with no NC / ND restriction (Internet Archive)

These are community-TV cablecasts (broadcast angle with commentary). Good for a
realistic high-school look; you will need to trim plays out.

| Game | License | Files | Link |
| --- | --- | --- | --- |
| Belmont HS vs Watertown HS (Thanksgiving rivalry), Victory Field MA, 2025-11-27, Belmont Media Center cablecast | **CC0 1.0** | MP4 854x480, 965 MB, 2 h 46 m | https://archive.org/details/snafuinfinityfootball_112725-vs-watertown |
| Christopher HS (Gilroy, CA) vs Monterey, varsity, 2012-11-02, CMAP | **CC BY 3.0** | MP4 640x480, 638 MB, 1 h 43 m | https://archive.org/details/VarsityFOOTBALL2012-11-02-12CHSvsMonterey |
| Hi Five "In the Game" week 3, Metro Atlanta private HS highlights (2008) | **CC BY 2.0** | MP4 540x360, 187 MB, 30 m | https://archive.org/details/Weldon-HiFiveInTheGameWeekThreeMetroAtlantaHighSchoolFootbal477 |
| Hi Five "In the Game" week 8 | CC BY 2.0 | similar | https://archive.org/details/Weldon-InTheGame8932 |

Direct downloads: append `/download/<identifier>/<filename>` to archive.org, e.g.
https://archive.org/download/VarsityFOOTBALL2012-11-02-12CHSvsMonterey/VarsityFOOTBALL2012-11-02-12CHSvsMonterey.mp4

## Tier 2b — high-school games under CC BY-NC or CC BY-NC-SA (fine for this course)

- **Watertown (MA) Cable Access, WHS Football** — CC BY-NC-SA 4.0, 640x480 MP4.
  vs Stoneham 2018-10-12: https://archive.org/details/whs-football-vs-stoneham-october-12-2018 ·
  vs Plymouth South 2016: https://archive.org/details/whs-football-vs-plymouth-south-september-16-2016 ·
  vs Shawsheen Tech 2013: https://archive.org/details/whs-football-vs-shawsheen-tech-september-20-2013
- **MAC TV (Michigan) Game of the Week** — CC BY-NC 3.0, 1280x720 MOV + 640x360 MP4.
  Harrison @ Clare 2018: https://archive.org/details/mactvmiv-Harrison_Hornets_at_Clare_Pioneers_Football ·
  Farwell vs Clare 2020: https://archive.org/details/mactvmiv-Farwell_Eagles_vs_Clare_Pioneers_Varsity_Football ·
  Breckenridge vs St Louis 2015, Ithaca @ Shepherd 2015, Hemlock vs St Louis 2020 (same uploader prefix `mactvmiv-`).
- **Auburn University archival film, 1953** — CC BY-NC 4.0, digitized 16mm, 640x480.
  Auburn vs Ole Miss 1953-10-03: https://archive.org/details/rg-84-film-1953-ole-miss
- Full list of 110 CC-tagged football items from the Internet Archive query is saved at
  `/private/tmp/claude-501/-Users-zachariahparkhill-Desktop-Developing-AI-Solutions-FootballOS/2fb524ac-5120-4bff-be31-104d07920303/scratchpad/ia/football_cc.tsv`
  (scratch copy; regenerate with the archive.org advanced search `licenseurl:* AND football AND mediatype:movies`).
- **Avoid (ND):** the Cincinnati-area "WCT" games (St. Xavier, Colerain, Winton Woods…),
  DoubleACS Attleboro games, MMU Vermont games, and the Pennsylvania `cmscpav` /
  Bermudian Springs games are CC BY-NC-ND or CC BY-ND. The 2012 Blacksburg HS vs Pulaski
  broadcast (WTOB) carries no license at all.

---

## Tier 3 — short clips, ready to drop in (Wikimedia Commons, direct WebM links)

| Clip | Length / size | License | Direct file |
| --- | --- | --- | --- |
| Devin Singletary 14-yd TD run, Bills vs Bears preseason 2021 (fan video, Ryan Dickey) | 15 s, 1080p | CC BY 2.0 | https://upload.wikimedia.org/wikipedia/commons/8/88/Devin_Singletary_touchdown_%2851394753691%29.webm |
| McKenzie Milton 19-yd TD pass to Gabriel Davis, UCF vs FAU 2018 | 13 s, 1080p, 45 MB | CC BY-SA 2.0 | https://upload.wikimedia.org/wikipedia/commons/a/a2/Milton_Touchdown_Pass_to_Davis.webm |
| Kickoff and return, Baker vs Benedictine (NAIA) at Arrowhead, 2014 | 31 s, 1080p, 37 MB | CC BY-SA 4.0 | https://upload.wikimedia.org/wikipedia/commons/e/e2/Kickoff_Baker_v_Benedictine_2014.webm |
| UVA football game, 1950s home movie (8mm scan) | 6 m 08 s, 640x480, 59 MB | CC0 | https://upload.wikimedia.org/wikipedia/commons/9/96/UVA_Football_Game_1950s.webm |
| Burros Blancos vs Águilas Blancas (IPN student football, Mexico City, 2017) | 23 s, 640x360 | CC BY-SA 4.0 | https://upload.wikimedia.org/wikipedia/commons/3/34/BurrosBlancos_vs_AguilasBlancas_ohs22.ogv |

Category page with 72 files: https://commons.wikimedia.org/wiki/Category:Videos_of_American_football
(mostly press conferences and NFL interviews; the five above are the game-action ones).
WebM/OGV play natively in Chrome, Edge and Firefox and in the prototype's `<video>` stage.

---

## Tier 4 — free stock clips (no attribution required, modern HD)

- **Pexels** (Pexels License: free for web, apps, presentations; no attribution needed):
  - High School Football Game Action and Strategy, 10 s 1080p (Richard Robbins, 2025) — https://www.pexels.com/video/high-school-football-game-action-and-strategy-34414735/
  - Exciting High School Football Game Highlights — https://www.pexels.com/video/exciting-high-school-football-game-highlights-32006306/
  - Exciting American Football Gameplay Outdoors, 12 s 1080p (Jesus Rivera, 2025) — https://www.pexels.com/video/exciting-american-football-gameplay-outdoors-34396408/
  - Vintage 1960s American football game footage (8mm) — https://www.pexels.com/video/vintage-1960s-american-football-game-footage-32102515/
  - Low Angle Shot of Football Players Practicing — https://www.pexels.com/video/low-angle-shot-of-football-players-practicing-5423481/
- **Mixkit** (Mixkit Stock Video Free License; confirm the "Free", not "Restricted",
  badge on each clip page): Football player blocked by opponents
  (https://mixkit.co/free-stock-video/football-player-blocked-by-opponents-42560/),
  Two players stopping a running back (…-42563/), Three football players training at
  night (…-42559/), Football team practicing a strategy play (…-42558/).
- **Pixabay** (Pixabay Content License): the `tommyvideo` series 5605–5613 and 5262
  (https://pixabay.com/videos/american-football-sport-american-5613/) are 720p real-action
  clips; item 17440 is a 3D animation, skip it.

---

## Tier 5 — public domain US government film (vintage, historical flavor only)

National Archives (NARA) moving images, US Navy / Army Signal Corps works, downloadable
from the catalog page ("Download" button). Use status reads "Undetermined" but these are
federal government works.
- Army–Navy Football Game 1933, "several high angle views of game in progress" — https://catalog.archives.gov/id/84438
- Army–Navy Football Game 1944 (game in progress, touchdowns, interception) — https://catalog.archives.gov/id/84440
- Search with 89 results: https://catalog.archives.gov/search?q=football%20game&typeOfMaterials=Moving%20Images&availableOnline=true

---

## Checked and not usable / not recommended

- **YouTube Creative Commons filter** — the in-app browser could not render YouTube
  results. Search YouTube yourself for "high school football game film" → Filters →
  Features → Creative Commons, and read the license field under each video. Most Hudl
  re-uploads are *not* CC even when the filter shows them; only trust the stated license.
- **DVIDS** (US military media): video search did not render; the API needs a key. Still
  photos of Air Force Academy games exist but are mostly restricted.
- **Georgia Southern "Erk Russell Classic 2019" highlights** — downloadable 48.7 MB MP4,
  but rights say "see the publisher's copyright policy"; ask Student Media before use.
- **1957 NFL Championship Game, Super Bowl broadcasts, FOX college highlights on Commons
  or archive.org** — network / NFL copyright, do not use.
- **Hudl, MaxPreps, school athletic sites** — footage belongs to the program; needs
  written permission.

## Recommended picks for the Module 7 / Module 13 demo

1. **SWOSU end-zone clip** (item 71 or 64) trimmed to one inside-zone run of ~8–12 s:
   it looks like real coaching film and matches the O-line, Inside Zone Right scenario.
2. **Belmont vs Watertown 2025 (CC0)** for a high-school broadcast look with zero
   license friction.
3. **One Pexels high-school clip** as a lightweight bundled fallback (under 10 MB).

Record whichever you use in README "Credits" with title, source URL and license.
