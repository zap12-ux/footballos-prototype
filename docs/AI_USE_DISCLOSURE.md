# AI-use disclosure — FootballOS Module 7 prototype

**Submitted by:** the student (course: Developing AI Solutions, MPIM 6750, Georgetown University)
**Date:** October 15, 2026

## What AI was used for

- **Code implementation.** An AI coding assistant (Claude, Anthropic, used through Claude
  Code) wrote and edited the TypeScript, React, CSS and test code in this repository from a
  detailed written brief, extending the existing FootballOS prototype. The assistant read the
  prior prototype source, the FootballOS product documents in the project folder, and the
  Module 7 readings before making changes.
- **Documentation.** The same assistant drafted the README, this disclosure, the design
  rationale, the usability protocol, and the change-and-verification summary. The design
  rationale cites only sources whose text was actually read in this session; the Norman
  chapters listed in the module were not available and are not cited.
- **Automated verification.** The assistant ran the project's type check, unit and
  integration tests, and production build, and drove the running application in a browser to
  check the workflow and the trust behaviours described in the verification summary.

## Second session (October 24, 2026): landing page, demo mode, deployment

A second session with the same assistant added the grader-facing landing page, hash-based
entry routes, demo mode, the resume control, twelve tests, the GitHub Pages deployment
workflow, the document updates in this folder and the Module 7 submission description,
working from a written brief that fixed the honesty, trust, accessibility and palette
constraints in advance. The assistant ran the type check, the test suite and the production
build before and after the changes, walked the landing page in a browser at desktop and
phone widths (checking heading order, keyboard-reachable controls, and horizontal
overflow), and searched the repository for names, e-mail addresses and phone numbers
before it was published. The student reviewed the landing-page copy against the design
rationale, decided which GitHub repository to publish from and made it public, authorised
the deployment, and is responsible for the submitted description.

## What AI was not used for

- **The application contains no AI.** Every "candidate grade", confidence label, rationale,
  evidence note, film-quality read and storyboard frame is hand-authored data. No model is
  called at runtime and nothing is sent anywhere.
- **No usability sessions were run or simulated.** The protocol is a plan. No participants,
  quotations, findings or improvements were invented.
- **No accuracy or time-saving results were generated.** The prototype states that model
  accuracy was not evaluated, and its timing comparison is labelled as illustrative.

## Human review and judgment

Consistent with Moran and Nielsen's (2023) advice to use AI as an assistant while keeping
human judgment in the loop, the student is responsible for the submission: reviewing the
code and documents, running the application, deciding what to keep, and confirming that the
claims in the documents match the behaviour of the application. Anything the assistant could
not verify is listed as unverified in the change-and-verification summary rather than claimed.

## Reference

Moran, K., & Nielsen, J. (2023, November 3). *AI for UX: Getting started*. Nielsen Norman
Group. https://www.nngroup.com/articles/ai-ux-getting-started/
