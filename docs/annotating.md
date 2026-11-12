# Annotating a climb

Open a published boulder and choose **Add a climb** (`/boulder/<scan id>/annotate`). You must be signed in. Desktop is the primary surface; on a phone you tap to place holds and the climb builder collapses behind a button (screens narrower than 360px get the read-only view).

1. Click or tap the rock to place holds (keys 1 to 4 pick the type), drag to move, and order them in the sequence list. A climb needs 1 or 2 start holds and at least 3 non-foot holds (start, hand, finish).
   - **Foot holds are optional.** They are single points: not part of the line, not numbered, not in the sequence, and not counted toward the 3 holds. They appear in a separate "Feet (optional)" list where each can be removed. A foot belongs to its climb only; on the boulder page only the selected climb's feet are shown.
2. Optionally draw a topout or downclimb path (Enter finishes, Escape cancels).
3. Name the climb, pick a proposed grade (VB to V17), and optionally add a description and first-ascent info.
4. **Save climb for review** sends it to a reviewer. The server re-checks every hold against the scan's mesh, so problems are listed with a button to select each flagged hold.

If the scan's mesh was replaced while you worked you will be asked to reload; holds are tied to one mesh version and must be placed again. Saved climbs start as `pending_review`; they appear on the boulder page once approved.

## Unsaved work is kept in your browser

While you edit, the holds, paths and details are saved to this browser's local storage (one draft per scan for a new climb, and one per climb you are editing). If you reload, close the tab or a save fails, reopening the annotate page restores the draft with a notice and a **Discard draft** button. The draft is cleared after a successful save. If the scan's mesh changed since the draft was made, its holds cannot be reused, so you get a notice instead and can discard it. If storage is blocked or full the editor still works, just without a draft. The draft stays on your device; nothing is uploaded.

## Editing your climb

While a climb is waiting for review you can change it. Open it from **Your climbs waiting for review** on your account page, or from the **Edit your climb** link on a reviewer's "needs changes" notification (`/boulder/<scan id>/annotate?climb=<climb id>`). The editor opens with its holds, paths, grade, description and first-ascent info; the name is kept and can't be changed there. **Save changes** replaces the holds and paths (same checks as a new climb, via `saveClimb` with the climb id) and the climb stays `pending_review`.

- **Only the author, and only while waiting for review.** Anyone else, or a climb that was published or rejected, gets a page saying what happened, what they can do and the next steps (the same wording shape as save failures). The server checks this again on save.
- **Drafts are kept apart.** An edit has its own browser draft (`sandbag:draft:v1:<scan id>:edit:<climb id>`), so it never overwrites a new-climb draft (`sandbag:draft:v1:<scan id>`). Reopening the edit page restores the unsaved changes with the usual notice.
- Feet stay per climb, unordered and outside the line, as for a new climb. If the scan's mesh was replaced since the climb was made, its holds no longer line up and saving asks you to place them again.
