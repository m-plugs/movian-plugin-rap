/**
 * rap.js - main plugin entrypoint (formerly mediaindex.js, renamed as
 * part of the Rap/R\u1ea1p rebrand - "R\u1ea1p" is Vietnamese for "cinema"; the
 * plain-ASCII form "rap" is used everywhere unicode isn't safe: the URI
 * scheme, plugin.json's id/file, and any identifier-like string). Registers
 * Movian routes (page.Route) for every screen and registers the plugin as
 * a home-screen service, per confirmed real plugin conventions:
 *   - new page.Route(uriRegex, handler) registers a route; Movian calls
 *     handler(page, ...capturedGroups) when a matching URI is opened.
 *   - service.create(title, uri, type, enabled, icon) adds an entry to
 *     Movian's home screen / service list.
 *   - page.type, page.metadata.title, page.loading, page.error(),
 *     page.appendItem() build the actual screen contents.
 *
 * The backend this plugin talks to is still called "mediaindex" (its own
 * server-side name isn't changing, only this plugin's identity/branding) -
 * comments referring to the server keep that name; only user-visible
 * plugin strings (titles, the URI prefix, service name) changed.
 */

var page = require('showtime/page');
var service = require('showtime/service');
var api = require('./api');
var items = require('./items');
var history = require('./history');
require('./settings'); // side-effect: registers the settings page

var PREFIX = items.PLUGIN_PREFIX;

// RichText - Movian's way to put multi-line / coloured text into
// metadata.description, genre, tagline, etc. Plain strings get treated
// as single-line labels; objects with toRichString() render as rich text.
function RichText(x) {
  this.str = (x == null) ? '' : String(x);
}
RichText.prototype.toRichString = function() {
  return this.str;
}

// wrapText(s, width) - insert newlines so GLW labels can show multi-line
// text (plain label widgets do not soft-wrap on their own).
function wrapText(s, width) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  width = width || 88;
  var words = s.split(' ');
  var lines = [];
  var cur = '';
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= width) {
      cur = cur + ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}



// ---------------------------------------------------------------------
// Home page
// ---------------------------------------------------------------------
// Per requirement 1: past searches, new movies, list of genres. Also adds
// a couple of extra sections (suggested, not required): a direct search
// entry point and a "recently uploaded" shortcut, since both are cheap
// given what's already built and genuinely useful on a media box.

new page.Route(PREFIX + 'start', function(page) {
  page.type = 'directory';
  page.metadata.title = 'R\u1ea1p';
  // Optional custom home layout (skins that honour glwview). Falls back
  // to the normal directory list when the active skin ignores it.
  page.metadata.glwview = Plugin.path + 'views/home.view';
  page.loading = true;

  page.appendItem(PREFIX + 'search:', 'search', {
    title: 'Search',
    icon: Plugin.path + 'views/icons/nav_search.png'
  });

  page.appendItem(items.browseUri('uploaded'), 'directory', {
    title: 'Recently uploaded',
    icon: Plugin.path + 'views/icons/nav_uploaded.png'
  });
  page.appendItem(items.browseUri('recent'), 'directory', {
    title: 'Recently added to library',
    icon: Plugin.path + 'views/icons/nav_recent.png'
  });

  // Search history is a separate page (not mixed into the home list).
  var recentSearches = history.list();
  if (recentSearches.length > 0) {
    page.appendItem(PREFIX + 'history', 'directory', {
      title: 'Search history (' + recentSearches.length + ')',
      icon: Plugin.path + 'views/icons/nav_history.png'
    });
  }

  page.appendPassiveItem('separator', null, {title: 'Genres'});

  try {
    var genres = api.listTags('genre');
    for (var g = 0; g < genres.length; g++) {
      var genre = genres[g];
      page.appendItem(items.genreUri(genre.Slug, genre.Name), 'directory', {
        title: genre.Name + ' (' + genre.MovieCount + ')',
        icon: items.genreIcon(genre.Slug)
      });
    }
  } catch (e) {
    // Genre list failing shouldn't blank the rest of the home page.
  }

  page.loading = false;
});

// ---------------------------------------------------------------------
// Search history (device-local, see history.js)
// ---------------------------------------------------------------------

new page.Route(PREFIX + 'history', function(page) {
  page.type = 'directory';
  page.metadata.title = 'Search history';
  page.contents = 'list';
  if (page.model) page.model.contents = 'list';
  page.loading = false;

  var recent = history.list();
  if (recent.length === 0) {
    page.appendPassiveItem('separator', null, {title: 'No recent searches'});
    return;
  }

  for (var i = 0; i < recent.length; i++) {
    (function(q) {
      page.appendItem(items.searchUri(q), 'directory', {title: q});
    })(recent[i]);
  }

  page.appendPassiveItem('separator', null, {title: ''});
  page.appendItem(PREFIX + 'history:clear', 'directory', {
    title: 'Clear search history'
  });
});

