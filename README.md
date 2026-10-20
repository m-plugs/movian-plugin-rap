# Rạp (rap-movian)

A Movian (JS/Duktape) plugin for browsing and playing media indexed by
your mediaindex server. Talks to the server's JSON API over the network -
no local media scanning, no dependency on running on the same machine as
the server.

Previously named "MediaIndex" - renamed to avoid the plugin's identity
being tied to the backend's name. "Rạp" is Vietnamese for "cinema"; the
plain-ASCII form "rap" is used wherever unicode isn't safe (the URI
scheme `rap:`, plugin.json's `id`/`file`). The backend itself is still
called mediaindex - only this plugin's branding changed.

## Important: not tested against a real Movian client from scratch

This plugin has gone through several rounds of live, on-device testing
and fixes, but wasn't built or verified against a real Movian client
end-to-end by whoever last edited it (Claude). What's true as of now:

- Every `.js` file is syntactically valid (checked with `node --check`).
- Every API field the plugin reads (`movie.Title`, `entry.PlaybackURL`,
  `hit.has_alive`, `entry.SizeBytes`, etc.) was cross-checked against real
  JSON responses from a live mediaindex server, not assumed.
- Several real bugs were found and fixed only after live testing on an
  actual device surfaced them - grep this codebase for "live-tested" and
  "confirmed" comments for the specifics (a non-exhaustive list: the
  settings API needed `new settings.globalSettings(...)`, not a plain
  call; `page.type = 'video'` on a page opens the player, not a detail
  screen; `page.paginator`'s real contract varies by build; `metadata.
  year` must be a number, not a string; `showtime.RichText` isn't
  available under `apiversion: 2`; `metadata.description` didn't render
  in at least one tested context, worked around by folding info into
  `title` instead).
- What's still genuinely unverified: why poster art renders as a
  landscape tile in the genre/browse grid despite `icon` pointing at a
  real portrait TMDB poster URL (see the comment block at the top of the
  `browse:` route in `rap.js`); whether `title`-as-description actually
  renders the way intended, since that was the last untested change.

If something doesn't work as expected, the Movian development console
(Settings -> Debug in the app, or enable remote logging) is the fastest
way to see the real error - sharing what appears there is far more useful
than another guess.

## Installation

1. Copy this whole plugin directory onto your Movian device (or wherever
   Movian loads dev plugins from - typically via Movian's plugin
   development/sideload mechanism; consult Movian's own docs for your
   specific platform, since this varies by OS/build).
2. Open Movian -> Settings -> Plugins, find "Rap", and configure:
   - MediaIndex server URL: e.g. http://192.168.1.10:8080 (no trailing
     slash). This must be reachable from the device running Movian - if
     the mediaindex server and Movian are on different devices (the
     normal setup), use the server's LAN IP, not localhost.
   - Hide dead links: on by default - excludes movies with no working
     release and unmatched files already confirmed dead.
   - Items per page: how many results to fetch per page when
     browsing/searching.
3. "Rạp" should appear as a home-screen entry (registered via
   service.create).

## What's implemented

1. Home page: recently uploaded, recently added, genre list, and past
   searches (device-local history via movian/store - lost on plugin
   reinstall, a deliberate simplicity tradeoff rather than adding a new
   mediaindex server-side table for this).
2. Browse by upload/create timestamp: GET /api/movies?sort=uploaded orders
   by the latest source-provided upload date across each movie's attached
   releases - distinct from sort=recent, which is mediaindex's own "last
   touched" bookkeeping timestamp, not actual upload recency.
3. Genre browsing: poster grid (page.model.contents = 'grid') per genre,
   backdrop-on-hover via Movian's metadata.backdrop field.
4. Movie detail page: backdrop, overview, rating, year, genre, and every
   attached release listed individually as a playable item (never merged
   into one item - Movian auto-picks highest bitrate from a merged
   sources[] list with no picker UI, which would take the choice away
   from the user). A movie with multiple releases (e.g. a TV show matched
   as one media_type=tv Movie with each episode as a separate release)
   lists every release the same way, sorted by filename.
5. Search: full free-text search wired into Movian's global search box
   (page.Searcher) as well as the plugin's own search screen; results
   include both TMDB-matched movies (posters, ranked first) and raw
   filename matches for anything not yet matched - search works even
   without a working TMDB connection, and unmatched hits are directly
   playable, not dead ends.

## Known caveats worth understanding before relying on this

- Multi-episode TV shows only group correctly if TMDB matches every
  episode file to the same tmdb_id. Without TMDB configured, each episode
  file indexes as an independent, unmatched entry - they show up
  individually in search, not grouped under one show. Grouping depends
  entirely on mediaindex's existing TMDB matching working well for your
  episode filenames; this plugin doesn't add its own season/episode
  parsing.
- NAS (file://) playback is proxied through the mediaindex server
  (GET /api/entries/{id}/stream) since a bare local filesystem path is
  meaningless to Movian running on a different device. Fshare (https://)
  links are given to Movian directly, not proxied, to avoid unnecessary
  server load.
- Tag/genre filtering only applies to matched movies, not unmatched
  filename search hits (a raw filename has no genre) - genre-browse pages
  will never show unmatched content, by design.
- The detail page's tag/genre display is a plain comma-joined string
  (Movian's real `metadata.genre` field), not individually clickable
  chips - there's no confirmed Movian item type for an inline tag-chip
  strip. Genre browsing already exists via the Genres list on the home
  page.
