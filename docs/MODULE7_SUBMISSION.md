# Module 7 submission — FootballOS AI product UI prototype

**Live prototype (landing page):** <https://zap12-ux.github.io/footballos-prototype/>
**Interactive demo, one click from the landing page:** <https://zap12-ux.github.io/footballos-prototype/#/demo>
**Repository:** <https://github.com/zap12-ux/footballos-prototype> — its [README](https://github.com/zap12-ux/footballos-prototype/blob/main/README.md),
[design rationale](https://github.com/zap12-ux/footballos-prototype/blob/main/docs/MODULE7_DESIGN_RATIONALE.md),
[usability test protocol](https://github.com/zap12-ux/footballos-prototype/blob/main/docs/USABILITY_TEST_PROTOCOL.md)
and [AI-use disclosure](https://github.com/zap12-ux/footballos-prototype/blob/main/docs/AI_USE_DISCLOSURE.md)
are in the repository.

## Description of the design choices

<!-- description-start -->
FootballOS is an AI-assisted film-review workspace for high-school football coaches. The prototype opens on a landing page that explains the product and shows its AI outputs with the product's own components, then leads in one click to a demo of one coaching loop: select film, inspect a proposed player grade, check the evidence and the uncertainty behind it, accept or correct it, and build a practice focus from coach-approved findings only. The AI is simulated with authored data, and the interface says so on every screen.

The design choices follow the module readings. From Weisz et al. (2024), I designed for appropriate trust and reliance: every candidate grade comes with a rationale and time-coded evidence linked to a diagram frame the coach can inspect; two confidence readings (player identification and grade) are shown separately as High/Medium/Low bands with plain-language meanings and never as percentages; and one play withholds the AI's answer until the coach records their own, a deliberate friction against over-reliance. No Grade is a first-class abstention with a stated remedy, applying the principle of designing for imperfection. From Zieglmeier and Lehene (2022), I kept one palette, layout and control placement across the landing page and all seven screens, used short status messages instead of modal interruptions, and made data handling visible: nothing leaves the browser. Accuracy is never implied; "Model accuracy: not evaluated in this prototype" appears in the header throughout, because a trustworthy-looking interface must not stand in for a reliable model. Following Cagan (2017), the landing page lets a first-time visitor understand the product before any task, and the research route is instrumented (baseline before exposure, per-play timing, structured correction reasons, feedback questions, JSON export) for the 3–5 coach usability study described in the repository. No study has been run yet.
<!-- description-end -->

*Word count of the description alone: 295.*
