# Annotating a climb

Open a published boulder and choose **Add a climb** (`/boulder/<scan id>/annotate`). You must be signed in, and annotation needs a desktop browser with a mouse; phones and tablets get the read-only view.

1. Click the rock to place holds (keys 1 to 4 pick the type), drag to move, and order them in the sequence list. A climb needs 1 or 2 start holds and at least 3 holds in total.
2. Optionally draw a topout or downclimb path (Enter finishes, Escape cancels).
3. Name the climb, pick a proposed grade (VB to V17), and optionally add a description and first-ascent info.
4. **Save climb for review** sends it to a reviewer. The server re-checks every hold against the scan's mesh, so problems are listed with a button to select each flagged hold.

If the scan's mesh was replaced while you worked you will be asked to reload; holds are tied to one mesh version and must be placed again. Saved climbs start as `pending_review`; they appear on the boulder page once approved.

Editing an existing pending climb (`?climb=<id>`) is not available in the UI yet, although the `saveClimb` server action supports it.
