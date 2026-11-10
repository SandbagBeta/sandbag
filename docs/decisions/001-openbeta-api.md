# 001 — OpenBeta API: terms, rate limits, queries, cache design

- **Status:** Accepted. This was the research spike for #27. The client and cache are implemented in `src/lib/openbeta/` (see *Implementation notes (#27)*). The privacy decisions D1 and D2 were made by the maintainer.
- **Date:** 2026-11-09
- **Lane:** backend
- **Refs:** #27 (OpenBeta client + cache), #3 (schema v1). PRD §2, §5.6, §7, §8, §12

## How to read this document

Each claim is tagged with how it was checked:

- **[V]** checked against a public source, which is linked.
- **[L]** checked against the live production API (`https://api.openbeta.io`) on 2026-11-09. I sent exactly four read-only GraphQL POST requests:
  - `SearchAreas` for "Pawtuckaway";
  - `SearchAreas` for "Hammond Pond";
  - `AreaDetail` for Hammond Pond, including its children's climbs;
  - `AreaChildren` for Pawtuckaway.

  Every response-header and latency observation below comes from those four responses. Separately, I sent three GET requests to the website `openbeta.io` (`/terms`, `/tos`, `/privacy`) to look for terms of service. Those went to the website, not the API.
- **[S]** checked against the published GraphQL schema files in [`OpenBeta/openbeta-graphql@develop/src/graphql/schema/`](https://github.com/OpenBeta/openbeta-graphql/tree/develop/src/graphql/schema). Not run live.
- **[I]** my own inference or recommendation. Not confirmed by OpenBeta.

Nothing here is legal advice. Before launch, confirm the licensing points with OpenBeta and, if possible, with someone qualified (see Open questions).

---

## Context

PRD §5.6 and §7 make OpenBeta the source of truth for areas, boulders and climbs. SandBag stores only the 3D layer, keyed by OpenBeta UUIDs, plus a cached snapshot so the site keeps working when the API is down. Before writing the client we need to know four things:

- whether we may cache the data;
- what attribution is owed;
- what rate limits apply;
- which queries return what we need, including access information and coordinates. Coordinates are values-critical (PRD §2.2).

## Findings

### 1. Licensing and terms of use

| Topic | Finding | Tag |
|---|---|---|
| Data license | "Excluding photos and software source code, OpenBeta climbing data is published under the Creative Commons Public Domain (aka CC0)." | [V] [docs FAQ](https://docs.openbeta.io/faq) and [openbeta.io/about](https://openbeta.io/about) |
| Photos | Photos are **not** CC0. Each one carries its own credit (e.g. "© photographer"). | [V] [openbeta.io/about](https://openbeta.io/about) |
| API server code | The server code is AGPL-3.0. | [V] [repo README / license](https://github.com/OpenBeta/openbeta-graphql) |
| Docs site | The docs site is CC BY-SA 4.0. This covers the documentation only, not the data. | [V] [docs.openbeta.io](https://docs.openbeta.io) |
| ToS for the API | **No API terms of service were found.** `openbeta.io/terms`, `/tos` and `/privacy` all return 404. The README and docs set no usage terms. | [V] (checked 2026-11-09) |
| Commercial use | CC0 places no restriction on commercial use. | [V] (follows from CC0) |
| Caching / storing | CC0 allows copying and storing. Nothing found prohibits caching. | [V] license / [I] no ToS found |
| Attribution | CC0 does not legally require attribution. | [V] |
| Mountain Project provenance | Much OpenBeta content was imported from Mountain Project. onX/Mountain Project claimed copyright and filed a DMCA takedown in 2021. GitHub reinstated the repository after an EFF counter-notice. A 2024 reader comment on that post objects to route descriptions being copied. | [V] [Gripped, 2021-03-31](https://gripped.com/?p=39886), [OpenBeta newsletter, 2021-05-18](https://openbeta.substack.com/p/github-reverses-dmca-takedown) |

**What follows for SandBag [I]:**

- **The AGPL does not affect us.** We call OpenBeta's API over the network; we do not modify or host their server. SandBag is AGPL-3.0 as well (`LICENSE`), so the licenses are compatible in any case.
- **Credit OpenBeta anyway.** Attribution is not legally required, but it matches our values and is already promised in `DATA_LICENSE.md`. Show "Climbing data from OpenBeta (CC0)" with a link on every area and boulder page, and include it in exports.
- **Cache facts only, not prose or photos.** Cache UUIDs, names, path, grades, climb type, organizations and coordinates. Do **not** cache or redisplay `content.description`, `content.location` or `content.protection`, and do not cache media. The free text is where the Mountain Project copyright dispute is still live. Photos are not CC0 at all. Link to the OpenBeta page for the text instead. This also follows PRD §2.4 ("don't duplicate OpenBeta").
- **Keep the licenses separate in exports.** Our CC BY-SA 4.0 export (`DATA_LICENSE.md`) must not appear to relicense OpenBeta's CC0 facts. Export OpenBeta fields as references (UUID plus a CC0 note), not as CC BY-SA content.
- **Free search API eligibility.** An older 2022 offer gave free access to OpenBeta's separate *Climb Search API* (Typesense) to projects under an OSI-approved license ([post](https://openbeta.substack.com/p/announcing-free-access-climb-search-api)) [V]. The GraphQL API needs no such key. If we ever want that search API, AGPL-3.0 is OSI-approved, so we would qualify.

### 2. Endpoint, auth, rate limits

| Topic | Finding | Tag |
|---|---|---|
| Production endpoint | `POST https://api.openbeta.io/` with a JSON body `{query, variables}`. Staging is `https://stg-api.openbeta.io`. | [V] [README](https://github.com/OpenBeta/openbeta-graphql), [L] |
| Auth for reads | None needed. `permissions.ts` sets `Query: { '*': allow }`; only mutations require auth. | [V] [`src/auth/permissions.ts`](https://github.com/OpenBeta/openbeta-graphql/blob/develop/src/auth/permissions.ts), [L] no token sent |
| Introspection | Enabled (`introspection: true`). | [V] [`src/server.ts`](https://github.com/OpenBeta/openbeta-graphql/blob/develop/src/server.ts) |
| CORS | `access-control-allow-origin: *` | [L] response header |
| Published rate limit | **None documented.** The app code has no rate-limiting middleware. Responses carry no `X-RateLimit-*` or `Retry-After` headers. | [V] server.ts, [L] headers |
| Infrastructure | Behind Cloudflare (`server: cloudflare`, `cf-cache-status: DYNAMIC`). Responses are `Cache-Control: no-store`. Cloudflare may throttle or bot-block at the edge even though no limit is published. | [L] / [I] |
| Latency | The first request took about 8 s at the origin (`cfOrigin;dur=7985`), apparently a cold start. Later requests took about 200–260 ms. | [L] |
| Server-side cache | Apollo uses an in-memory LRU cache (50 entries, 10 MB). It is small, and we should not rely on it. | [V] server.ts |

**Recommended etiquette [I]**, until OpenBeta tells us otherwise:

- **Call OpenBeta only from our server.** Use Next.js route handlers or an Edge Function, never the browser. This means one place to throttle and cache.
- **Throttle globally.** At most about 1 request per second and 1 request in flight at a time. On HTTP 429 or 5xx, back off exponentially (starting at 2 s, capped at 5 min). Honour `Retry-After` if it ever appears.
- **Identify ourselves.** Send a generic `User-Agent` such as `SandBag/<version> (+<public repo URL>)`, with no personal contact details.
- **Fetch an area once, not node by node.** Use one nested query per area page instead of one request per child. Use `bulkAreas` only for deliberate bulk jobs.
- **Set a timeout of about 10 s** to allow for cold starts. Treat a timeout as "API down" and serve the cache.
- **Use the weekly Parquet export for bulk work.** For bulk or offline needs such as seeding or analytics, use OpenBeta's weekly Parquet export instead of crawling the API. It is published as CC0 at [`OpenBeta/parquet-exporter` releases](https://github.com/OpenBeta/parquet-exporter) and refreshed on Sundays [V].

### 3. Schema facts that affect our design

- **There are no structured access, conservation or warning fields in the API.** [S] [L] I searched every `.gql` schema file for `access|warning|conserv|sensitive|hidden|privacy|restrict`. The only hit is a comment in `Organization.gql`. The closest things available are:
  - `Area.organizations`: local climbing organizations (LCOs) linked to the area or its parents. Live, Pawtuckaway returns *Southeast New England Climbers Coalition* (`orgType: LOCAL_CLIMBING_ORGANIZATION`) [L]. Hammond Pond returns none [L].
  - Free text in `Area.content.description` and `content.areaLocation`. Both are empty for both test areas [L], and we will not cache them anyway (§1).

  → **This breaks an assumption in PRD §7/§8.** `area_cache.access_warnings` and "`location_privacy` set from OpenBeta flags" have no OpenBeta source. See *Schema flags for #3*.

- **`metadata.isBoulder` is unreliable.** Every child of Pawtuckaway reports `isBoulder: false`, including "Trailside Boulders" and "Boulder Natural" [L]. At climb level `type.bouldering: true` is populated: the Hammond Pond problem "Transplant" is V3 / 6A [L]. Detect boulders from `climb.type.bouldering` and leaf status, not from `isBoulder`.

- **`metadata.bbox` order.** The schema doc says "NE and SW corners". Live values look like `[minLng, minLat, maxLng, maxLat]`: Hammond Pond returned `[-71.1827, 42.1932, -71.1035, 42.3312]` [L]. **Confirmed in #27:** OpenBeta builds `bbox` with Turf's `bbox()` ([`src/geo-utils.ts`](https://github.com/OpenBeta/openbeta-graphql/blob/develop/src/geo-utils.ts), `updateAllAreas.ts`), which returns the RFC 7946 order `[west, south, east, north]` = `[minLng, minLat, maxLng, maxLat]` [V]. The recorded responses for both test areas match (west < east, south < north, centroid inside) [L], and `src/lib/location/store.test.ts` pins it. Child areas usually return `bbox: null` [L].

- **`ancestors` and `pathTokens` include the area itself as the last element** [L]. `bulkAreas` requires `ancestors` to have at least 2 elements [S].

- **Lookup by path.** There is no `areaByPath` query. Use `areas(filter: { path_tokens: { tokens: [...], exactMatch: true } })` [S], or better, store the UUID. UUIDs are the stable key; paths and names change.

- **Search behaviour.** `area_name.match` matched "Pawtuckaway" and "Hammond Pond". It returned two Pawtuckaway areas: the bouldering/rock area, and an empty "NH Ice and Mixed" sub-area of the same name [L]. Whether matching is substring, prefix or regex, and whether it ignores case, is **unconfirmed** [I]. The UI must show `pathTokens` so users can tell same-named areas apart.

### 4. Coordinate-bearing fields

Every field below must pass through the location-privacy formatter (`src/lib/location.ts`) before it reaches any output: API response, HTML, OG tags, logs or exports. [S] unless noted.

| Field | Notes |
|---|---|
| `Area.metadata.lat`, `Area.metadata.lng` | Centroid of the area's bounding box [L] |
| `Area.metadata.bbox` | Bounding box. Its corners leak location as precisely as the centroid does [L] |
| `Area.metadata.polygon` | Convex hull of the child areas. Leaks location |
| `Climb.metadata.lat`, `Climb.metadata.lng` | Per-climb coordinates, populated live (e.g. Transplant `42.32742, -71.17537`) [L] |
| `Climb.parent { metadata { … } }` | Returns the area's coordinates again through the climb |
| `Area.children[*].metadata.*` | Child coordinates. Privacy must **inherit down the tree**: a hidden parent hides every descendant |
| `cragsNear(lnglat)`, `cragsWithin(bbox)` | Return areas near a point. Never proxy these for hidden areas, and never let a hidden area show up in results |
| `Area.content.areaLocation`, `Climb.content.location` | Free-text approach or parking directions. These can contain GPS or detailed directions. **Do not cache or render them** (also a licensing reason, §1) |
| `Area.media`, `Climb.media` | Not cached (licensing). Photos may carry EXIF GPS [I] |

The rules for handling these fields are listed under *Requirements for the #27 implementation* below.

### 5. Test areas (verified live) [L]

| Area | OpenBeta UUID | pathTokens | Climbs | LCO |
|---|---|---|---|---|
| **Pawtuckaway** (NH) | `f472e63d-9089-5206-ab16-8385450ac7a4` | USA › New Hampshire › Pawtuckaway | 917 | Southeast New England Climbers Coalition |
| **Hammond Pond** (MA) | `6e4aac5e-8949-5ac5-908a-004ac553dd84` | USA › Massachusetts › Eastern, MA › Hammond Pond | 209 | (none returned) |

Ignore the same-named `431e5364-1d30-54ef-a7a4-2e1b3f39bf61`. That is "Pawtuckaway" under "NH Ice and Mixed", with 0 climbs.

Useful children for seeding [L]:

- Under Pawtuckaway: Boulder Natural `a9851693-323d-59ca-828e-34aede9ad409` (220 climbs), Blair Woods `b6b71d4b-1d39-54d7-ad11-40fe4be622fa` (194), Round Pond `d92b0aef-7a44-5cae-ae0d-eca1bc4d7b7d` (75), Devil's Den Bouldering `d40580e5-71b5-5c5f-a97f-94ce5f140a3f` (71).
- Under Hammond Pond: Temple Area, Contrived Face, Other Walls and Crags, Alcove Area.

To find other areas, run `SearchAreas` (below) in any GraphQL playground pointed at `https://api.openbeta.io/`. Pick the result whose `pathTokens` match, and copy its `uuid`.

### 6. Queries

All queries below were written against the published schema [S]. The ones marked [L] were also run live.

```graphql
# Area page: one request per area. Run live against Hammond Pond. [L]
query AreaDetail($uuid: ID!) {
  area(uuid: $uuid) {
    uuid
    areaName
    pathTokens
    ancestors
    gradeContext
    totalClimbs
    metadata { leaf isBoulder lat lng bbox mp_id }      # coords → formatter only
    organizations { orgId orgType displayName content { website } }
    authorMetadata { updatedAt }                       # epoch ms; usable as change marker
    children {
      uuid
      areaName
      totalClimbs
      metadata { leaf isBoulder lat lng }              # coords → formatter only
      climbs {
        uuid
        name
        grades { vscale font yds }
        type { bouldering }
        safety
        metadata { lat lng }                           # coords → formatter only
      }
    }
  }
}
```

```graphql
# Lightweight child listing for big areas (run live against Pawtuckaway). [L]
query AreaChildren($uuid: ID!) {
  area(uuid: $uuid) {
    uuid
    areaName
    totalClimbs
    organizations { orgId orgType displayName }
    children { uuid areaName totalClimbs metadata { leaf isBoulder } }
  }
}
```

```graphql
# Search by name (run live for both test areas). [L]
query SearchAreas($match: String!) {
  areas(filter: { area_name: { match: $match } }, limit: 10) {
    uuid
    areaName
    pathTokens
    ancestors
    totalClimbs
    metadata { leaf isBoulder lat lng }                # coords → formatter only
  }
}
```

```graphql
# Climbs on a leaf area (boulder/crag). Climbs live only on leaves. [S]
query ClimbsInArea($uuid: ID!) {
  area(uuid: $uuid) {
    uuid
    metadata { leaf }
    climbs {
      uuid name gradeContext
      grades { vscale font yds }
      type { bouldering trad sport tr }
      safety
      metadata { lat lng leftRightIndex }              # coords → formatter only
    }
  }
}
```

```graphql
# Single climb (attach flow, scan page). [S]
query ClimbById($uuid: ID!) {
  climb(uuid: $uuid) {
    uuid name gradeContext
    grades { vscale font yds }
    type { bouldering }
    pathTokens ancestors
    metadata { lat lng }                               # coords → formatter only
    parent { uuid areaName }
  }
}
```

```graphql
# Lookup by path (fallback only; prefer UUIDs). [S]
query AreaByPath($tokens: [String]!) {
  areas(filter: { path_tokens: { tokens: $tokens, exactMatch: true } }, limit: 5) {
    uuid areaName pathTokens
  }
}
```

```graphql
# Bulk subtree, for a deliberate refresh job only (ancestors needs ≥2 entries). [S]
query BulkSubtree($ancestors: [String!]!, $limit: Int, $offset: Int) {
  bulkAreas(ancestors: $ancestors, limit: $limit, offset: $offset) {
    uuid areaName pathTokens ancestors totalClimbs
    metadata { leaf lat lng }
    climbs { uuid name grades { vscale font } type { bouldering } metadata { lat lng } }
  }
}
```

`content { description areaLocation }` is intentionally absent from all queries (§1, §4).

---

## Options considered for caching

1. **No cache; proxy every request.** This puts all our load on OpenBeta, leaves browse pages broken whenever the API is down, and conflicts with PRD §12. Rejected.
2. **Mirror everything in bulk** from the Parquet export or `bulkAreas`. Robust, but it duplicates OpenBeta's data (against PRD §2.4) and is more than v1 needs. Possible later for search or offline use.
3. **Lazy read-through cache with a TTL, refreshed in the background (stale-while-revalidate)**, covering only areas and climbs that users visit or that scans reference. **Recommended.**

## Decision

Use option 3, with the design below. The implementation belongs to #27, and the schema shape must land in #3 first.

### Privacy decisions (maintainer, final)

- **D1. If no privacy row exists anywhere in an area's ancestor chain, the default is `exact`.**
  - *Rationale:* OpenBeta already publishes these coordinates openly, so hiding them adds no protection for unflagged areas. A blanket fuzz would make the core browse and approach experience worse everywhere, to protect against a risk that only explicit flags can actually address. Protection comes from the flags themselves, plus a fail-closed formatter (rule P1 below).
- **D2. Names and path tokens of hidden areas are public.** They may appear in `area_cache`, in search results and in the `ILIKE` fallback. Only coordinates, and anything else that encodes location, are protected: `lat`/`lng`, `bbox`, `polygon`, approach or location text, and proximity queries such as "crags near".
  - *Rationale:* OpenBeta publishes the names openly, so withholding them would be a false sense of security. Showing the name lets the area page say "location hidden at the request of …". What helps someone get to a sensitive area is where it is, not what it is called.

### Effective-privacy rules (normative for `src/lib/location.ts`)

- **P1. Fail closed.** The formatter returns `hidden` whenever it cannot *prove* an answer. That covers:
  - a DB or lookup error;
  - an area that is unknown or not in the cache;
  - a cache row whose `ancestors` are missing, or where any ancestor is not itself in the cache;
  - a cache row whose ancestors are stale (see P3).
- **P2. Default `exact` (D1) applies only after a successful lookup.** Every ancestor must be known, and none of them, nor the area itself, may have an `area_privacy` row.
- **P3. An area whose parent changes is hidden until a reviewer re-confirms it.**
  - When a refresh returns `ancestors` that differ from the cached ones, write the new ancestors and set `area_cache.ancestors_changed_at = now()`.
  - Any area with `ancestors_changed_at` set is treated as `hidden`, and so is every descendant.
  - A reviewer clears the flag through a review action. This closes the hole where OpenBeta moves an area out from under a hidden ancestor and a refresh silently exposes it.
- **P4. The most restrictive value wins.** If privacy rows exist in the chain, the effective value is the most restrictive one among the area itself and all its ancestors.
- **P5. `fuzzed_1km` must be deterministic and not reversible.**
  - Compute the offset once per area, for example as an HMAC of the area UUID with a server-side secret, mapped to a point up to 1 km away.
  - Every request then returns the same fuzzed point.
  - Do **not** use per-request random jitter: averaging many responses would recover the true point.
  - Children of a fuzzed area use the parent's fuzzed point, or are each fuzzed the same way. They must never return their own raw coordinates.

### Table shape sketch [I]

```text
area_cache
  openbeta_area_id   uuid primary key
  name               text not null
  path_tokens        text[] not null           -- PRD "path"
  ancestors          uuid[] not null           -- needed for privacy inheritance
  is_leaf            boolean
  total_climbs       int
  organizations      jsonb                     -- [{orgId, orgType, displayName, website}]
  openbeta_updated_at timestamptz              -- from authorMetadata.updatedAt
  fetched_at         timestamptz not null
  refresh_after      timestamptz not null      -- fetched_at + TTL
  last_error         text                      -- last failed refresh, null if healthy
  last_error_at      timestamptz
  ancestors_changed_at timestamptz             -- set when a refresh re-parents the area (P3);
                                               -- non-null ⇒ hidden until a reviewer clears it

area_cache_coords                              -- separate table so RLS can lock it down
  openbeta_area_id   uuid primary key references area_cache
  lat, lng           double precision
  bbox               double precision[4]
  -- RLS: no SELECT policy for anon/authenticated. Only the server (service role)
  -- reads it, and only through location.ts.

climb_cache
  openbeta_climb_id  uuid primary key
  openbeta_area_id   uuid not null references area_cache   -- leaf parent
  name               text not null
  grades             jsonb                     -- {vscale, font, yds}
  is_boulder         boolean
  fetched_at, refresh_after                    -- same semantics as area_cache
  -- climb coordinates go in a locked-down climb_cache_coords table, same pattern

area_privacy                                   -- OUR data, never overwritten by refresh
  openbeta_area_id   uuid primary key
  location_privacy   enum (exact | fuzzed_1km | hidden)
  reason             text                      -- e.g. "LCO request", link to discussion
  set_by, set_at
```

Effective privacy follows rules P1–P5 above: default `exact` when no row exists and the lookup succeeds, `hidden` on any failure.

### Requirements for the #27 implementation

- **Server-side only.** All OpenBeta calls go through our server, with one global throttle (about 1 request per second, 1 in flight), a 10 s timeout and exponential backoff.
- **Opaque coordinates.** The typed client returns coordinates as a branded or opaque type (e.g. `RawCoords`) that only `src/lib/location.ts` can unwrap.
- **Coordinates in their own table.** Raw coordinates are stored only in `area_cache_coords` and `climb_cache_coords`. Those tables have no anon or authenticated SELECT policy; the service role reads them, and only through the formatter.
- **No prose, location text or media.** Never request, cache or render `content.description`, `content.areaLocation`, `content.location` or media.
- **No proxying of proximity queries.** Never expose `cragsNear` or `cragsWithin`, or any equivalent "near me" feature, without filtering hidden and fuzzed areas.
- **Implement P1–P5 and test them.** The tests must include:
  - a hidden ancestor hides every descendant;
  - a DB error returns `hidden`;
  - an uncached area returns `hidden`;
  - missing ancestors return `hidden`;
  - a re-parented area (`ancestors_changed_at` set) returns `hidden`;
  - `fuzzed_1km` is stable across calls;
  - the `bbox` parser handles the observed corner order.
- **Stale flag.** Our API responses carry `stale` and `fetchedAt`.

### TTL and refresh [I]

- **Areas and climbs:** a soft TTL of 7 days. This data changes rarely, and `authorMetadata.updatedAt` lets us skip writes when nothing changed.
- **Search:** no Postgres cache. Use a short in-memory or route cache (about 10 min) per normalized query string. When the API is down, fall back to `ILIKE` over cached `area_cache.name`, and label the results as possibly incomplete.
- **Read path:** read the cache row. If it exists, serve it. If it is past `refresh_after`, trigger a background refresh through the global throttle. If it is missing, fetch synchronously with a 10 s timeout.
- **Scheduled refresh:** once a week, refresh areas that have published scans, at most 1 request per second. Never delete a cache row that a scan references.
- **When the API is down:** serve the cached row and set `stale: true` plus `fetchedAt` in our API response so the UI can show "OpenBeta data as of <date>". Record `last_error`. If there is no cached row and the API is down, return a clear "OpenBeta unavailable" state, not a 500.

### Consequences

- Browse pages keep working through OpenBeta outages, and OpenBeta sees roughly one request per area per week from us.
- We hold no OpenBeta prose or photos, which minimizes licensing exposure and duplication.
- Access safety rests on **our own** `area_privacy` data plus fail-closed rules, not on OpenBeta. This is more work for maintainers, but it is the only option that actually works with what the API offers.
- **Risk accepted with D1: a sensitive area is exposed until someone flags it.** OpenBeta has no sensitivity flags, so an area nobody has flagged shows exact coordinates. Those are the same coordinates OpenBeta already publishes.
  - *Mitigation:* flag known-sensitive areas when they are seeded. Seeding a new region includes asking or checking the relevant local climbing organization and any known closures.
  - Flagging must be quick: a maintainer or reviewer can add an `area_privacy` row, and it takes effect on the next request with no cache wait.
  - LCO requests are honoured as soon as they arrive.
- **Risk accepted with D2:** the names of hidden areas are discoverable, and path tokens often name the specific crag. Coordinates and anything that encodes location stay protected.
- **Re-parenting (P3)** can temporarily hide legitimate areas until a reviewer confirms them. That is deliberate: it fails safe.

## Schema flags for #3 (posted on the issue; do not improvise)

1. **`area_cache.access_warnings jsonb` has no OpenBeta source.** Replace it with `organizations jsonb`, the list of local climbing organizations. Any warnings we want are our own data and belong in a SandBag-owned table.
2. **`location_privacy` cannot be "set from OpenBeta flags"** (PRD §7), because OpenBeta has no such flags.
   - Move it out of the cache row into a SandBag-owned `area_privacy` table that cache refreshes never overwrite.
   - Privacy inherits down the tree, which needs `area_cache.ancestors uuid[]` and `area_cache.ancestors_changed_at timestamptz` (P3).
3. **Default privacy is decided (D1):** `exact` when no row exists anywhere in the ancestor chain *and* the lookup succeeds. Otherwise the result fails closed to `hidden` (P1–P2).
4. **Coordinates need column-level protection.** RLS controls rows, not columns. Put coordinates in separate `area_cache_coords` and `climb_cache_coords` tables with no anon or authenticated SELECT policy, or revoke column privileges. Otherwise the public anon key can read raw coordinates of hidden areas directly from PostgREST. Names stay in the public `area_cache` (D2).
5. **`climb_cache` is missing from PRD §8.** `scans.openbeta_climb_id` needs a cached name and grade for display. That snapshot also feeds the "sandbagged" delta (PRD §5.7).
6. **Add refresh-bookkeeping columns:** `refresh_after`, `last_error`, `last_error_at`, `openbeta_updated_at`.

## Implementation notes (#27)

Where the implementation differs from, or adds to, the design above:

- **Layout.** `src/lib/openbeta/` (queries, transport/throttle, parsing, read-through cache) never reads coordinates. `src/lib/location/store.ts` owns the coordinate selections, the opaque `RawCoords` handle, the bbox parser and the `*_coords` upserts.
- **AreaDetail also selects the area's own `climbs`**, so a leaf page is one request, and drops `isBoulder`, `gradeContext`, `mp_id` and `safety` (unreliable or no column). `SearchAreas` selects no coordinates at all.
- **Ancestors and children.** A fetch inserts any missing ancestor rows (derived from `ancestors` + `pathTokens`) so the privacy resolver can walk the chain (P1), and inserts missing child rows. Both are inserted already stale, so a visit fetches them fully in the background. A child whose cached ancestors differ from its parent's chain is re-parented and flagged (P3).
- **Skipping writes.** When `authorMetadata.updatedAt`, name, `totalClimbs` and ancestors are unchanged, only the area row's bookkeeping is updated. Climbs and coordinates are still upserted, because nothing confirms that editing a climb bumps its area's `updatedAt`.
- **Backoff is fail-fast.** After a 429, 5xx, timeout or network error the throttle blocks for 2 s, doubling to a 5 min cap (or `Retry-After`). Requests that arrive while blocked fail immediately with `backoff` and the caller serves the cache, rather than holding a page open.
- **The throttle is per server instance.** Vercel instances do not share memory, so N warm instances can each send 1 req/s. The cache keeps real traffic far below that.
- **An HTML 200 was seen live** once (an edge page instead of JSON). Non-JSON bodies are treated as `bad_response`.
- **`last_error`** holds a short code (`timeout`, `http_503`, `bad_response`, `not_found`, ...), never a response body.

## Open questions for the OpenBeta community

1. Are there rate limits or usage expectations for `api.openbeta.io`? Is there a Cloudflare rule we should know about, or a preferred `User-Agent` convention?
2. Is about 1 request per second, with an area cached for a week, acceptable for a small read-only app? Would they prefer we use the Parquet export or `bulkAreas` for bulk needs?
3. Is there a ToS for the API? Is CC0 the definitive license for all `Area` and `Climb` fields returned by the API, given Mountain Project provenance? Are names and grades fine, with only prose being sensitive?
4. Is there any plan for structured access, closure or sensitivity flags (e.g. nesting closures, LCO "do not publish coordinates" requests)? Could we contribute to that rather than keep a parallel list?
5. How do LCOs (e.g. SENECC) currently ask OpenBeta to hide or fuzz coordinates? Can we honour the same mechanism?
6. ~~Is `metadata.bbox` in `[minLng, minLat, maxLng, maxLat]` order?~~ Yes, from their source (#27). Is `isBoulder` expected to be populated, or should we rely on `climb.type.bouldering`?
7. How does `area_name.match` behave (substring, prefix or regex; case sensitivity)?
8. Is there a stable public URL pattern for linking to an area or climb on openbeta.io for attribution? I assume `https://openbeta.io/area/<uuid>` and `https://openbeta.io/climb/<uuid>`, but this is unverified [I].
9. Would they welcome links back from openbeta.io to 3D scans (open CC BY-SA data keyed to their UUIDs)?

### Draft Discord intro (for the maintainer to paste)

> Hi OpenBeta folks! I'm building **SandBag**, an open-source (AGPL-3.0) web app that adds a 3D layer on top of OpenBeta: community-contributed photogrammetry scans of boulders, with holds and lines annotated, released as CC BY-SA open data. We **don't** duplicate your data. We store only scans keyed to your area/climb UUIDs, link back to OpenBeta for everything else, and credit you on every page.
>
> Before we wire up the API, a few questions:
> 1. Are there rate limits or etiquette for `api.openbeta.io`? Our plan is server-side only, about 1 req/s max, and caching each area for about a week.
> 2. Is CC0 the license for everything the API returns? We plan to cache only facts (names, grades, UUIDs, coordinates) and not descriptions or photos.
> 3. Is there, or is there planned, any structured access or sensitivity info, such as closures or LCO requests to hide coordinates? Access safety matters a lot to us, and we'd rather contribute to yours than build a parallel list.
>
> Our first test areas are Pawtuckaway (NH) and Hammond Pond (MA). Happy to share more, and thanks for building this!

## Sources

- OpenBeta FAQ (data license): https://docs.openbeta.io/faq
- OpenBeta about page: https://openbeta.io/about
- OpenBeta docs intro: https://docs.openbeta.io
- openbeta-graphql repo (endpoint, AGPL): https://github.com/OpenBeta/openbeta-graphql
- Schema: https://github.com/OpenBeta/openbeta-graphql/tree/develop/src/graphql/schema (`Area.gql`, `Climb.gql`, `Organization.gql`)
- Server config: https://github.com/OpenBeta/openbeta-graphql/blob/develop/src/server.ts
- Read permissions: https://github.com/OpenBeta/openbeta-graphql/blob/develop/src/auth/permissions.ts
- Parquet export: https://github.com/OpenBeta/parquet-exporter
- Climb Search API announcement (2022): https://openbeta.substack.com/p/announcing-free-access-climb-search-api
- Mountain Project dispute: https://gripped.com/?p=39886 and https://openbeta.substack.com/p/github-reverses-dmca-takedown
