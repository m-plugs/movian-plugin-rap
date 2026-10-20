/**
 * settings.js - registers the plugin's user-configurable settings
 * (server URL, dead-link filter, page size) via Movian's settings module,
 * and exposes the current values as a plain object other modules read
 * from.
 *
 * Two real bugs fixed here, both confirmed against Movian's actual
 * legacy-API wrapper source (api-v1.js), which is the ground truth for
 * what the ecmascript runtime really provides:
 *
 * 1. globalSettings is a CONSTRUCTOR, not a plain factory function - the
 *    reference wrapper always calls it as
 *    `new settings.globalSettings(Plugin.id, title, icon, description)`.
 *    Calling it without `new` (as this file previously did) runs it as a
 *    plain function call, where its internal `this`-based construction
 *    logic doesn't build a real object - it returns undefined instead of
 *    a group, which is exactly what crashed group.createString below.
 *
 * 2. Plugin.title and Plugin.synopsis are NOT real properties of the
 *    native Plugin global - only Plugin.path, Plugin.id and
 *    Plugin.manifest (raw plugin.json text) are. Title/synopsis have to
 *    be read out of the parsed manifest instead, same as the reference
 *    wrapper's own getDescriptor() does with JSON.parse(Plugin.manifest).
 *    Referencing Plugin.title/Plugin.synopsis previously just evaluated
 *    to undefined (no crash by itself, since JS doesn't error on reading
 *    a missing property) - it only became visible once combined with the
 *    missing `new` above making the whole call fail on the next line.
 *
 * There is no declarative "settings.json" manifest field in Movian at
 * all - an earlier version of this plugin mistakenly added
 * plugin.json: "settings": "settings.json", which was reverted; this is
 * the only real settings mechanism the ecmascript plugin API has.
 * settings.globalSettings creates the settings page under the plugin's
 * entry in Movian's settings UI, and each setting's current value is read
 * via a "change" callback that updates a plain JS object other modules
 * read synchronously - Movian's settings API is callback-based, not a
 * synchronous getter.
 */

var settingsModule = require('movian/settings');

exports.settings = {
  serverUrl: 'https://example.com',
  hideDeadLinks: true,
  pageSize: 30,
  useVietnamese: false
};

var manifest = JSON.parse(Plugin.manifest);

var group = new settingsModule.globalSettings(
  Plugin.id,
  manifest.title,
  Plugin.path + 'icon.png',
  manifest.synopsis
);

group.createString('serverUrl', 'MediaIndex server URL', 'http://localhost:8080', function(v) {
  exports.settings.serverUrl = v;
});

group.createBool('hideDeadLinks', 'Hide dead links', true, function(v) {
  exports.settings.hideDeadLinks = v;
});

group.createInt('pageSize', 'Items per page', 30, 10, 100, 10, 'items', function(v) {
  exports.settings.pageSize = v;
});

group.createBool('useVietnamese', 'Use Vietnamese titles & descriptions', false, function(v) {
  exports.settings.useVietnamese = v;
});
