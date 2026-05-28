/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  sas-guard.js — Secure Access System client integration    ║
 * ║                                                            ║
 * ║  Drop in your project root. Add to any page:              ║
 * ║    <script src="/sas-guard.js"></script>                   ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CHANGES FROM PREVIOUS VERSION:
 *   • Token stored in localStorage (not sessionStorage) so it persists
 *     across tabs and browser restarts, matching index.js / main.js
 *   • Site-password second factor: if admin has set a password for this
 *     domain, a full-screen overlay is shown AFTER token verification.
 *     Both correct and wrong attempts are logged in SAS against the token.
 *   • Site session stored in localStorage as sas_site:{domain} so the
 *     overlay doesn't re-appear on every page within the same session.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
   *  CONFIG — only edit this section
   * ═══════════════════════════════════════════════ */
  var SAS_URL      = 'https://spc.secureip.org'; // ← no trailing slash
  var BLOCKED_PATH = '/blocked.html';               // your blocked page, or null
  var SHOW_BADGE   = true;                          // session countdown badge
  var OVERLAY_BG   = '#070d1a';                     // overlay background colour
  var OVERLAY_ACC  = '#38bdf8';                     // spinner/accent colour
  /* ═══════════════════════════════════════════════ */

  var VERIFY_URL   = SAS_URL + '/api/verify';
  var GATEWAY_URL  = SAS_URL + '/api/gateway';
  var SITE_AUTH_URL = SAS_URL + '/api/site-auth';
  var TOKEN_KEY    = 'sas_token';            // localStorage — { token, expiry }
  var SITE_KEY     = 'sas_site:' + location.hostname; // site password session
  var FLAG_KEY     = 'sas_redirected';       // sessionStorage — redirect loop guard

  var DOMAIN = location.hostname;

  /* Page URL without sas_token param */
  var pageUrl = (function () {
    var p = new URLSearchParams(window.location.search);
    p.delete('sas_token');
    return window.location.origin + window.location.pathname +
      (p.toString() ? '?' + p.toString() : '');
  })();

  /* ── Overlay (shown immediately, before any page paint) ── */
  var overlay = _createOverlay();

  /* ── Grab fresh token from URL if gateway just redirected back ── */
  var urlParams  = new URLSearchParams(window.location.search);
  var freshToken = urlParams.get('sas_token');

  if (freshToken) {
    /* Parse expiry from JWT payload so we can store it alongside the token */
    var freshExpiry = _parseExpiry(freshToken);
    _lsSet(TOKEN_KEY, JSON.stringify({ token: freshToken, expiry: freshExpiry }));
    urlParams.delete('sas_token');
    var qs = urlParams.toString();
    window.history.replaceState({}, '',
      window.location.pathname + (qs ? '?' + qs : ''));
    _ssSet(FLAG_KEY, null);
  }

  /* ── Read token from localStorage ── */
  var tokenObj = _readToken();
  var token    = tokenObj ? tokenObj.token : null;

  /* ── No token → redirect to gateway ── */
  if (!token) {
    if (_ssGet(FLAG_KEY) === '1') {
      _ssSet(FLAG_KEY, null);
      _blocked('no_token');
    } else {
      _ssSet(FLAG_KEY, '1');
      _overlayText('Redirecting…');
      window.location.replace(GATEWAY_URL + '?return=' + encodeURIComponent(pageUrl));
    }
    return;
  }

  /* ── Verify token with SAS, then check site password ── */
  _verify(token, tokenObj.expiry);

  /* ═══════════════════════════════════════════════════════════
   *  Core functions
   * ═══════════════════════════════════════════════════════════ */

  function _verify(tok, expiry) {
    fetch(VERIFY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ token: tok }),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data && data.success) {
        _ssSet(FLAG_KEY, null);
        /* Token valid — now check if site needs a password */
        _checkSitePassword(tok, expiry, data.session);
      } else {
        _lsSet(TOKEN_KEY, null);
        if (_ssGet(FLAG_KEY) === '1') {
          _ssSet(FLAG_KEY, null);
          _overlayText('Redirecting…');
          setTimeout(function () { _blocked(data.reason || 'invalid_token'); }, 400);
        } else {
          _ssSet(FLAG_KEY, '1');
          _overlayText('Redirecting…');
          window.location.replace(GATEWAY_URL + '?return=' + encodeURIComponent(pageUrl));
        }
      }
    })
    .catch(function () {
      console.warn('[SAS] verify network error — showing page');
      _overlayRemove();
    });
  }

  /* ── Site password second factor ── */
  function _checkSitePassword(tok, expiry, session) {
    fetch(SITE_AUTH_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ domain: DOMAIN, token: tok, phase: 'check' }),
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.passwordRequired) {
        /* No password set — proceed normally */
        _overlaySuccess(session);
        return;
      }
      /* Password required — check for existing site session */
      if (_readSiteSession()) {
        _overlaySuccess(session);
        return;
      }
      /* Password required — morph the verify overlay directly into the
       * password prompt WITHOUT fading out first. This prevents the page
       * flashing through during the gap between overlay removal and the
       * password overlay appearing. */
      _overlayMorphToPassword(tok, expiry);
    })
    .catch(function() {
      /* Network error checking site password — fail open */
      _overlaySuccess(session);
    });
  }

  function _blocked(reason) {
    if (BLOCKED_PATH) {
      window.location.replace(BLOCKED_PATH + '?reason=' + encodeURIComponent(reason));
    } else {
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
   *  Password overlay (second factor)
   * ═══════════════════════════════════════════════════════════ */

  function _buildPasswordOverlay(tok, tokenExpiry) {
    document.documentElement.style.overflow = 'hidden';
    var pw_overlay = document.createElement('div');
    pw_overlay.id = '__sas_pw_overlay__';
    pw_overlay.style.cssText = _overlayBase() +
      'display:flex;align-items:center;justify-content:center;opacity:1';
    pw_overlay.innerHTML = [
      '<style>',
      '#__sas_pw_box__{width:100%;max-width:380px;padding:0 20px;text-align:center}',
      '#__sas_pw_card__{background:#0d1829;border:1px solid #1e3048;border-radius:10px;',
        'padding:20px;text-align:left;margin-top:20px}',
      '@keyframes __sas_shake__{0%,100%{transform:translateX(0)}',
        '20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}',
      '#__sas_pw_inp__{width:100%;background:#111f32;border:1px solid #243a56;color:#e2e8f0;',
        'padding:10px 14px;border-radius:6px;font-size:14px;outline:none;box-sizing:border-box}',
      '#__sas_pw_inp__:focus{border-color:#38bdf8}',
      '#__sas_pw_btn__{width:100%;margin-top:12px;padding:11px;background:transparent;',
        'border:1px solid #38bdf8;color:#38bdf8;border-radius:6px;font-size:13px;',
        'font-family:monospace;cursor:pointer;transition:all .15s}',
      '#__sas_pw_btn__:hover:not(:disabled){background:#38bdf8;color:#070d1a}',
      '#__sas_pw_btn__:disabled{opacity:.4;cursor:not-allowed}',
      '#__sas_pw_err__{margin-top:10px;padding:8px 12px;border-radius:6px;',
        'background:rgba(255,23,68,.08);border:1px solid rgba(255,23,68,.2);',
        'color:#ff1744;font-size:12px;font-family:monospace;display:none}',
      '</style>',
      '<div id="__sas_pw_box__">',
        '<div style="font-size:32px;margin-bottom:12px">🔐</div>',
        '<div style="color:#e2e8f0;font-size:20px;font-weight:700;margin-bottom:6px">Authorization Required</div>',
        '<div style="color:#94a3b8;font-size:13px">Access verification required. Please enter your password to proceed.</div>',
        '<div id="__sas_pw_card__">',
          '<label style="display:block;font-size:11px;color:#94a3b8;letter-spacing:1px;',
            'font-family:monospace;margin-bottom:6px">ENTER PASSWORD</label>',
          '<input id="__sas_pw_inp__" type="password" placeholder="Enter password" autocomplete="current-password"/>',
          '<button id="__sas_pw_btn__">Unlock →</button>',
          '<div id="__sas_pw_err__"></div>',
        '</div>',
        '<div style="margin-top:16px;font-size:11px;color:#475569;font-family:monospace">',
          'Secured by SAS · ' + DOMAIN,
        '</div>',
      '</div>',
    ].join('');

    document.documentElement.appendChild(pw_overlay);

    var inp = pw_overlay.querySelector('#__sas_pw_inp__');
    var btn = pw_overlay.querySelector('#__sas_pw_btn__');
    var err = pw_overlay.querySelector('#__sas_pw_err__');

    function showError(msg) {
      err.textContent = '✕ ' + msg; err.style.display = 'block';
      var card = pw_overlay.querySelector('#__sas_pw_card__');
      card.style.animation = '__sas_shake__ .4s ease';
      setTimeout(function() { card.style.animation = ''; }, 400);
      inp.focus();
    }

    function setLoading(on) {
      btn.disabled = on; inp.disabled = on;
      btn.textContent = on ? 'Checking…' : 'Unlock →';
    }

    function attempt() {
      var pw = inp.value;
      if (!pw) { inp.focus(); return; }
      setLoading(true); err.style.display = 'none';
      fetch(SITE_AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: DOMAIN, token: tok, password: pw, phase: 'auth' }),
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          _saveSiteSession(tokenExpiry);
          pw_overlay.style.transition = 'opacity .3s ease';
          pw_overlay.style.opacity = '0';
          setTimeout(function() {
            if (pw_overlay.parentNode) pw_overlay.parentNode.removeChild(pw_overlay);
            document.documentElement.style.overflow = '';
          }, 320);
        } else {
          showError(data.error || 'Wrong password');
          inp.value = ''; setLoading(false);
        }
      })
      .catch(function() { showError('Network error — try again'); setLoading(false); });
    }

    btn.addEventListener('click', attempt);
    inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') attempt(); });
    setTimeout(function() { inp.focus(); }, 100);
  }

  /* ═══════════════════════════════════════════════════════════
   *  Overlay rendering (spinner / success)
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
      'display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:1';

    var spinner = document.createElement('div');
    spinner.id = 'sas-spinner';
    spinner.style.cssText = [
      'width:40px','height:40px','border-radius:50%',
      'border:2.5px solid rgba(56,189,248,.15)',
      'border-top-color:' + OVERLAY_ACC,
      'animation:sas-spin .8s linear infinite',
      'margin-bottom:18px',
    ].join(';');

    var label = document.createElement('div');
    label.id = 'sas-overlay-label';
    label.style.cssText = [
      'font-size:12px','letter-spacing:2px','text-transform:uppercase',
      'color:rgba(148,163,184,.6)','font-family:monospace',
    ].join(';');
    label.textContent = 'Verifying…';

    var style = document.createElement('style');
    style.textContent =
      '@keyframes sas-spin{to{transform:rotate(360deg)}}' +
      '@keyframes sas-fadein{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}';

    el.appendChild(spinner);
    el.appendChild(label);
    if (document.head) document.head.appendChild(style);
    else document.documentElement.appendChild(style);
    document.documentElement.appendChild(el);
    return el;
  }

  function _overlayText(msg) {
    var lbl = document.getElementById('sas-overlay-label');
    if (lbl) lbl.textContent = msg;
  }

  /**
   * @param {object} session
   */

  /**
   * Morph the existing verify overlay in-place into a password prompt.
   * Called instead of _overlaySuccess when a site password is required,
   * so the overlay NEVER disappears — the page is never visible between
   * token verification and the password prompt.
   */
  function _overlayMorphToPassword(tok, tokenExpiry) {
    // Swap spinner → lock icon, keeping the overlay fully opaque
    var spinner = document.getElementById('sas-spinner');
    var lbl     = document.getElementById('sas-overlay-label');

    if (spinner) {
      spinner.style.border     = 'none';
      spinner.style.animation  = 'none';
      spinner.style.background = 'transparent';
      spinner.style.boxShadow  = 'none';
      spinner.style.width      = 'auto';
      spinner.style.height     = 'auto';
      spinner.style.marginBottom = '12px';
      spinner.innerHTML = '<span style="font-size:36px">🔐</span>';
    }
    if (lbl) {
      lbl.textContent = 'Password Required';
      lbl.style.color = '#e2e8f0';
      lbl.style.marginBottom = '6px';
    }

    // Inject the password form below the icon + label
    var existing = overlay.querySelector('#sas-pw-form');
    if (existing) return; // already injected

    // Sub-label
    var sub = document.createElement('div');
    sub.style.cssText = 'font-size:13px;color:#94a3b8;margin-bottom:20px;font-family:sans-serif';
    sub.textContent   = 'This site requires an additional password.';

    // Card
    var card = document.createElement('div');
    card.id  = 'sas-pw-form';
    card.style.cssText = [
      'background:#0d1829', 'border:1px solid #1e3048', 'border-radius:10px',
      'padding:20px', 'width:100%', 'max-width:340px', 'box-sizing:border-box',
    ].join(';');

    // Inject shake keyframe if not already present
    if (!document.getElementById('sas-pw-style')) {
      var st = document.createElement('style');
      st.id  = 'sas-pw-style';
      st.textContent = '@keyframes sas-pw-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}';
      document.head.appendChild(st);
    }

    var labelEl = document.createElement('label');
    labelEl.style.cssText = 'display:block;font-size:11px;color:#94a3b8;letter-spacing:1px;font-family:monospace;margin-bottom:6px';
    labelEl.textContent   = 'SITE PASSWORD';

    var inp = document.createElement('input');
    inp.type        = 'password';
    inp.placeholder = 'Enter password';
    inp.setAttribute('autocomplete', 'current-password');
    inp.style.cssText = [
      'width:100%', 'background:#111f32', 'border:1px solid #243a56',
      'color:#e2e8f0', 'padding:10px 14px', 'border-radius:6px',
      'font-size:14px', 'outline:none', 'box-sizing:border-box',
      'font-family:inherit', 'transition:border-color .2s',
    ].join(';');
    inp.addEventListener('focus', function() { inp.style.borderColor = '#38bdf8'; });
    inp.addEventListener('blur',  function() { inp.style.borderColor = '#243a56'; });

    var btn = document.createElement('button');
    btn.textContent  = 'Unlock →';
    btn.style.cssText = [
      'width:100%', 'margin-top:12px', 'padding:11px',
      'background:transparent', 'border:1px solid #38bdf8',
      'color:#38bdf8', 'border-radius:6px', 'font-size:13px',
      'font-family:monospace', 'cursor:pointer', 'transition:all .15s',
    ].join(';');
    btn.addEventListener('mouseover', function() { if (!btn.disabled) { btn.style.background = '#38bdf8'; btn.style.color = '#070d1a'; } });
    btn.addEventListener('mouseout',  function() { if (!btn.disabled) { btn.style.background = 'transparent'; btn.style.color = '#38bdf8'; } });

    var err = document.createElement('div');
    err.style.cssText = [
      'margin-top:10px', 'padding:8px 12px', 'border-radius:6px',
      'background:rgba(255,23,68,.08)', 'border:1px solid rgba(255,23,68,.2)',
      'color:#ff1744', 'font-size:12px', 'font-family:monospace', 'display:none',
    ].join(';');

    card.appendChild(labelEl);
    card.appendChild(inp);
    card.appendChild(btn);
    card.appendChild(err);

    overlay.appendChild(sub);
    overlay.appendChild(card);

    function showError(msg) {
      err.textContent   = '✕ ' + msg;
      err.style.display = 'block';
      card.style.animation = 'sas-pw-shake .4s ease';
      setTimeout(function() { card.style.animation = ''; }, 400);
      inp.focus();
    }

    function setLoading(on) {
      btn.disabled    = on;
      inp.disabled    = on;
      btn.textContent = on ? 'Checking…' : 'Unlock →';
      btn.style.opacity = on ? '0.5' : '1';
    }

    function attempt() {
      var pw = inp.value;
      if (!pw) { inp.focus(); return; }
      setLoading(true);
      err.style.display = 'none';
      fetch(SITE_AUTH_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ domain: DOMAIN, token: tok, password: pw, phase: 'auth' }),
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          _saveSiteSession(tokenExpiry);
          // Now fade the overlay out and reveal the page
          overlay.style.transition   = 'opacity .35s ease';
          overlay.style.opacity      = '0';
          overlay.style.pointerEvents = 'none';
          setTimeout(_overlayRemove, 370);
        } else {
          showError(data.error || 'Wrong password');
          inp.value = '';
          setLoading(false);
        }
      })
      .catch(function() {
        showError('Network error — try again');
        setLoading(false);
      });
    }

    btn.addEventListener('click', attempt);
    inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') attempt(); });
    setTimeout(function() { inp.focus(); }, 80);
  }

  function _overlaySuccess(session) {
    var spinner = document.getElementById('sas-spinner');
    var lbl     = document.getElementById('sas-overlay-label');

    if (spinner) {
      spinner.style.border = 'none'; spinner.style.animation = 'none';
      spinner.style.width  = '56px'; spinner.style.height = '56px';
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
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">' +
        '<path d="M5 12.5L10 17.5L19 8" stroke="#00e676" stroke-width="2.2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (lbl) { lbl.textContent = 'Access Granted'; lbl.style.color = '#00e676'; }

    setTimeout(function () {
      if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.pointerEvents = 'none';
        setTimeout(function () {
          _overlayRemove();
          if (SHOW_BADGE && session) _badge(session);
        }, 420);
      }
    }, 600);
  }

  function _overlayRemove() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  /* ═══════════════════════════════════════════════════════════
   *  Session countdown badge
   * ═══════════════════════════════════════════════════════════ */
  function _badge(session) {
    if (!session || !session.expiry) return;
    var wrap = document.createElement('div');
    wrap.id  = 'sas-badge';
    wrap.style.cssText = [
      'position:fixed','bottom:16px','right:16px','z-index:2147483647',
      'display:inline-flex','align-items:center','gap:6px',
      'background:rgba(7,13,26,.94)','border:1px solid #1e3048',
      'border-radius:6px','padding:6px 12px',
      'font-family:monospace','font-size:11px','letter-spacing:1px',
      'user-select:none','pointer-events:none',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
      'transition:color .3s,border-color .3s',
    ].join(';');

    var dot = document.createElement('span');
    var txt = document.createElement('span');
    wrap.appendChild(dot); wrap.appendChild(txt);

    function mount() {
      if (document.body) { document.body.appendChild(wrap); tick(); }
      else setTimeout(mount, 50);
    }

    function tick() {
      var left = Math.max(0, session.expiry - Math.floor(Date.now() / 1000));
      var m = String(Math.floor(left / 60)).padStart(2, '0');
      var s = String(left % 60).padStart(2, '0');
      var w = left < 60;
      txt.textContent        = '⏱ ' + m + ':' + s;
      wrap.style.color       = w ? '#ff1744' : '#38bdf8';
      wrap.style.borderColor = w ? '#5a1a22' : '#1e3048';
      dot.style.cssText = 'width:6px;height:6px;border-radius:50%;flex-shrink:0;' +
        'background:' + (w ? '#ff1744' : '#00e676') + ';' +
        'box-shadow:0 0 5px ' + (w ? '#ff1744' : '#00e676');
      if (left === 0) {
        txt.textContent = 'Refreshing…';
        _lsSet(TOKEN_KEY, null);
        setTimeout(function () {
          _ssSet(FLAG_KEY, '1');
          window.location.replace(GATEWAY_URL + '?return=' + encodeURIComponent(pageUrl));
        }, 1200);
        return;
      }
      setTimeout(tick, 1000);
    }
    mount();
  }

  /* ═══════════════════════════════════════════════════════════
   *  Storage helpers
   * ═══════════════════════════════════════════════════════════ */

  /* localStorage — token + site session (persists across tabs) */
  function _lsSet(k, v) {
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (_) {}
  }
  function _lsGet(k) {
    try { return localStorage.getItem(k); } catch (_) { return null; }
  }

  /* sessionStorage — redirect loop flag only */
  function _ssSet(k, v) {
    try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (_) {}
  }
  function _ssGet(k) {
    try { return sessionStorage.getItem(k); } catch (_) { return null; }
  }

  function _readToken() {
    var raw = _lsGet(TOKEN_KEY);
    if (!raw) return null;
    try {
      var obj = JSON.parse(raw);
      if (!obj.token || !obj.expiry) return null;
      if (obj.expiry - Math.floor(Date.now() / 1000) <= 10) {
        _lsSet(TOKEN_KEY, null); return null;
      }
      return obj;
    } catch { return null; }
  }

  function _readSiteSession() {
    var raw = _lsGet(SITE_KEY);
    if (!raw) return false;
    try {
      var obj = JSON.parse(raw);
      if (!obj.expiry) return false;
      if (obj.expiry - Math.floor(Date.now() / 1000) <= 10) {
        _lsSet(SITE_KEY, null); return false;
      }
      return true;
    } catch { return false; }
  }

  function _saveSiteSession(tokenExpiry) {
    _lsSet(SITE_KEY, JSON.stringify({ expiry: tokenExpiry }));
  }

  function _parseExpiry(jwt) {
    try {
      var payload = JSON.parse(atob(jwt.split('.')[1]));
      return payload.exp || (Math.floor(Date.now() / 1000) + 300);
    } catch { return Math.floor(Date.now() / 1000) + 300; }
  }

})();
