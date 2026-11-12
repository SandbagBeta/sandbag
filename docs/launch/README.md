# Launch posts (drafts)

**Nothing here has been posted anywhere. These are drafts for the maintainer to edit and post by hand.** Posting is a human decision: each community has its own rules, and a post that overclaims costs trust that is hard to win back.

Issue: [#39](https://github.com/SandbagBeta/sandbag/issues/39). Acceptance: posted; first-week feedback triaged.

| Draft | Where | Tone |
|---|---|---|
| [openbeta.md](openbeta.md) | OpenBeta community (Discord / GitHub discussions) | Technical peers; we build on their data |
| [r-bouldering.md](r-bouldering.md) | r/bouldering | Climbers first; no jargon; check the sub's self-promotion rules |
| [climbing-discords.md](climbing-discords.md) | Local and regional climbing Discords | Short, one ask |
| [stevens-nighthacks.md](stevens-nighthacks.md) | Stevens / NightHacks | Project write-up and demo |

## Where the project actually is (say this, not more)

Checked 2026-11-12. Keep every post consistent with it, and update this list before posting.

**Works, verified locally:**
- Upload a phone scan, automated checks (QC), review, publish, annotate a climb, save it. A 1M-triangle wall scan went through all of that on a local stack.
- Plain-language errors on upload, QC and save (what happened, which step, what to do).
- Open data: per-boulder zip and a whole-corpus dataset export, CC BY-SA 4.0.
- Hidden-location areas never expose coordinates (enforced in code and lint).

**Not verified or not done:**
- **There is no hosted demo yet.** The app has only run on a local stack. Do not post a "try it" link until a deployment exists and an upload has been tried there. (The hosted setup checklist is `docs/hosted-setup.md`, in its own PR.)
- Browser checks of grade voting, request-changes with notifications, and retry after a failed check are in progress. Backend rules for them were checked against the database.
- Seed data is not there: the goal is 10 scans and 20 climbs ([#35](https://github.com/SandbagBeta/sandbag/issues/35)); today there are one or two test scans.
- The scale of a scan comes from the file's units; a maintainer can correct it in review, but there is no screen for that yet.
- Annotation is desktop-first. Phones can view; placing holds on a phone is not a target yet.
- The hold-detection ML idea is a roadmap item, not a feature.

## Before anyone posts

- [ ] A public URL exists and a stranger can upload, or the posts say "run it locally" and say so in the first line.
- [ ] `<DEMO URL>` and `<SCREENSHOT/GIF>` placeholders are replaced. Use a scan you own or a CC0 / CC BY-SA one.
- [ ] The honest-status list above is current.
- [ ] Read each community's rules on self-promotion; ask a mod first where the rules are unclear.
- [ ] Never name or locate a sensitive or closed area in a post or screenshot.

## After posting

Triage within the first week: every piece of feedback becomes an issue (label `lane:*`) or a reply. Keep a running list here:

| Date | Where | Feedback | Issue |
|---|---|---|---|
| | | | |
