/**
 * history.js - persists recent search queries in Movian's local plugin
 * store (require('movian/store')), per the decision to keep search
 * history device-local rather than server-side. Lost on plugin
 * reinstall/uninstall, which is an accepted tradeoff for the simplicity
 * of not needing a new mediaindex server-side table/endpoint for this.
 */

var store = require('movian/store').create('searchHistory');

var MAX_HISTORY = 15;

if (!store.queries) {
  store.queries = [];
}

// record(query) adds a query to the front of the history, de-duplicating
// (a repeated search moves back to the front rather than appearing twice)
// and capping length at MAX_HISTORY.
exports.record = function(query) {
  query = (query || '').trim();
  if (!query) return;

  var existing = store.queries || [];
  var filtered = [];
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].toLowerCase() !== query.toLowerCase()) {
      filtered.push(existing[i]);
    }
  }
  filtered.unshift(query);
  if (filtered.length > MAX_HISTORY) {
    filtered = filtered.slice(0, MAX_HISTORY);
  }
  store.queries = filtered;
};

// list() returns the recent queries, most recent first.
exports.list = function() {
  return store.queries || [];
};

// clear() empties the history - exposed for a "Clear search history" item
// on the home page.
exports.clear = function() {
  store.queries = [];
};