new page.Route(PREFIX + 'history:clear', function(page) {
  history.clear();
  page.redirect(PREFIX + 'start');
});

new page.Route(PREFIX + 'browse:(.*)', function(page, sortRaw) {
  var sort = decodeURIComponent(sortRaw || 'recent');
  page.type = 'directory';
  page.metadata.title = sort === 'uploaded' ? 'Recently uploaded' : 'Recently added';
  // OPEN QUESTION: confirmed against Movian's own src/plugins.c that
  // "grid" is a real page.model.contents value (used by Movian's built-in
  // plugin browser), and PosterPath (used in appendMovieItem's icon
  // field below) is confirmed correct against the real mediaindex web UI
  // (verified against a real screenshot: it's genuinely a vertical TMDB
  // poster). What's NOT confirmed from docs is why this grid renders
  // those poster icons as landscape/backdrop-shaped tiles on-device
  // rather than portrait - that's most likely a skin/tile-aspect-ratio
  // behavior tied to this specific "grid" contents value or item type,
  // not a wrong field. Untested alternative worth trying if this
  // matters: some other contents value (Movian's C source doesn't
  // document one specific to portrait posters) or 'video' instead of
  // 'directory' as the per-item type in appendMovieItem.
  // 'movies' is the classic Movian content type for poster grids; also
  // set model.contents='grid' for builds that only honour that path.
  page.contents = 'movies';
  page.model.contents = 'grid';
  page.loading = true;

  // See the genre: route below for why the first page is loaded
  // synchronously here rather than solely through page.paginator, and why
  // loadPage tries every real paginator-completion convention rather than
  // betting on one.
  var offset = 0;
  var pageSize = 30;
  var exhausted = false;

  function signalDone(hasMore, haveMoreArg) {
    page.loading = false;
    if (typeof haveMoreArg === 'function') haveMoreArg(hasMore);
    if (typeof page.haveMore === 'function') page.haveMore(hasMore);
    return hasMore;
  }

  function loadPage(haveMoreArg) {
    if (exhausted) return signalDone(false, haveMoreArg);
    page.loading = true;
    try {
      var movies = api.listMovies(sort, pageSize, offset);
      for (var i = 0; i < movies.length; i++) {
        items.appendMovieItem(page, movies[i]);
      }
      offset += movies.length;
      exhausted = movies.length < pageSize;
      return signalDone(!exhausted, haveMoreArg);
    } catch (e) {
      page.error('' + e);
      exhausted = true;
      return signalDone(false, haveMoreArg);
    }
  }

  loadPage();
  page.paginator = loadPage;
});

// ---------------------------------------------------------------------
// Genre listing (all genres) and genre detail (movies within one genre)
// ---------------------------------------------------------------------

new page.Route(PREFIX + 'genres', function(page) {
  page.type = 'directory';
  page.metadata.title = 'Genres';
  page.loading = true;

  try {
    var genres = api.listTags('genre');
    for (var i = 0; i < genres.length; i++) {
      var genre = genres[i];
      page.appendItem(items.genreUri(genre.Slug, genre.Name), 'directory', {
        title: genre.Name + ' (' + genre.MovieCount + ')',
        icon: items.genreIcon(genre.Slug)
      });
    }
  } catch (e) {
    page.error('' + e);
  }
  page.loading = false;
});

