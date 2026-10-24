# FootballOS — usability test protocol (proposed, not yet run)

**Status:** this is a plan for an initial qualitative round. No sessions have been
conducted. Nothing below reports a participant, a quotation, or a result.

## Purpose

Learn whether working high-school coaches can use the FootballOS review workflow without
help, whether they interpret the simulated AI candidate the way the design intends, and
where the interface's model of the task conflicts with theirs (Cagan, 2017). The two
highest-priority risks are semantic:

1. reading **confidence** as **accuracy** ("High means it's right"), and
2. reading **No Grade** as **poor execution** rather than insufficient evidence.

The study is formative. It does not measure time savings, model accuracy, or coaching
effectiveness, and it will not be reported as if it did.

## Participants

- 3–5 high-school football coaches who grade offensive-line film at least during the
  season. Position coaches preferred; a coordinator or head coach who grades is acceptable.
- Mixed current methods (Hudl-style platform, film plus spreadsheet, film only).
- Exclusions: anyone who helped design the prototype.
- No names, school names, or player information are recorded. Participants are referred to
  as P1–P5. The prototype asks for none of this and the facilitator does not type any of it
  into the application.

## Roles, setting and materials

- One **facilitator** runs the session and one **note-taker** records observations
  (Cagan, 2017). Debrief together immediately afterwards.
- In person at the coach's office or a quiet table, or remote over screen share. A
  landscape tablet or laptop with a current browser.
- The prototype running locally (`npm run dev`, http://localhost:5173), reset before each
  participant.
- The session export (Download Session JSON) is saved with the notes for that participant.
- 35–45 minutes per session.

## Facilitator rules

- Say at the start: this is an early prototype with simulated AI; it is the prototype being
  tested, not the coach; candid reactions help.
- Do not explain the interface before the tasks. Do not lead. If the coach asks "does this
  mean X?", reflect it back ("you're wondering whether it means X?") rather than answer
  (Cagan, 2017).
- Allow silence. Offer help only when the coach is clearly stuck and has stopped trying;
  record that help was given.
- Keep the coach in use mode. Do not ask what they would change; watch what they do.

## Tasks

Each task lists what the facilitator says, the success criterion, and what to watch for.
Record the completion code for each task (see *Measures*).

| # | Facilitator prompt | Success looks like | Watch for |
| --- | --- | --- | --- |
| 1 | *(Before anything else, on the start screen)* "Just from this page, what do you expect FootballOS to do? What would it do for you?" | The coach describes AI-proposed grades that they review and correct, built into a practice focus, with simulated AI. | Expectation of automatic grading with no review; belief that real film analysis will happen; belief that this is a finished product. |
| 2 | "Begin reviewing the demo the way you would if this were your film this week." | Enters a baseline estimate and method, continues through team context, uses the demo film, reaches the queue, and opens a play. | Hesitation at the baseline; skipping the grade definitions; trying to upload a file first; reaction to the film check forecast and to the simulated processing. |
| 3 | *(On Play 2 or Play 5)* "Tell me what this screen is telling you about this snap. What do the two confidence labels mean? What would you look at before deciding?" | Distinguishes the candidate grade from the evidence; explains ID confidence and grade confidence as different; uses the frames or evidence list; does not equate High with correct. | **Priority:** confidence read as accuracy; the two confidence readings treated as one; the diagram taken for real footage or tracking; ignoring the "missing or uncertain" list. |
| 4 | *(On Play 4, blind-first)* "Grade this one yourself first. Then do whatever you would normally do with the system's read." | Records an independent grade; after the reveal, inspects the evidence and uncertainty; keeps or changes the grade deliberately; completes a change in two interactions with a reason that fits. | Deferring to the candidate without looking; frustration at being asked to grade first; reason options that do not match how the coach describes the mistake; not noticing that the decision is saved. |
| 5 | *(On Play 3 or Play 6)* "This snap came back No Grade. What does that mean here, and what would you do with it?" | Explains No Grade as insufficient evidence, not a bad grade; uses "what would make this gradable"; accepts No Grade with a reason or overrides it knowingly. | **Priority:** No Grade read as a 1 or as the player's fault; No Grade read as the product being broken; irritation at having to give a reason to accept an abstention. |
| 6 | *(After all six plays)* "Look at the practice focus. Is it useful? Is it right? Change it if you would." | Reads the plays and findings behind the focus and the coverage line; accepts, edits or dismisses with a stated reason; understands what was excluded. | Not noticing which plays were excluded; expecting a full practice plan; confusion when going back to change a play and seeing the focus marked stale. |
| 7 | "Finish by completing the feedback questions, then export the session." | Completes the form; downloads the JSON; understands the timing section is illustrative. | Reading the illustrative time difference as proven savings; missing the export; concern about what was recorded. |

Optional probes if time allows: "If this covered six of every ten snaps, would you still
use it? Where is your cut-off?" and "What would stop you from trusting or using this?"

## Measures

For every task, record one completion code and any comments:

| Code | Definition |
| --- | --- |
| **Unassisted** | Completed the task with no help from the facilitator. |
| **Assisted** | Completed only after a hint or explanation. Record what was said. |
| **Abandoned** | Stopped trying, or would have left the product if it were real. |
| **Misunderstanding** | Completed or not, the coach's stated interpretation conflicted with the design intent. Record the exact interpretation. |

Always record, with the task number:

- any statement that treats confidence as accuracy, or High as "must be correct";
- any statement that treats No Grade as a low grade or as player fault;
- any statement that treats the diagram as real footage or as model output;
- whether the Play 4 reveal changed the coach's grade, and what they said while deciding;
- which reason labels were picked, and any label the coach wanted but could not find;
- relevant comments in the coach's own words (paraphrase is acceptable; do not record names).

From the session export, also note the per-play review times and the blind-first record.
These are context for the qualitative notes, not outcomes to report on their own.

## After each session

Debrief for ten minutes: facilitator and note-taker agree on codes and the two or three
most important observations. Write one short summary per participant (Cagan, 2017). If a
friction point is clearly a copy, label, or layout problem, fix it before the next session
and record the change in the revisions table; the test does not have to stay identical
across participants.

## Findings-and-revisions template

Copy one row per observation. Leave blank until sessions have been run.

### Findings

| ID | Participant | Task | Code (Unassisted / Assisted / Abandoned / Misunderstanding) | What happened (observed behaviour) | Coach's words (paraphrase, no names) | Severity (High / Medium / Low) |
| --- | --- | --- | --- | --- | --- | --- |
| F1 | | | | | | |
| F2 | | | | | | |

Severity guide: **High** — a priority misunderstanding (confidence as accuracy; No Grade as
poor execution) or an abandoned task. **Medium** — assisted completion or a non-priority
misunderstanding. **Low** — completed with minor friction or a comment only.

### Revisions

| Revision | Findings addressed | Change made to the prototype | Made before participant | How it will be re-checked |
| --- | --- | --- | --- | --- |
| R1 | | | | |
| R2 | | | | |

### Round summary (fill in after the round)

- Participants completed: ___ of ___ planned.
- Tasks with any Abandoned or High-severity finding: ___
- Priority confusions observed (confidence as accuracy / No Grade as poor execution):
  ___ / ___
- Open questions for the next round: ___

## Reference

Cagan, M. (2017). Testing usability. In *Inspired: How to create tech products customers
love* (2nd ed., pp. 218–224). John Wiley & Sons.
