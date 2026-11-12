# Draft: OpenBeta community

**DRAFT, not posted.** Replace `<...>` before use. Read [README.md](README.md) first.

---

**Title:** SandBag: 3D boulder scans with annotated lines, built on OpenBeta data (looking for feedback)

Hi all. I'm building SandBag, an open-source 3D boulder visualizer. Climbers upload a phone scan of a boulder (Polycam, Scaniverse, anything that exports GLB/OBJ/PLY), it goes through automated quality checks and community review, and then people can annotate it in 3D: start holds, the line, topout, downclimb, and vote on grades.

**How it relates to OpenBeta:** we don't duplicate your data. Areas, climbs and the grades of record come from OpenBeta; we store only the 3D layer (the mesh and the annotations) and link it to an OpenBeta area or climb id. Anything we build on your API is throttled and cached, and we show where the data comes from.

**Privacy:** if an area is marked hidden, nothing we publish carries its coordinates (APIs, logs, link previews, exports). That rule is enforced in code and linted, not just documented.

**Open:** code is AGPL-3.0; scans and annotations are CC BY-SA 4.0. There is a per-boulder zip and a whole-corpus dataset export with a documented schema.

**Honest status:** pre-alpha. The loop (upload, checks, review, annotate, save) works end to end on a local stack, including a 1M-triangle wall scan. There is no hosted demo yet and almost no data. <DEMO URL if it exists, otherwise: "Run it locally with the README quickstart, about 90 seconds of command time once Docker images are cached.">

**What I'd like from you:**
1. Does attaching a scan to an OpenBeta area or climb id match how you'd want it linked? What breaks?
2. Is there anything we do with your API that you'd rather we didn't?
3. Climbs or areas you'd like to see scanned first.

Repo: https://github.com/sandbagbeta/sandbag