new page.Route(PREFIX + 'genre:([^?]*)\\?title=(.*)', function(page, slugRaw, titleRaw) {
  var slug = decodeURIComponent(slugRaw);
  var title = decodeURIComponent(titleRaw || slug);

  page.type = 'directory';
  page.metadata.title = title;
  page.contents = 'movies';
  page.model.contents = 'grid'; // see the open-question comment on the browse: route above
  page.loading = true;

  // Movian's page.paginator calling convention has genuinely varied across
  // versions/forks (confirmed against three different real sources: a
  // synchronous-return style with no callback at all, per
  // czz/movian-plugin-zooqle's real working zooqlefiles/zooqleshows
  // routes; an async style calling a haveMore(bool) passed as the
  // function's own argument, per movian.tv/issues/2504; and a
  // page.haveMore(bool) method-call style, per movian.tv/issues/2946).
  // Rather than bet on one, this:
  //   1. Loads the first page synchronously, inline, right here - before
  //      page.paginator is even assigned. This is the real fix for
  //      "spins forever": it makes the first page's content appear
  //      independently of whichever paginator convention (or bug) this
  //      build has, since it doesn't depend on the paginator mechanism
  //      firing at all.
  //   2. Only assigns page.paginator (for scrolling to further pages)
  //      once the first page is in, and calls a completion signal in
  //      every form that's actually callable, so whichever convention
  //      this runtime uses, one of them lands.
  var offset = 0;
  var pageSize = 30;
  var exhausted = false;

  function signalDone(hasMore, haveMoreArg) {
    page.loading = false;
    if (typeof haveMoreArg === 'function') haveMoreArg(hasMore);
    if (typeof page.haveMore === 'function') page.haveMore(hasMore);
    return hasMore;
  }

  function loadPage(haveMoreArg) {
    if (exhausted) return signalDone(false, haveMoreArg);
    page.loading = true;
    try {
      var result = api.search('', slug, undefined, pageSize, offset);
      for (var i = 0; i < result.items.length; i++) {
        var hit = result.items[i];
        if (hit.kind === 'movie') {
          items.appendMovieItem(page, hit.movie, hit.has_alive);
        }
        // Filename-only (unmatched) hits are intentionally skipped here:
        // tag/genre filtering is a Movie-level concept (tag filters
        // don't apply to the raw-filename half of search results
        // server-side), so a genre browse should never mix in unmatched
        // files that have no genre of their own.
      }
      offset += result.items.length;
      exhausted = result.items.length < pageSize;
      return signalDone(!exhausted, haveMoreArg);
    } catch (e) {
      page.error('' + e);
      exhausted = true;
      return signalDone(false, haveMoreArg);
    }
  }

  loadPage(); // first page, synchronous, independent of the paginator mechanism
  page.paginator = loadPage; // subsequent pages, whichever convention Movian uses
});

// ---------------------------------------------------------------------
// Movie detail
// ---------------------------------------------------------------------
// page.type stays 'directory' here (NOT 'video' - that was a genuine
// mistake in an earlier revision: page.type = 'video' makes Movian open
// the page directly in the PLAYER, not a detail screen - confirmed by
// the resulting black playback UI with pause/seek controls and no
// content. 'video' as an item TYPE (the third arg to page.appendItem,
// used per-release below) is unrelated and correct - it's page.type
// specifically that must stay 'directory' for a browsable page with a
// backdrop, description and a list of things to click). The confirmed-
// real page-level metadata fields (title/icon/background/description/
// rating/year/genre - see movian-metadata reference doc) still apply
// the same way on a directory page; only the page TYPE was wrong, not
// the field names.

new page.Route(PREFIX + 'movie:(.*)', function(page, movieIdRaw) {
  var movieId = decodeURIComponent(movieIdRaw);
  page.type = 'directory';
  page.contents = 'list';
  if (page.model) page.model.contents = 'list';
  // Custom detail layout: poster + overview + files. Skins that do not
  // honour glwview still get a normal list of playable files below.
  page.metadata.glwview = Plugin.path + 'views/movie_detail.view';
  page.loading = true;

  var movie;
  try {
    movie = api.getMovie(movieId);
  } catch (e) {
    page.error('' + e);
    return;
  }
  if (!movie) {
    page.error('Movie not found');
    return;
  }

  var title = items.movieTitle(movie);
  var overview = items.movieOverview(movie) || '';
  var year = items.movieYear(movie.ReleaseDate);
  var rating = movie.VoteAverage ? (movie.VoteAverage * 10) : undefined;

  var genreNames = [];
  if (movie.tags) {
    for (var t = 0; t < movie.tags.length; t++) {
      if (movie.tags[t].Kind === 'genre') genreNames.push(movie.tags[t].Name);
    }
  }
  var genreStr = genreNames.length ? genreNames.join(', ') : '';

  // Subtitle line for the custom view: "2026  ·  7.6/10  ·  Adventure, …"
  var subtitleParts = [];
  if (year) subtitleParts.push(String(year));
  if (movie.VoteAverage) subtitleParts.push(movie.VoteAverage.toFixed(1) + '/10');
  if (genreStr) subtitleParts.push(genreStr);
  var subtitle = subtitleParts.join('  \u00b7  ');

  page.metadata.title = title;
  if (year) page.metadata.year = year;
  if (rating != null) page.metadata.rating = rating;
  if (overview) page.metadata.description = new RichText(overview);
  if (genreStr) page.metadata.genre = genreStr;
  // Plain strings for the GLW view bindings
  // GLW label ignores soft-wrap and \n — emit fixed line slots.
  var olines = wrapText(overview, 98).split('\n');
  for (var oi = 0; oi < 8; oi++) {
    page.metadata['ol' + (oi + 1)] = olines[oi] || '';
  }

  page.metadata.subtitle = subtitle;
  if (movie.BackdropPath) {
    page.metadata.background = api.tmdbImageUrl(movie.BackdropPath, 'w1280');
    // Soften skin backdrop so poster/text stay readable (flat skin reads this).
    page.metadata.backgroundAlpha = 0.45;
  }
  if (movie.PosterPath) {
    page.metadata.icon = api.tmdbImageUrl(movie.PosterPath, 'w500');
  }

  var releases = [];
  try {
    releases = api.getMovieReleases(movieId);
  } catch (e) {}

  var playable = [];
  for (var i = 0; i < releases.length; i++) {
    if (!items.isSubtitleFile(releases[i].Name)) {
      playable.push(releases[i]);
    }
  }

  page.metadata.filesHeader = playable.length
    ? 'Play'
    : (releases.length ? 'No playable video files' : 'No releases indexed yet');

  if (playable.length === 0) {
    page.appendPassiveItem('separator', null, {title: page.metadata.filesHeader});
  } else {
    var sorted = playable.slice().sort(function(a, b) {
      return (a.Name || '').localeCompare(b.Name || '');
    });
    for (var r = 0; r < sorted.length; r++) {
      items.appendReleaseItem(page, sorted[r]);
    }
  }

  page.loading = false;
});


