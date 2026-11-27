# Media fixtures

`clips/play-1.mp4` … `play-6.mp4` are six short end-zone snaps (about six to nine seconds
each, audio removed) used only by tests: `packages/media` probes, proxies, thumbnails and
segments them by path and builds a longer synthetic asset at test time by concatenating them
with 3–5 s of black between plays into `.data/wt-c/synthetic-game.mp4` (gitignored, recipe in
`synthetic-game.json` next to it); `apps/api` uploads `play-1.mp4` through the real chain in
its media tests. They are not served by the web app.

Credit: *11/06/2010 SWOSU vs UCO (endzone angle)*, Southwestern Oklahoma State University,
SWOSU Football Videos, <https://dc.swosu.edu/football_vid/71>, licensed
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Changes: six plays trimmed
to one snap each, re-encoded for the web, audio removed.

No full game exists in the repository (DECISIONS D-005). Everything measured on these
fixtures must be re-verified on real fixed-sideline game film.
