# Design language (draft 1)

The boards in `boards/` show everything below in use (they open on the design canvas, where their images
live). `tokens.css` has every value.

## Principles
1. **Swiss by default.** Most of every page is type, grid and hairlines on flat cream paper with grain.
2. **Real objects, one job each.** Photographed things carry the texture and each does something: a print
   for a project, a post-it for a note that could change, a tab to mark a place, a tag for a status.
3. **A hand only on an object.** Handwriting appears where it would exist in life: Mark on Polaroid borders
   and tags, Patina on post-its and margins, Grain written onto figures. Never handwritten headings,
   buttons or navigation.
4. **Pins on boards, tape on paper.** Prints on the home table sit loose.
5. **Instrument or figure.** A full-width instrument sits directly under a project page's header; a small,
   numbered, captioned figure lives inside an article. The reader always knows whether they are using or
   reading.
6. **Two inks with jobs.** Magenta points at the thing to look at (at most once per view); red pencil marks
   a limit. Project inks only inside that project's own figures.
7. **One page per project.** An instrument makes it a project page (header, instrument, facts, write-up);
   without one, the page is the write-up.
8. **Say what it is.** Captions and notes are plain and exact; nothing unfinished or invented is hidden.

## Surfaces
- Page ground: flat cream (#efe9dc) with grain, everywhere.
- Real cream paper: a sheet laid on top, for layering (letters, print versions, floating panels such as the
  Almagest axis picker).
- Kraft: the home table. Green cloth: covers and the footer. Grid notebook: working and maths.
- At most three layers: surface, sheet, object. One surface per region.

## Objects
- Real scale, 2.7 px per mm; scale everything together on small screens.
- One light from the top left: every shadow falls down and right; photographed shadows are removed.
- Objects tilt between −2° and +2°, each with a fixed angle. Type, cards and instruments are square.

## Components
Poster header (title and tracked mono tagline left, justified columns right, red note only for a limit),
facts row, instrument frame, still figure, interactive figure, sidenote, list row, buttons (one filled per
view, 44 px targets, magenta focus ring), inputs (label and underline, 1 px slider track with a square
thumb, square checkboxes and toggles), tabs and paging.
