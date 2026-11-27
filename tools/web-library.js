mergeInto(LibraryManager.library, {
  ark_clone_file: function (from, to) {
    try {
      Module['arkStorage'].clone(UTF8ToString(from >>> 0), UTF8ToString(to >>> 0));
      return 0;
    } catch (error) {
      console.warn(error);
      return -1;
    }
  },
  ark_prepare_cache: function (directory) {
    return Module['arkStorage'].prepare(UTF8ToString(directory >>> 0));
  },
  ark_prepare_cache_poll: function (id) {
    return Module['arkStorage'].pending(id);
  },
  ark_prepare_cache_close: function (id) {
    Module['arkStorage'].close(id);
  },
  ark_cached_digest: function (path, output) {
    var digest = Module['arkStorage'].digest(UTF8ToString(path >>> 0));
    if (!digest) return 0;
    HEAPU8.set(digest, output >>> 0);
    return 1;
  },
  ark_analyze: function (mode, payload, output, length) {
    return Module['arkAnalyze'](
      UTF8ToString(mode >>> 0),
      UTF8ToString(payload >>> 0),
      output >>> 0,
      length,
    );
  },
  ark_net_start: function (url, timeout) {
    return Module['arkNet'].start(UTF8ToString(url), timeout);
  },
  ark_net_meta: function (id, data, capacity) {
    return Module['arkNet'].meta(id, data >>> 0, capacity);
  },
  ark_net_read: function (id, data, capacity) {
    return Module['arkNet'].read(id, data >>> 0, capacity);
  },
  ark_net_close: function (id) {
    Module['arkNet'].close(id);
  },
  ark_ready: function () {
    Module['arkReady']();
  },
  ark_reply: function (id, status, headers, headersLength, body, bodyLength) {
    body >>>= 0;
    Module['arkReply'](
      id,
      status,
      JSON.parse(UTF8ToString(headers >>> 0, headersLength)),
      HEAPU8.slice(body, body + bodyLength),
    );
  },
  ark_fatal: function (message, length) {
    Module['arkFatal'](UTF8ToString(message, length));
  },
});
