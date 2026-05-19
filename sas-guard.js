/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  sas-guard.js — Secure Access System client integration    ║
 * ║                                                            ║
 * ║  Drop in your project root. Add ONE line to any page:      ║
 * ║    <script src="/sas-guard.js"></script>                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
   *  CONFIG — only edit this section
   * ═══════════════════════════════════════════════ */
  var SAS_URL      = 'https://YOUR-SAS.vercel.app'; // ← no trailing slash
  var BLOCKED_PATH = '/blocked.html';               // your blocked page, or null
  var SHOW_BADGE   = true;                          // session countdown badge
  var OVERLAY_BG   = '#070d1a';                     // overlay background colour
  var OVERLAY_ACC  = '#38bdf8';                     // spinner/accent colour
  /* ═══════════════════════════════════════════════ */

  var VERIFY_URL  = SAS_URL + '/api/verify';
  var GATEWAY_URL = SAS_URL + '/api/gateway';
  var TOKEN_KEY   = 'sas_token';
  var FLAG_KEY    = 'sas_redirected';

  /* Page URL without sas_token param */
  var pageUrl = (function () {
    var p = new URLSearchParams(window.location.search);
    p.delete('sas_token');
    return window.location.origin + window.location.pathname +
      (p.toString() ? '?' + p.toString() : '');
  })();

  /* ── Inject overlay immediately (before any page paint) ──
   * This replaces visibility:hidden which caused the black flash.
   * The overlay sits ON TOP of the page — your page renders normally
   * underneath, the overlay fades away once access is confirmed.
   * ─────────────────────────────────────────────────────────── */
  var overlay = _createOverlay();

  /* ── Grab fresh token from URL if gateway just redirected back ── */
  var urlParams  = new URLSearchParams(window.location.search);
  var freshToken = urlParams.get('sas_token');

  if (freshToken) {
    _store(TOKEN_KEY, freshToken);
    urlParams.delete('sas_token');
    var qs = urlParams.toString();
    window.history.replaceState({}, '',
      window.location.pathname + (qs ? '?' + qs : ''));
    _store(FLAG_KEY, null);
  }

  var token = freshToken || _load(TOKEN_KEY);

  /* ── No token → redirect to gateway ── */
  if (!token) {
    if (_load(FLAG_KEY) === '1') {
      _store(FLAG_KEY, null);
      _blocked('no_token');
    } else {
      _store(FLAG_KEY, '1');
      /* Show "Redirecting…" on the overlay before navigating */
      _overlayText('Redirecting…');
      window.location.replace(GATEWAY_URL + '?return=' + encodeURIComponent(pageUrl));
    }
    return;
  }

  /* ── Verify with SAS ── */
  _verify(token);

  /* ═══════════════════════════════════════════════════════════
   *  Core functions
   * ═══════════════════════════════════════════════════════════ */

  function _verify(tok) {
    fetch(VERIFY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ token: tok }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.success) {
        _store(FLAG_KEY, null);
        _overlaySuccess(data.session);   // show ✓ then fade out
      } else {
        _store(TOKEN_KEY, null);
        if (_load(FLAG_KEY) === '1') {
          _store(FLAG_KEY, null);
          _overlayText('Redirecting…');
          setTimeout(function () { _blocked(data.reason || 'invalid_token'); }, 400);
        } else {
          _store(FLAG_KEY, '1');
          _overlayText('Redirecting…');
          window.location.replace(GATEWAY_URL + '?return=' + encodeURIComponent(pageUrl));
        }
      }
    })
    .catch(function () {
      /* Network error — remove overlay and show page (fail-open) */
      console.warn('[SAS] verify network error — showing page');
      _overlayRemove();
    });
  }

  function _blocked(reason) {
    if (BLOCKED_PATH) {
      window.location.replace(BLOCKED_PATH + '?reason=' + encodeURIComponent(reason));
    } else {
      /* Replace overlay content with inline block message */
      overlay.innerHTML = '';
      overlay.style.cssText = _overlayBase() +
        'display:flex;align-items:center;justify-content:center;text-align:center';
      var box = document.createElement('div');
      box.style.cssText = 'max-width:340px;padding:20px';
      box.innerHTML =
        '<div style="font-size:44px;margin-bottom:14px">🔒</div>' +
        '<h2 style="color:#ff1744;margin-bottom:8px;font-family:sans-serif">Access Denied</h2>' +
        '<p style="color:#94a3b8;font-size:14px;margin-bottom:24px;font-family:sans-serif;line-height:1.6">' +
          'Your session is invalid or has expired.' +
        '</p>' +
        '<a href="' + GATEWAY_URL + '?return=' + encodeURIComponent(pageUrl) + '" ' +
        'style="padding:11px 24px;background:#38bdf8;color:#070d1a;border-radius:7px;' +
        'text-decoration:none;font-weight:700;font-size:14px;font-family:sans-serif">' +
        'Request Access →</a>';
      overlay.appendChild(box);
    }
  }

  /* ═══════════════════════════════════════════════════════════
   *  Overlay rendering
   * ═══════════════════════════════════════════════════════════ */

  function _overlayBase() {
    return [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:' + OVERLAY_BG,
      'font-family:sans-serif',
      'transition:opacity .35s ease',
    ].join(';') + ';';
  }

  function _createOverlay() {
    var el = document.createElement('div');
    el.id  = 'sas-overlay';
    el.style.cssText = _overlayBase() +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'opacity:1';

    /* Spinner */
    var spinner = document.createElement('div');
    spinner.id = 'sas-spinner';
    spinner.style.cssText = [
      'width:40px', 'height:40px', 'border-radius:50%',
      'border:2.5px solid rgba(56,189,248,.15)',
      'border-top-color:' + OVERLAY_ACC,
      'animation:sas-spin .8s linear infinite',
      'margin-bottom:18px',
    ].join(';');

    /* Label */
    var label = document.createElement('div');
    label.id = 'sas-overlay-label';
    label.style.cssText = [
      'font-size:12px', 'letter-spacing:2px', 'text-transform:uppercase',
      'color:rgba(148,163,184,.6)', 'font-family:monospace',
    ].join(';');
    label.textContent = 'Verifying…';

    /* Keyframe injection */
    var style = document.createElement('style');
    style.textContent =
      '@keyframes sas-spin{to{transform:rotate(360deg)}}' +
      '@keyframes sas-fadein{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}' +
      '@keyframes sas-fadeout{from{opacity:1}to{opacity:0}}';

    el.appendChild(spinner);
    el.appendChild(label);

    /* Inject synchronously right now — before any paint.
     * body may not exist yet so we append to <html> directly.
     * The overlay uses position:fixed so layout doesn't matter. */
    if (document.head) document.head.appendChild(style);
    else document.documentElement.appendChild(style);
    document.documentElement.appendChild(el);

    return el;
  }

  function _overlayText(msg) {
    var lbl = document.getElementById('sas-overlay-label');
    if (lbl) lbl.textContent = msg;
  }

  function _overlaySuccess(session) {
    var spinner = document.getElementById('sas-spinner');
    var lbl     = document.getElementById('sas-overlay-label');

    /* Swap spinner → checkmark */
    if (spinner) {
      spinner.style.border    = 'none';
      spinner.style.animation = 'none';
      spinner.style.width     = '56px';
      spinner.style.height    = '56px';
      spinner.style.borderRadius = '50%';
      spinner.style.background   = 'rgba(0,230,118,.08)';
      spinner.style.border       = '2px solid #00e676';
      spinner.style.display      = 'flex';
      spinner.style.alignItems   = 'center';
      spinner.style.justifyContent = 'center';
      spinner.style.animation    = 'sas-fadein .25s ease both';
      spinner.style.boxShadow    = '0 0 24px rgba(0,230,118,.2)';
      spinner.style.marginBottom = '14px';
      spinner.innerHTML =
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
        'xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M5 12.5L10 17.5L19 8" stroke="#00e676" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    if (lbl) {
      lbl.textContent = 'Access Granted';
      lbl.style.color = '#00e676';
      lbl.style.letterSpacing = '2px';
    }

    /* Fade out overlay after a brief pause so the user sees the ✓ */
    setTimeout(function () {
      if (overlay) {
        overlay.style.transition = 'opacity .4s ease';
        overlay.style.opacity    = '0';
        overlay.style.pointerEvents = 'none';
        setTimeout(function () {
          _overlayRemove();
          if (SHOW_BADGE && session) _badge(session);
        }, 420);
      }
    }, 600);   /* 600ms of "Access Granted" before fading out */
  }

  function _overlayRemove() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  /* ═══════════════════════════════════════════════════════════
   *  Session countdown badge (injected after overlay removed)
   * ═══════════════════════════════════════════════════════════ */
  function _badge(session) {
    if (!session || !session.expiry) return;

    var wrap = document.createElement('div');
    wrap.id  = 'sas-badge';
    wrap.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px',
      'z-index:2147483647',
      'display:inline-flex', 'align-items:center', 'gap:6px',
      'background:rgba(7,13,26,.94)', 'border:1px solid #1e3048',
      'border-radius:6px', 'padding:6px 12px',
      'font-family:monospace', 'font-size:11px', 'letter-spacing:1px',
      'user-select:none', 'pointer-events:none',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
      'transition:color .3s,border-color .3s',
      'opacity:0', 'animation:sas-fadein .3s ease .1s both',
    ].join(';');

    var dot = document.createElement('span');
    var txt = document.createElement('span');
    wrap.appendChild(dot);
    wrap.appendChild(txt);

    function mount() {
      if (document.body) {
        document.body.appendChild(wrap);
        /* Trigger opacity after append */
        setTimeout(function () { wrap.style.opacity = '1'; }, 50);
        tick();
      } else { setTimeout(mount, 50); }
    }

    function tick() {
      var left = Math.max(0, session.expiry - Math.floor(Date.now() / 1000));
      var m    = String(Math.floor(left / 60)).padStart(2, '0');
      var s    = String(left % 60).padStart(2, '0');
      var w    = left < 60;

      txt.textContent        = '⏱ ' + m + ':' + s;
      wrap.style.color       = w ? '#ff1744' : '#38bdf8';
      wrap.style.borderColor = w ? '#5a1a22' : '#1e3048';
      dot.style.cssText =
        'width:6px;height:6px;border-radius:50%;flex-shrink:0;' +
        'background:' + (w ? '#ff1744' : '#00e676') + ';' +
        'box-shadow:0 0 5px '  + (w ? '#ff1744' : '#00e676');

      if (left === 0) {
        txt.textContent = 'Refreshing…';
        _store(TOKEN_KEY, null);
        setTimeout(function () {
          _store(FLAG_KEY, '1');
          window.location.replace(GATEWAY_URL + '?return=' + encodeURIComponent(pageUrl));
        }, 1200);
        return;
      }
      setTimeout(tick, 1000);
    }

    mount();
  }

  /* ── sessionStorage helpers ── */
  function _store(k, v) {
    try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); }
    catch (_) {}
  }
  function _load(k) {
    try { return sessionStorage.getItem(k); } catch (_) { return null; }
  }

})();
