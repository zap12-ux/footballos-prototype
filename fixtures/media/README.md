# Media fixtures

No footage is stored here. The media package's tests reference the six credited
end-zone clips at `apps/web/public/demo-film/play-1.mp4` … `play-6.mp4`
(CC BY-NC 4.0; see the credit in `apps/web`) by path, and build a longer
synthetic asset at test time by concatenating them with 3–5 s of black between
plays into `.data/wt-c/synthetic-game.mp4` (gitignored). The recipe and the
expected play windows are written next to it as `synthetic-game.json`.

No full game exists in the repository (DECISIONS D-005). Everything measured on
these fixtures must be re-verified on real fixed-sideline game film.
