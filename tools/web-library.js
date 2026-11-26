mergeInto(LibraryManager.library, {
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