// ---------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------

new page.Route(PREFIX + 'search:(.*)', function(page, queryRaw) {
  var query = decodeURIComponent(queryRaw || '');

  page.type = 'directory';
  page.metadata.title = query ? ('Search: ' + query) : 'Search';
  if (query) {
    page.contents = 'movies';
    page.model.contents = 'grid';
  }

  if (!query) {
    page.loading = false;
    // Same 'search' item type as the home page: selecting it opens the
    // keyboard and re-enters this route with the typed query.
    page.appendItem(PREFIX + 'search:', 'search', {
      title: 'Type a search query...'
    });
    var recent = history.list();
    if (recent.length > 0) {
      page.appendPassiveItem('divider', undefined, {title: 'Recent searches'});
      for (var i = 0; i < recent.length; i++) {
        (function(q) {
          page.appendItem(items.searchUri(q), 'directory', {title: q});
        })(recent[i]);
      }
    }
    return;
  }

  history.record(query);
  page.loading = true;

  // See the genre: route above for why the first page is loaded
  // synchronously here rather than solely through page.paginator, and why
  // loadPage tries every real paginator-completion convention rather than
  // betting on one.
  var offset = 0;
  var pageSize = 30;
  var exhausted = false;

  function signalDone(hasMore, haveMoreArg) {
    page.loading = false;
    if (typeof haveMoreArg === 'function') haveMoreArg(hasMore);
    if (typeof page.haveMore === 'function') page.haveMore(hasMore);
    return hasMore;
  }

  function loadPage(haveMoreArg) {
    if (exhausted) return signalDone(false, haveMoreArg);
    page.loading = true;
    try {
      var result = api.search(query, '', undefined, pageSize, offset);
      for (var i = 0; i < result.items.length; i++) {
        var hit = result.items[i];
        if (hit.kind === 'movie') {
          items.appendMovieItem(page, hit.movie, hit.has_alive);
        } else if (hit.kind === 'file') {
          // Unmatched filename hit (search still works without TMDB
          // matching - see db.SearchAll): no poster/genre metadata
          // available, so render as a directly-playable item using the
          // filename as title rather than routing through a movie-detail
          // page it doesn't have. Subtitle files are skipped.
          if (hit.entry && !items.isSubtitleFile(hit.entry.Name)) {
            items.appendReleaseItem(page, hit.entry);
          }
        }
      }
      offset += result.items.length;
      exhausted = result.items.length < pageSize;
      return signalDone(!exhausted, haveMoreArg);
    } catch (e) {
      page.error('' + e);
      exhausted = true;
      return signalDone(false, haveMoreArg);
    }
  }

  loadPage();
  page.paginator = loadPage;
});

// Movian's built-in global search box calls this if registered - wires
// this plugin's results into Movian's universal search results screen.
// MUST populate results on the searcher page itself (appendItem), NOT
// redirect: page.redirect from a Searcher handler leaves Movian's search
// UI spinning forever because the global-search page never receives items.
page.Searcher('R\u1ea1p', Plugin.path + 'icon.png', function(page, query) {
  page.type = 'directory';
  page.loading = true;
  history.record(query);
  try {
    var pageSize = 30;
    var offset = 0;
    var result = api.search(query, '', undefined, pageSize, offset);
    for (var i = 0; i < result.items.length; i++) {
      var hit = result.items[i];
      if (hit.kind === 'movie') {
        items.appendMovieItem(page, hit.movie, hit.has_alive);
      } else if (hit.kind === 'file') {
        if (hit.entry && !items.isSubtitleFile(hit.entry.Name)) {
          items.appendReleaseItem(page, hit.entry);
        }
      }
    }
  } catch (e) {
    page.error('' + e);
  }
  page.loading = false;
});

// ---------------------------------------------------------------------
// Home screen service entry
// ---------------------------------------------------------------------

service.create('R\u1ea1p', PREFIX + 'start', 'video', true, Plugin.path + 'icon.png');
