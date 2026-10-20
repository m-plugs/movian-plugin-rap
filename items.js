/**
 * items.js - shared helpers turning MediaIndex API objects (Movie, Entry)
 * into Movian page items, so every route (home, genre browse, search,
 * movie detail) builds items the same way instead of duplicating
 * page.appendItem() calls with slightly different metadata shapes.
 *
 * Movian item/metadata field names here are the real ones confirmed from
 * Movian's JSAPI docs and working reference plugins: page.appendItem(uri,
 * type, metadata) where type is 'directory' or 'video', and metadata
 * supports title/icon/description/duration/rating/year/genre for video
 * items (icon/title for directory items).
 */

var api = require('./api');
var settings = require('./settings').settings;

// movieTitle / movieOverview pick TitleVI/OverviewVI when the Vietnamese
// language setting is on and the field is non-empty; otherwise fall back
// to the English Title/Overview (or OriginalTitle for the title).
function movieTitle(movie) {
  if (settings.useVietnamese && movie.TitleVI) {
    return movie.TitleVI;
  }
  return movie.Title || movie.OriginalTitle || 'Untitled';
}

function movieOverview(movie) {
  if (settings.useVietnamese && movie.OverviewVI) {
    return movie.OverviewVI;
  }
  return movie.Overview || undefined;
}

// PLUGIN_PREFIX is the URI scheme this plugin's routes are registered
// under (see plugin.addURI calls in rap.js) - every internal link built
// here must use this prefix for Movian to route it back into the plugin.
// "rap" (plain ASCII, no diacritic) per the Rap/R\u1ea1p rebrand - unicode is
// avoided in identifier-like strings such as this URI scheme.
exports.PLUGIN_PREFIX = 'rap:';

// movieUri(movieId) builds the internal URI for a movie's detail page.
exports.movieUri = function(movieId) {
  return exports.PLUGIN_PREFIX + 'movie:' + encodeURIComponent(movieId);
};

exports.genreUri = function(slug, title) {
  return exports.PLUGIN_PREFIX + 'genre:' + encodeURIComponent(slug) + '?title=' + encodeURIComponent(title || slug);
};

exports.searchUri = function(query) {
  return exports.PLUGIN_PREFIX + 'search:' + encodeURIComponent(query || '');
};

exports.browseUri = function(sort) {
  return exports.PLUGIN_PREFIX + 'browse:' + encodeURIComponent(sort || 'recent');
};


// isSubtitleFile(name) - true for common subtitle extensions so release
// lists (and unmatched search hits) can hide them. Matching is on the
// filename only; the API has no dedicated "is_subtitle" flag.
function isSubtitleFile(name) {
  if (!name) return false;
  var lower = String(name).toLowerCase();
  var exts = ['.srt', '.vtt', '.ass', '.ssa', '.sub', '.idx', '.sup', '.smi', '.sami'];
  for (var i = 0; i < exts.length; i++) {
    if (lower.length >= exts[i].length &&
        lower.substring(lower.length - exts[i].length) === exts[i]) {
      return true;
    }
  }
  return false;
}

// movieYear(releaseDate) extracts just the year from release_date
// ("1999-03-31" -> 1999) for display, tolerating an empty/short date.
// Returns a real number (not a string) - metadata.year is a numeric
// Movian field, and passing a string here was the actual cause of the
// detail page showing "(0)" next to the title instead of a year or
// nothing: Movian coerced the non-numeric-looking value to 0 rather
// than leaving it blank.
function movieYear(releaseDate) {
  if (releaseDate && releaseDate.length >= 4) {
    var y = parseInt(releaseDate.substring(0, 4), 10);
    return isNaN(y) ? undefined : y;
  }
  return undefined;
}

/**
 * appendMovieItem(page, movie, hasAlive) adds one movie as a directory
 * item linking to its detail page, with poster/backdrop/rating/year
 * metadata. hasAlive is optional (only present on /api/search results -
 * see db.SearchHit.HasAlive); when explicitly false, the title is
 * prefixed "[DEAD]" rather than being silently indistinguishable, since
 * the server-side dead-link filter is opt-out (hideDeadLinks setting),
 * not guaranteed on for every code path that reaches this function.
 */
exports.appendMovieItem = function(page, movie, hasAlive) {
  var title = movieTitle(movie);
  if (hasAlive === false) {
    title = '[DEAD] ' + title;
  }

  // Backdrop-on-hover: Movian surfaces item.metadata.backdrop as the
  // background shown when an item is focused/highlighted in grid views.
  // This is passed directly in the metadata object given to
  // page.appendItem(), not set afterwards on its return value -
  // page.appendItem() does not reliably return the created item object in
  // every Movian build (confirmed the hard way: writing to
  // returnedItem.metadata.backdrop after the call threw "cannot write
  // property 'backdrop' of undefined", meaning the return value itself
  // was undefined here), so nothing after this call depends on what it
  // returns.
  var metadata = {
    title: title,
    icon: api.tmdbImageUrl(movie.PosterPath, 'w500'),
    year: movieYear(movie.ReleaseDate),
    rating: movie.VoteAverage ? (movie.VoteAverage * 10) : undefined, // Movian rating is 0-100
    description: movieOverview(movie)
  };
  if (movie.BackdropPath) {
    metadata.backdrop = api.tmdbImageUrl(movie.BackdropPath, 'w1280');
  }

  // Item type 'video' (not 'directory') for the listing tile itself.
  // Confirmed from Movian's own JSAPI_play_video doc that a 'video'-typed
  // item pointing at a plugin: URI does NOT auto-play - "This will make
  // Movian open exampleapp:video:123 when the user starts the video.
  // This page is then responsible for setting up video playback" - so
  // this still opens movieUri()'s detail page/route exactly like
  // 'directory' did, it does not skip straight to playback (that
  // confusion was the page.type mistake on the detail route itself,
  // fixed separately - item type and page type are independent). Trying
  // this because 'video' is the item type actually documented with
  // rating/year/description fields (this function already relies on
  // those), and is what poster-grid browsing plugins use for movie
  // tiles - 'directory' items only document title/icon. If a portrait
  // poster tile in the grid was the goal, this is the most likely lever
  // for it, since page.model.contents = 'grid' alone (still set in
  // rap.js) didn't produce one.
  page.appendItem(exports.movieUri(movie.ID), 'video', metadata);
};

