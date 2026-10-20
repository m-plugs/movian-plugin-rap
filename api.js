/**
 * api.js - thin HTTP client for the MediaIndex server's JSON API.
 *
 * All response shapes here were verified against a real running
 * mediaindex server (see internal/api/*.go), not guessed:
 *   - GET /api/movies                 -> [Movie, ...] | null   (no "tags" key on list items)
 *   - GET /api/movies/{id}            -> Movie (with "tags": [Tag, ...])
 *   - GET /api/movies/{id}/releases   -> [Entry, ...] | null
 *   - GET /api/tags?kind=             -> [{ID,Kind,Name,Slug,MovieCount}, ...] | null
 *   - GET /api/search?q=&tag=&dead=   -> {items: [{kind, movie|entry, has_alive}], total, query, dead}
 *
 * Every list endpoint can return bare JSON `null` (not `[]`) when empty -
 * every function here normalizes that to an empty array so callers never
 * have to null-check.
 */

var http = require('showtime/http');
var settings = require('./settings').settings;

exports.baseUrl = function() {
  var url = settings.serverUrl || 'http://localhost:8080';
  // Trim any trailing slash the user might have typed, so path
  // concatenation below never produces a double slash.
  return url.replace(/\/+$/, '');
};

/**
 * get() performs a GET request against the MediaIndex API and returns the
 * parsed JSON body. Throws on network failure or non-2xx status, since
 * every call site here wants that to surface as a page.error() rather than
 * silently returning something falsy that gets mistaken for "no results".
 */
function get(path, params) {
  var url = exports.baseUrl() + path;
  var resp = http.request(url, {
    args: params || {},
    method: 'GET',
    compression: true
  });
  var status = resp.statuscode || 200;
  if (status < 200 || status >= 300) {
    throw new Error('MediaIndex server returned HTTP ' + status + ' for ' + path);
  }
  var body = resp.toString('utf-8');
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error('MediaIndex server returned invalid JSON for ' + path + ': ' + e);
  }
}

function post(path, bodyObj) {
  var url = exports.baseUrl() + path;
  var resp = http.request(url, {
    method: 'POST',
    postdata: JSON.stringify(bodyObj || {}),
    headers: {'Content-Type': 'application/json'}
  });
  var status = resp.statuscode || 200;
  if (status < 200 || status >= 300) {
    throw new Error('MediaIndex server returned HTTP ' + status + ' for ' + path);
  }
  var body = resp.toString('utf-8');
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

// arrOrEmpty normalizes the "bare null instead of []" behavior every list
// endpoint exhibits when the underlying table is empty (confirmed live:
// GET /api/movies and /api/tags both return the literal JSON `null`, not
// `[]`, when there's nothing to return).
function arrOrEmpty(v) {
  return v === null || v === undefined ? [] : v;
}

/**
 * listMovies(sort, limit, offset) - GET /api/movies?sort=&limit=&offset=
 * sort: 'recent' (default, mediaindex's own last-touched timestamp) or
 * 'uploaded' (latest source-provided upload date across a movie's
 * releases - what "browse by upload/create timestamp" actually means).
 */
exports.listMovies = function(sort, limit, offset) {
  return arrOrEmpty(get('/api/movies', {
    sort: sort || 'recent',
    limit: limit || 30,
    offset: offset || 0
  }));
};

// getMovie(id) - GET /api/movies/{id}, includes "tags".
exports.getMovie = function(id) {
  return get('/api/movies/' + encodeURIComponent(id), {});
};

// getMovieReleases(id) - GET /api/movies/{id}/releases, the file(s)
// attached to a movie. For a TV show (media_type=tv) with multiple
// episodes indexed as separate releases, this is the episode list.
exports.getMovieReleases = function(id) {
  return arrOrEmpty(get('/api/movies/' + encodeURIComponent(id) + '/releases', {}));
};

// listTags(kind) - GET /api/tags?kind=genre|keyword|release, or all kinds
// if omitted. Each result has {ID, Kind, Name, Slug, MovieCount}.
exports.listTags = function(kind) {
  var params = {};
  if (kind) params.kind = kind;
  return arrOrEmpty(get('/api/tags', params));
};

/**
 * search(query, tag, deadFilter, limit, offset) - GET /api/search.
 * Returns the raw {items, total, query, dead} envelope (not normalized to
 * an array) since callers need `total` for pagination and each item is
 * tagged with kind:'movie'|'file' - unlike the other list endpoints this
 * shape is intentionally kept as-is rather than flattened.
 */
exports.search = function(query, tag, deadFilter, limit, offset) {
  var result = get('/api/search', {
    q: query || '',
    tag: tag || '',
    dead: deadFilter || (settings.hideDeadLinks ? 'exclude' : 'include'),
    limit: limit || settings.pageSize || 30,
    offset: offset || 0
  });
  if (!result) return {items: [], total: 0, query: query || '', dead: 'exclude'};
  result.items = arrOrEmpty(result.items);
  return result;
};

// sendToAria2(entryId) - POST /api/download/aria2 {entry_id}. Returns the
// parsed response ({gid, url, message}) or throws on failure - callers
// should catch and surface via page.error()/a notification, since a
// missing ARIA2_RPC_URL config on the server is a common, expected failure
// mode, not a bug.
exports.sendToAria2 = function(entryId) {
  return post('/api/download/aria2', {entry_id: entryId});
};

// tmdbImageUrl(path, size) - builds a full TMDB CDN URL from the
// TMDB-relative path mediaindex stores (e.g. "/abc123.jpg"). Mirrors
// exactly what mediaindex's own web UI does (internal/web/template_funcs.go):
// images are never proxied or cached by mediaindex, only referenced by
// path, so the plugin talks to image.tmdb.org directly too.
exports.tmdbImageUrl = function(path, size) {
  if (!path) return null;
  return 'https://image.tmdb.org/t/p/' + (size || 'w500') + path;
};
