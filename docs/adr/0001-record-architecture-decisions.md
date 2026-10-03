# 1. Record architecture decisions

Date: 2026-10-03

## Status

Accepted

## Context

Rosse is being rebuilt from one self-contained page (v21) as a WebGPU project. Many decisions in it are not obvious from the code: why something runs on the GPU or the CPU, why the golden test is not pixel-exact, what "the same drawing" means. Reviewers and future contributors need the reasons as well as the result, and the reasons need to survive the code changing.

## Decision

We record every significant architectural decision as an Architecture Decision Record in `docs/adr/`, numbered `NNNN-title.md`, in Michael Nygard's format: title, date, status, context, decision, consequences. An ADR is never edited once accepted, except for its status. A changed decision gets a new ADR that supersedes the old one, and both link to each other. `docs/architecture.md` is the readable overview and links to the ADRs; where they disagree, the ADR wins.

## Consequences

- A pull request that changes a recorded decision must include an ADR. CONTRIBUTING.md says so.
- Records cost a little writing per decision. In return, review conversations start from the stated reasons.
- Superseded records stay, so the history of the design can be read in order.
