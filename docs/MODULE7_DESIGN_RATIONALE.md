# FootballOS — Module 7 design rationale and testing

*Module 7: Hands-On — AI Product UI Prototype · Developing AI Solutions (MPIM 6750), Georgetown University*

This document explains how the interactive FootballOS prototype meets the Module 7
assignment, which design decisions were made and why, which requirements were verified
against project documents versus assumed, and how the assigned readings informed the work.
References are in APA style at the end.

---

## 1. How the implementation meets Module 7

Module 7's learning objectives are (7.1) to develop user interfaces that clearly communicate
AI-driven outputs, including accuracy and confidence measures, and (7.2) to conduct usability
testing sessions to refine AI interfaces and enhance user trust. The hands-on assignment asks
for a functional web page that introduces the AI product, lets users interact with it, and
shows how its AI features work.

| Assignment expectation | Where it is met |
| --- | --- |
| Functional web page / landing page | The live page at <https://zap12-ux.github.io/footballos-prototype/> opens on a landing page: what FootballOS is and for whom, the five-step loop, four live cards rendered by the product's own components (candidate grade with rationale, two separate confidence readings, frame-linked evidence, a No Grade abstention with its remedy), what is simulated, and how the coach stays in control. Two calls to action lead in one click to a demo (`#/demo`) or to the research flow (`#/research`). |
| Functional web page that introduces the product | Screen 1 (research mode) remains the research intake view: what FootballOS helps a coach do, what the user can try, that the AI is simulated, and that the coach decides. It leads directly into the workflow. |
| Users can interact with the application | Seven connected screens; six seeded plays; frame-by-frame evidence navigation; accept / change / No Grade decisions with structured reasons; editable practice focus; feedback form; JSON export. |
| Demonstrates how the AI features function | Each play shows a simulated candidate grade, a short rationale, time-stamped evidence tied to diagram frames, missing or uncertain evidence, and two separate confidence readings. Abstention (No Grade) is shown as a first-class outcome. |
| Clearly communicates AI outputs, inferences and recommendations | Candidate grade + rationale + evidence on one screen; practice focus shows the plays and findings behind it and what was excluded. |
| Helps users interpret confidence and accuracy | Confidence bands are explained in plain language on the team-context screen and again on every play. They are labelled as authored, illustrative values. "Model accuracy: not evaluated in this prototype" appears in the header and on every screen where a number could be mistaken for accuracy. Coverage is shown separately from both. |
| Designs for appropriate trust | Evidence before assertion, visible uncertainty, required reasons for corrections, a blind-first play, and a deliberately questionable high-confidence candidate (Play 4). |
| Supports usability testing and iterative refinement | Baseline captured before the task; per-play timing; structured reason codes; feedback questions on evidence clarity, confidence, Grade 1 vs No Grade, ease of correction, usefulness of the focus, willingness to use, trust and remaining concerns; session export; a written protocol and findings template in `USABILITY_TEST_PROTOCOL.md`. |

The assignment is satisfied by the interactive application itself. No notebook, Figma file,
slide deck or PDF is part of the deliverable.

## 2. Verified requirements, conflicts, and assumptions

**Verified against project documents.** The FootballOS MVP PRD v0.2 (internal, August 2026)
and Vision & Product Strategy v0.2 set product principles that the prototype follows
directly: *coach is the final authority*, *evidence before assertion*, *abstention is a
feature* ("a visible Not Gradable outcome is better than a confident but unsupported grade"),
*tablet-speed workflow*, and *privacy by design for minors*. Functional requirements in the
PRD that the prototype demonstrates in simulated form include FR-705 (structured rationale
with time-coded evidence), FR-706 (confidence with primary uncertainty reasons, never
presented as a precise percentage without calibration), FR-707 (No Grade must record a
reason and a suggested next action), FR-709/710 (approve in at most two primary interactions;
the original result remains visible when overridden), FR-714 (changes to inputs mark
dependent results stale rather than silently rewriting them), FR-802 (recommendations only
from coach-reviewed evidence), and OR-607 (states must not rely on colour alone).