/**
 * appendReleaseItem(page, entry) adds one file/release as a directly
 * playable video item. Title is a two-line string: filename, then a
 * Size/Modified/Downloads summary line - see the comment inside the
 * function for why this uses title rather than description (mediaindex's
 * own Entry fields: SizeBytes, SourceModifiedAt/SourceUploadedAt,
 * DownloadCount - there's no lastdownload/created pair here, just what
 * mediaindex's Entry actually tracks).
 *
 * Playback URL selection: a NAS-backed entry's PlaybackURL is a bare
 * "file:///..." path (confirmed live against a real server), meaningful
 * only on the machine running mediaindex itself - meaningless to Movian
 * running on a different device (the normal case: mediaindex on a NAS/
 * server, Movian on a TV/set-top box). For those, playback is routed
 * through GET /api/entries/{id}/stream, which serves the local file with
 * Range support for seeking. Remote (Fshare, http(s)://) entries are given
 * to Movian directly instead of being proxied - the URL already works from
 * any device with internet access, so routing it through mediaindex too
 * would just add unnecessary server bandwidth/load for no benefit.
 */
exports.appendReleaseItem = function(page, entry) {
  var name = entry.Name;
  var playUrl = entry.PlaybackURL;
  if (playUrl && playUrl.indexOf('file://') === 0) {
    playUrl = api.baseUrl() + '/api/entries/' + encodeURIComponent(entry.ID) + '/stream';
  }

  var size = humanSize(entry.SizeBytes);
  var modified = formatDate(entry.SourceModifiedAt || entry.SourceUploadedAt);

  // Everything folded into title as a two-line string (name, then a
  // "Size · Modified · Downloads" summary line), NOT split into a
  // separate description field. Live-tested: with description carrying
  // this info instead, the whole line was simply blank in the on-device
  // list/detail panel (title still rendered fine, so appendItem itself
  // works - description specifically wasn't showing up, string or
  // otherwise). Rather than keep guessing at why description silently
  // drops content on this build, this uses the one field proven to
  // actually render (title) for everything, matching the shape the
  // user's own reference screenshots showed working natively (a
  // two-line title: filename, then a modified-date/info line) - see
  // renderList()'s `item.name + '\n' + modified` pattern in the
  // reference api.js, adapted with size/downloads folded in since this
  // plugin has no separate always-visible size column to rely on.
  var infoParts = [];
  if (size) infoParts.push('Size: ' + size);
  if (modified) infoParts.push('Modified: ' + modified);
  if (entry.DownloadCount != null) infoParts.push('Downloads: ' + entry.DownloadCount);
  var detail = infoParts.length ? infoParts.join('  \u00b7  ') : '';

  var videoParams = {
    title: name,
    sources: [{url: playUrl}],
    no_fs_scan: true
  };

  // title = filename only; duration carries human size for right-aligned
  // display; description carries Modified/Downloads for the sub-line.
  return page.appendItem('videoparams:' + JSON.stringify(videoParams), 'video', {
    title: name,
    description: detail || undefined,
    duration: size
  });
};

// formatDate(isoString) - entries carry ISO-8601 timestamp strings from
// the JSON API (Go's encoding/json default for time.Time), not unix
// epoch seconds - unlike the timfshare reference's formatDate, which
// parses a unix-seconds field its own API returns. Reformats to a plain
// YYYY-MM-DD the same way, tolerating a missing/null value.
function formatDate(isoString) {
  if (!isoString) return undefined;
  var d = new Date(isoString);
  if (isNaN(d.getTime())) return undefined;
  return d.getFullYear()
    + '-' + ('0' + (d.getMonth() + 1)).slice(-2)
    + '-' + ('0' + d.getDate()).slice(-2);
}

function humanSize(bytes) {
  if (!bytes || bytes <= 0) return undefined;
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var i = 0;
  var n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n = n / 1024;
    i++;
  }
  return n.toFixed(1) + ' ' + units[i];
}

exports.movieYear = movieYear;
exports.movieTitle = movieTitle;
exports.movieOverview = movieOverview;
exports.isSubtitleFile = isSubtitleFile;

// genreIcon(slug) - bundled square poster crop (v1.5.7 style).
// Live TMDB URLs letterbox badly in Movian's directory grid; local
// square PNGs keep a consistent tile ratio.
exports.genreIcon = function(slug) {
  var s = (slug || 'default').toLowerCase().replace(/\s+/g, '-');
  if (s === 'science-fiction' || s === 'sci-fi') s = 'scifi';
  var known = {
    'action': 1, 'adventure': 1, 'animation': 1, 'comedy': 1, 'crime': 1,
    'documentary': 1, 'drama': 1, 'family': 1, 'fantasy': 1, 'history': 1,
    'horror': 1, 'music': 1, 'mystery': 1, 'romance': 1, 'scifi': 1,
    'thriller': 1, 'war': 1, 'western': 1, 'tv-movie': 1
  };
  if (!known[s]) s = 'default';
  return Plugin.path + 'views/icons/' + s + '.png';
};

exports.humanSize = humanSize;
