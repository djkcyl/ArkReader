/* Independent of the main module graph: keep a usable screen if an import fails. */
(function () {
  var ready = false,
    failed = false,
    timer,
    armed = !document.body.classList.contains('startup-page');
  var seed = document.getElementById('ui-bootstrap');
  var backup = seed ? seed.cloneNode(true) : null;
  var value = new URL(location.href).searchParams.get('boot');
  var epoch = value === null ? null : Number(value);
  function native(command, args) {
    var core = window.__TAURI__ && window.__TAURI__.core;
    return core
      ? core.invoke(command, args || {})
      : Promise.reject(new Error('Native bridge unavailable'));
  }
  function bind(root) {
    var retry = root.querySelector('[data-ui-retry]');
    var close = root.querySelector('[data-ui-close]');
    if (retry)
      retry.onclick = function () {
        native('app_retry').catch(function () {
          location.reload();
        });
      };
    if (close)
      close.onclick = function () {
        native('app_quit').catch(function () {
          window.close();
        });
      };
  }
  function fail(message) {
    if (ready || failed) return;
    if (!armed) {
      if (window.startupError) window.startupError(message);
      else {
        var detail = document.getElementById('startup-error'),
          details = document.getElementById('startup-details');
        if (detail) detail.textContent = message;
        if (details) details.hidden = false;
        var retry = document.getElementById('retry'),
          quit = document.getElementById('quit');
        if (retry) {
          retry.hidden = false;
          retry.onclick = function () {
            location.reload();
          };
        }
        if (quit)
          quit.onclick = function () {
            native('app_quit').catch(function () {});
          };
      }
      native('app_frontend_log', { message: message }).catch(function () {});
      return;
    }
    failed = true;
    clearTimeout(timer);
    var root = document.getElementById('ui-bootstrap');
    if (!root && backup) {
      root = backup.cloneNode(true);
      document.getElementById('app').replaceChildren(root);
    }
    if (root) {
      root.querySelector('h1').textContent = '界面暂时未能打开';
      root.querySelector('[data-ui-detail]').textContent = message;
      root.querySelector('[data-ui-actions]').hidden = false;
      bind(root);
    }
    native('app_ui_failed', { message: message, epoch: epoch }).catch(function () {});
  }
  if (seed) bind(seed);
  document.addEventListener('arkreader-ui-ready', function () {
    ready = true;
    clearTimeout(timer);
    function acknowledge(attempt) {
      native('app_ui_ready', { epoch: epoch }).catch(function () {
        if (attempt < 4)
          setTimeout(function () {
            acknowledge(attempt + 1);
          }, 300);
      });
    }
    if (window.isTauri) acknowledge(0);
  });
  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;
      var asset = target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK');
      var message = asset
        ? '界面文件未能加载：' + (target.src || target.href)
        : (event.error && event.error.stack) || event.message || '界面初始化失败';
      if (!ready && (asset || event.message)) fail(String(message));
      else if (ready && event.message)
        native('app_frontend_log', { message: String(message) }).catch(function () {});
    },
    true,
  );
  window.addEventListener('unhandledrejection', function (event) {
    var message = String((event.reason && event.reason.stack) || event.reason || '界面初始化失败');
    if (!ready) fail(message);
    else native('app_frontend_log', { message: message }).catch(function () {});
  });
  function arm() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      fail('主界面加载超时，请重试。');
    }, 15000);
  }
  document.addEventListener('arkreader-main-loading', function (event) {
    epoch = event.detail.epoch;
    armed = true;
    arm();
  });
  if (armed) arm();
})();