**Conflicts identified.**

- *Grade definitions.* PRD v0.2 §2.4 uses "successful / mixed / unsuccessful action" anchors
  and states that the 1–3 anchors are starting semantics to be refined by football experts.
  The Module 7 brief (October 2026) supplies more specific wording ("Standard met / Partially
  met / Standard not met / Insufficient evidence"). The brief is the more recent and more
  specific specification, so the prototype uses it, and the No Grade definition now names
  the four insufficiency conditions (visibility, identification, assignment knowledge,
  context).
- *Branding.* No FootballOS document defines a colour palette; the PRD only requires
  contrast and non-colour cues. The earlier prototype used navy and green. The brief
  specifies dark navy, crimson and burnt gold, so the palette was changed to match. This is
  an implementation choice, not a documented brand.
- *Cagan edition year.* The module lists Cagan (2018); the excerpt actually consulted is the
  ProQuest edition dated 2017 (Wiley). The reference list cites the 2017 edition because
  that is the text read.
- *Norman (2011), chapters 4 and 7.* Listed in the module but not available in the
  supplied materials. They were not consulted and no claims are made about their content.

**Implementation assumptions (not derived from a document).**

- The storyboard diagram (pre-snap, first step, contact, result) is a reasonable stand-in
  for footage in a usability study. It is labelled as illustrative wherever it appears.
- "AI misread the assignment" and "Other" are logged but never drive a practice focus,
  because they describe the review rather than the player. When such a reason is the only
  thing recorded on a Grade 1 or 2, the result is "Clarify the coaching issue," not a
  recommendation (§3.5).
- A correction to Grade 3 is "standard met"; the reason given explains the overrule and is
  shown under "logged, not treated as a deficiency."
- Review time accumulates across every visit to a play while the tab is visible; saving does
  not start or end an interval. The definitions are printed on the results screen and in
  the export (§3.6).

## 3. Design rationale, with sources

### 3.1 Appropriate trust and reliance (Weisz et al., 2024)

Weisz et al. (2024) group their guidance into six principles. Four of them shaped the
prototype most directly.

**Design for appropriate trust and reliance.** The authors' strategies are to *calibrate
trust using explanations*, *provide rationales for outputs*, *use friction to avoid
overreliance*, and *signify the role of the AI* (Weisz et al., 2024, Table 1 and Appendix
A.3). In the prototype:

- *Calibrating trust with explanations:* the landing screen, the banner and the team-context
  screen state what the system can and cannot do, that outputs are simulated, that
  confidence labels are illustrative, and that accuracy has not been evaluated. Confidence
  meanings are written for coaches, not statisticians, and High explicitly says "high
  confidence does not mean correct."
- *Rationales:* every candidate shows a short rationale plus time-stamped evidence, and each
  evidence item is linked to a storyboard frame so the coach can look at what the claim
  refers to rather than take the sentence on faith.
- *Friction against overreliance:* Weisz et al. describe cognitive forcing functions such as
  requiring the user to render a decision before seeing the AI's output. Play 4 does exactly
  this (blind-first), and it is deliberately a questionable high-confidence Grade 1 so the
  study can observe whether a coach inspects the evidence or defers. A grade change requires
  a structured reason, and so does any final No Grade; the "Not saved yet — pick a reason"
  state makes the pause visible.
- *Signifying the role:* the system is labelled "Simulated AI candidate" and the decision
  section is "Your decision." The AI proposes; the coach disposes. The product documents
  frame the same role ("coach is the final authority").

**Design for imperfection.** Weisz et al. (2024, Appendix A.6) recommend making uncertainty
visible, using "I don't know" responses when confidence is low, offering ways to improve
outputs, and providing feedback mechanisms. No Grade is the prototype's "I don't know,"
with the reason and "what would make this gradable" shown. Each play lists missing or
uncertain evidence under its own heading with a distinct marker. Coaches improve outputs by
changing grades, marking No Grade, adding notes, and editing the practice focus; structured
reasons and the feedback form are the explicit feedback channel.

**Design for mental models.** The authors stress orienting users to the system's behaviour
and teaching effective use in context (Weisz et al., 2024, Appendix A.2). The team-context
screen teaches the grade scale, puts Grade 1 and No Grade side by side, and explains both
confidence readings before the first candidate appears. The practice-focus screen shows
exactly which plays and findings produced the focus and which were excluded, so the coach's
model of "where did this come from" matches how it was built. The usability protocol's first
task ("what do you expect this to do?") exists to *evaluate* that mental model rather than
assume it.

**Design for co-creation.** Weisz et al. (2024, Appendix A.5) call for co-editing of
generated outputs while the user retains agency. The practice focus is the clearest
instance: it is composed from the coach's own approved decisions, and the coach can accept,
edit, or dismiss it. If the coach later changes any decision, the focus is marked stale and
must be reviewed again rather than silently kept.

### 3.2 Trustworthy interface factors (Zieglmeier & Lehene, 2022)

Zieglmeier and Lehene (2022) organise trustworthiness factors into purpose, process and
performance dimensions and derive interface measures for the first two. The prototype
applies several of their measures:

- *Transparency* — "explanatory texts should make clear what functionality exists" and
  systems should be "transparent about the risks and limitations of its functions"
  (Zieglmeier & Lehene, 2022, §5). The simulated-AI banner, the accuracy statement, the
  confidence disclaimer and the "what would make this gradable" note are all limitation
  statements placed where the limitation applies.
- *Predictability* — deterministic design in which observable state maps directly to system
  events, with the system telling users its state and the actions available (§5). The
  practice focus is deterministic and reproducible from the decisions; the "Saved" and
  "Not saved yet" states, the "stale" state, and the disabled Continue buttons tell the coach
  where they are and what is possible. Controls keep the same position, wording and
  colour scheme on every screen — the authors note that a colour scheme that changes between
  screens reduced perceived trust in their study (§6.1).
- *Communication* — short, clear, non-intrusive status messages in a positive tone (§5). The
  prototype uses one-line status text ("Saved: Grade 2 (candidate changed)") rather than
  modal interruptions.
- *Credibility and usability* — text-based interfaces and reduced complexity increase
  credibility; ease of navigation, consistency, readable typography and reduced clutter and
  animation were the measures with the largest effect in their evaluation (§5, §6.3). The
  prototype has no animated assistant, no decorative motion, a consistent card layout, and
  larger, consistently placed controls sized for a landscape tablet.
- *Benevolence and perceived security* — handling user data with care and making data
  handling visible (§4.1, §5). The prototype states on every relevant screen that data stays
  in the browser, keeps only the host of a pasted link, asks users not to enter personal
  information, and requires a two-step confirmation before clearing a session.

The important caveat comes from the same paper: their measures target *perceived*
trustworthiness, and the authors explicitly set aside the performance dimension
(competence, reliability, validity) because interface changes alone do not address it
(Zieglmeier & Lehene, 2022, §5, §7). The prototype therefore never lets a trustworthy-looking
interface imply a reliable model: "Model accuracy: not evaluated in this prototype" is
stated throughout, confidence is labelled as illustrative, and coach agreement is never
converted into an accuracy figure. Perceived trustworthiness and actual model reliability are
kept distinct on purpose.

### 3.3 Usability testing in discovery (Cagan, 2017)

Cagan (2017, Chapter 50) argues that usability testing belongs in discovery, with
prototypes, before the product is built. His practical guidance shaped both the prototype's
instrumentation and the proposed study:

- *Representative users doing the primary tasks.* The protocol recruits 3–5 working
  high-school coaches and uses the tasks a position coach would do most: start a review,
  interpret a candidate, correct one, handle a snap with insufficient evidence, judge the
  practice focus.
- *Check the landing page first.* Cagan advises seeing whether a first-time visitor can tell
  what the product does before they start tasks, because that context is lost afterwards.
  Task 1 in the protocol is exactly that question, asked before the baseline is entered.
- *Do not lead the witness.* Cagan recommends parroting rather than helping and watching
  what users do more than what they say. The protocol's facilitator rules follow this, and
  the prototype itself avoids explaining the interface before use.
- *Three outcomes.* Cagan's three cases — completed without help, struggled but finished,
  gave up — are the protocol's unassisted / assisted / abandoned codes, with
  "misunderstanding" added because the module's central risk is semantic (confidence read as
  accuracy; No Grade read as poor execution).
