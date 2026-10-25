# Module 7 submission — FootballOS AI product UI prototype

**Live prototype (landing page):** <https://zap12-ux.github.io/footballos-prototype/>
**Interactive demo, one click from the landing page:** <https://zap12-ux.github.io/footballos-prototype/#/demo>
**Research entry (baseline first, used by the usability protocol):** <https://zap12-ux.github.io/footballos-prototype/#/research>
**Repository:** <https://github.com/zap12-ux/footballos-prototype> — its [README](https://github.com/zap12-ux/footballos-prototype/blob/main/README.md),
[design rationale](https://github.com/zap12-ux/footballos-prototype/blob/main/docs/MODULE7_DESIGN_RATIONALE.md),
[usability test protocol](https://github.com/zap12-ux/footballos-prototype/blob/main/docs/USABILITY_TEST_PROTOCOL.md)
and [AI-use disclosure](https://github.com/zap12-ux/footballos-prototype/blob/main/docs/AI_USE_DISCLOSURE.md)
are in the repository.

## Description of the design choices

<!-- description-start -->
FootballOS is an AI-assisted film-review workspace for high-school football coaches. The prototype opens on a landing page that explains the product and shows its AI outputs with the product's own components, then leads in one click to a demo of one coaching loop: select film, inspect a proposed player grade, check the evidence and uncertainty behind it, accept or correct it, and build a practice focus from coach-approved findings only. The AI is simulated with authored data, and the interface says so on every screen.

The design choices follow the module readings. From Weisz et al. (2024), I designed for appropriate trust and reliance: every candidate grade carries a rationale and time-coded evidence linked to real end-zone footage or a diagram frame; two confidence readings (player identification and grade) appear separately as High/Medium/Low bands with plain-language meanings, never percentages; one play withholds the AI's answer until the coach records their own; and No Grade is a first-class abstention with a stated remedy. The practice focus returns one of four explicit states, so a below-standard grade without a technique reason prompts the coach to clarify rather than being read as the standard met. From Zieglmeier and Lehene (2022), I kept one palette and control placement across all screens, scanned the review screen so evidence, candidate, confidence and decision controls read in order, moved long disclaimers into expandable help, and made data handling visible: nothing leaves the browser, and "Model accuracy: not evaluated in this prototype" stays in the header. Following Cagan (2017), research participants enter through a neutral baseline screen before seeing any example output, with prior exposure recorded honestly, accumulated per-play timing, structured reasons and a JSON export for the proposed 3–5 coach study. No study has been run yet.
<!-- description-end -->

*Word count of the description alone: 290.*