- *Fix friction quickly; skip big reports.* The findings-and-revisions template is one short
  table per round, and the prototype is designed so that copy, reason labels and layout can
  be changed between participants.

#### 3.3.1 The landing page and demo mode

Cagan's landing-page check — "see if they can tell from the landing page what it is that
you do" — was originally applied only inside the research protocol (Task 1). The earlier
entry screen was a research-intake form that demanded a baseline estimate before showing
any AI output, which serves the study but fails a first-time visitor. The deployed version
therefore opens on a landing page that answers Cagan's question before any task: one
sentence on what FootballOS is and for whom, one on the promise (the system prepares
evidence and proposes a grade; the coach decides), the five-step loop, and four cards that
show how the AI output is presented. The cards are not screenshots; they render the same
`GradeBadge`, `ConfidenceTag`, `PlayDiagram` and `EvidencePanel` components on the same
seeded plays the workflow uses, so what the visitor reads cannot drift from what the
product does, and the evidence card is interactive (selecting an evidence item changes the
frame). The honesty statement — simulated AI, authored data, fictional program, nothing
leaves the browser — sits directly under the calls to action, in the same register as the
global banner, and the accuracy statement stays in the header.

Demo mode (`#/demo`) exists so a visitor can reach the interactive workflow in one click.
It collects no baseline and fabricates none (`baseline: null`; the results screen says "No
baseline collected in demo mode"), marks the session `mode: 'demo'`, and opens the review
queue with the film check visible. From there every trust mechanic is identical to
research mode: evidence navigation, the two-interaction correction with a required reason,
reasons for every final No Grade, the Play 4 blind-first probe, the stale practice focus,
feedback and export. The header and the results screen say "Demo session — not research
data," and the export carries the mode, so demo sessions can never be pooled with
research sessions. Research mode (`#/research`) is the unchanged Screen 1–7 flow.

The landing page deliberately looks like the same product as the seven screens: same
palette, type, card layout and control placement, no marketing imagery, no superlatives.
Zieglmeier and Lehene (2022, §6.1) report that a colour scheme that changed between screens
reduced perceived trust in their evaluation; a marketing-styled entry page bolted onto a
working tool would introduce exactly that discontinuity at the moment a visitor forms their
first impression. For the same reason the landing page shows no percentage, no accuracy
figure, no time-saved claim, no testimonial and no user count — nothing that a trustworthy
appearance could be mistaken for evidence of performance (§5, §7).

#### 3.3.2 The research entry path and what a baseline can claim (October 24 revision)

The landing page is right for a first-time visitor and wrong for a research participant: it
shows candidate grades, confidence labels, evidence examples, a demonstration of the loop
and a suggested demo length before any baseline could be taken, and the earlier intake form
offered time chips (5 to 45 minutes) that anchor the very estimate being collected. The
research entry (`#/research`) now collects the baseline first on a screen that is neutral
about the product: no example output, no description of grades or confidence, an empty time
field with no suggested values, an "I'm not sure" option that records a missing estimate
rather than forcing a number, and a prior-exposure question. The expected task length is
shown only afterwards, on the team-context screen. The usability protocol sends participants
to this link, not to the landing page.

The baseline record was also made honest about what it can claim. `capturedBeforeReviewTask`
says that the baseline preceded the review task in this session, which the application
enforces. It does not say the participant had never seen the prototype, which no browser
can establish. The `exposure` record therefore distinguishes four things: how the form was
reached (research link or landing page), whether the landing page rendered in this visit,
whether a demo start or landing view was recorded earlier in this browser (a separate
storage key that survives a session being replaced), and the participant's own answer. The
record carries a fixed caveat that "false" means "none recorded." This is the same
transparency-about-limitations principle (Zieglmeier & Lehene, 2022, §5) applied to the
research instrument rather than to the AI.

### 3.4 Using AI in UX work while keeping human judgment (Moran & Nielsen, 2023)

Moran and Nielsen (2023) recommend using generative AI as a "sidekick" that speeds up UX
work without replacing human judgment, warn that hallucinations "can be convincing," and
state that AI "cannot replace user research with real users." Three consequences follow for
this submission:

- AI assistance was used to implement and document the prototype, and the result was
  reviewed by a person; the AI-use disclosure describes exactly what was done.
- The application contains no live AI and makes no accuracy claim, so there is nothing for
  a convincing hallucination to hide behind.
- The usability study is a proposal with no invented participants, quotations or results.
  Real coaches are the only valid source of findings.

### 3.5 Four practice-focus states, and why "maintain" was wrong

The earlier practice focus had three outcomes: insufficient evidence, a focus, and a
"maintain" fallback used whenever graded plays existed but no teachable finding did. The
fallback was reached in a case it should not have covered: a coach recorded Grade 1 on Play
5 with the reason "AI misread the assignment," and the screen recommended reinforcing the
standard with Play 5 listed among the examples. The grade said there was a problem; the
reason, by design, described the review rather than the player; and the fallback read the
absence of a technique reason as the absence of a problem.

The revised logic decides in order. If no reviewed play has a coach grade, the result is
insufficient evidence with a film next step (abstention as a feature, Weisz et al., 2024).
If every graded play is Grade 3, the result is a reinforcement limited to those plays. If
any final grade is 1 or 2 but no usable technique finding exists, the result is "Clarify
the coaching issue": the plays and grades are named, the reason is stated not to identify
what to coach, and each play gets a working Reopen control. Only when coach-approved
technique findings exist is a focus built, and even then two limits are stated: a finding
supported by one play is labelled a single finding rather than a recurring issue, and
below-standard plays without a technique reason are listed as not accounted for. This
follows the predictability measure in Zieglmeier and Lehene (2022, §5): observable state
maps to a named outcome, and the system tells the user what is and is not covered rather
than smoothing a gap into a recommendation.

### 3.6 Review time that survives revision

Per-play review time previously restarted whenever a play was reopened, so a coach who
revisited a play to revise it lost the earlier time, and the summary summed only the latest
visits. Time is now recorded as intervals: one opens when the play-review screen shows a
play with the tab visible, and it closes on navigation, when the tab is hidden, or when
the page goes away, with a five-second heartbeat so a reload closes the interval at a
known moment instead of guessing. Intervals never overlap, reopening adds a new one, and
saving a decision neither starts nor ends one, so repeated saves cannot double-count.
Accumulated review time is the sum of those intervals; session elapsed time is kept
separate and includes everything. Sessions saved before this change have no intervals, so
they are marked legacy, their latest-visit seconds are shown labelled as such, and no
cumulative time or comparison is derived for them.

The comparison with the baseline is shown only in a research session with a numeric
baseline, accumulated timing, and six final decisions. It is labelled exploratory and is
accompanied by scope notes: the baseline describes the coach's own film, own method and
full grading from memory; the measured time covers only the play-review screen with
candidates already prepared. Nothing on the screen or in the export claims a demonstrated
productivity improvement.

### 3.7 Scan-first review screen

The play-review screen was reordered so a coach can take it in at a glance: a sticky
toolbar (Play N of 6, coverage, practice-focus status, previous and next play); the film or
diagram and the evidence list first; then the candidate badge with a one-line rationale,
the two confidence readings as compact tags with a short meaning each, and the missing or
uncertain evidence; then the decision controls with a Saved / Not saved pill that carries
a glyph as well as colour. Extended confidence definitions, the simulation statement for
the screen, and the full Grade 1 versus No Grade text moved into native `<details>`
elements, which are keyboard operable and announced as expandable. The global banner was
shortened to one line with the same expandable detail, so the same disclaimer no longer
appears in full in the header, the banner and every card (reduced clutter and consistency
as credibility measures, Zieglmeier & Lehene, 2022, §5). The blind-first behaviour on Play
4 is unchanged: candidate, rationale, confidence and candidate evidence stay hidden until
the coach submits an independent grade.

## 4. Confidence, accuracy and coverage — kept distinct

| Concept | What the prototype shows | What it never does |
| --- | --- | --- |
| Confidence | Two separate bands (player identification, grade) with plain-language meaning and a three-dot glyph so the band is not colour-only. Labelled as authored, illustrative values. | Combine the two bands; present a percentage; imply that High means correct. |
| Accuracy | "Model accuracy: not evaluated in this prototype." | Invent a percentage; convert accepted candidates into an accuracy rate. |
| Coverage | Reviewed · graded · No Grade, shown together on the queue, the practice focus and the summary. | Treat coverage as correctness. |

Play 4 — a high-confidence Grade 1 whose stated evidence does not establish the guard's
responsibility on the combo — is preserved so the interface demonstrates why evidence must
be inspected regardless of confidence.

## 5. Accessibility and layout notes

- Every interactive element is a native button, input or link with a visible focus ring;
  the frame selector also responds to the left and right arrow keys.
- Saved-state and pending-state messages are in live regions; the practice-focus stale
  notice is an alert.
- Grade, confidence and film-quality states all carry text and, where useful, a glyph
  (✓ / ○ / ●●○ / dashed border) so colour is never the only cue.
- Landscape tablet and desktop are the primary layouts (two-column review screen); below
  960 px the layout stacks and wide tables scroll horizontally inside their card.
- The diagram is an SVG with a role of image and a description that changes with the frame.

A human accessibility audit has not been performed; see the verification summary for what
was and was not checked.

## References

Cagan, M. (2017). Testing usability. In *Inspired: How to create tech products customers
love* (2nd ed., pp. 218–224). John Wiley & Sons.

Moran, K., & Nielsen, J. (2023, November 3). *AI for UX: Getting started*. Nielsen Norman
Group. https://www.nngroup.com/articles/ai-ux-getting-started/

Weisz, J. D., He, J., Muller, M., Hoefer, G., Miles, R., & Geyer, W. (2024). *Design
principles for generative AI applications* (arXiv:2401.14484v1) [Preprint]. arXiv.
https://arxiv.org/abs/2401.14484

Zieglmeier, V., & Lehene, A. M. (2022). *Designing trustworthy user interfaces*
(arXiv:2202.12915v1) [Preprint]. arXiv. https://arxiv.org/abs/2202.12915 (Conference
version: *Proceedings of the 33rd Australian Conference on Human-Computer Interaction*,
OzCHI '21, 2021.)

### Internal project documents consulted (unpublished)

- *Project FootballOS — MVP Product Requirements Document v0.2* (August 2, 2026).
- *Project FootballOS — Vision and Product Strategy v0.2* (August 2, 2026).
- *Project FootballOS — Documentation Library Guide v0.2* (August 2, 2026).
- FootballOS low-fidelity usability prototype v0.1 (September 2026) — the codebase this
  version extends.

### Not consulted

Norman, D. A. (2011), *The design of everyday things*, chapters 4 and 7 — listed in the
module but not available in the supplied materials. No claims in this document rely on it.
