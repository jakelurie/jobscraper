// The corpus browser the monitor panel hosts.
//
// The harness rewrites #panel-body via innerHTML every 3 seconds, which would
// wipe a search box, a scroll position and any open group on every tick. So the
// browser mounts itself into #jf-app, a sibling of the panel body that the
// harness never touches, and re-renders only when the underlying index changes.
// window.__jfCfg (set by the panel bootstrap) carries the URLs and a version
// stamp so an edit to this file swaps the running app out rather than stacking
// a second copy on top of it.
(function () {
  'use strict';

  var cfg = window.__jfCfg;
  if (!cfg) return;

  var S = { data: null, q: '', sort: 'new', open: {}, box: -1, shown: [] };
  var timer = null;

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var url = function (rel) {
    return '/api/file?path=' + encodeURIComponent(S.data.root + '/' + rel);
  };
  var ago = function (ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    return Math.floor(s / 86400) + 'd';
  };
  var titleCase = function (s) {
    return s.replace(/(^|[\s-])([a-z])/g, function (m, a, b) {
      return a + b.toUpperCase();
    });
  };

  // ---- how a field is filled in, in words --------------------------------
  // The corpus exists to record how each control has to be driven, so the
  // preview says that in English rather than showing the raw action names.
  var ACTION = {
    type: 'type text',
    'click-pick': 'dropdown',
    'click-type-pick': 'dropdown, type to filter',
    'click-type-wait-pick': 'type, wait for results',
    'pick-date': 'calendar',
    upload: 'file upload',
    'select-option': 'native select',
    'select-options': 'native multi-select',
    'choose-one': 'radio',
    check: 'checkbox',
    'check-many': 'checkboxes',
    toggle: 'switch',
    'type-then-pick-country': 'phone + country',
    'set-range': 'slider',
  };

  // The harness only styles .muted/.ok/.warn inside .mon-html, and the app
  // deliberately lives outside it, so it restates them against the same theme
  // variables rather than hard-coding colours the theme could change.
  var CSS = [
    // #panel is a flex column whose scrolling child is #panel-body. The app is
    // its sibling, so it has to claim that role: the body keeps only the 1px
    // bootstrap image and stops claiming height, and the app scrolls instead.
    '#panel-body{flex:0 0 auto;padding:0 10px}',
    '#panel.pinned #panel-body{flex:0 0 auto;overflow:visible}',
    '#jf-fallback{display:none}',
    '#jf-app{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;',
    'padding:2px 12px 14px;font:12.5px -apple-system,BlinkMacSystemFont,sans-serif;line-height:1.45;color:var(--fg)}',
    '#jf-app .muted,#jf-box .muted{color:var(--fg-dim)}',
    '#jf-app .warn,#jf-box .warn{color:var(--yellow)}',
    '#jf-app .ok,#jf-box .ok{color:var(--green)}',
    '#jf-app .r{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
    '#jf-app .big{font-size:26px;font-weight:700}',
    '#jf-app input.q{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:9px;',
    'border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);font-size:15px;outline:none}',
    '#jf-app .chips,#jf-box .chips{display:flex;flex-wrap:wrap;gap:5px;margin:7px 0 2px}',
    '#jf-app .chip,#jf-box .chip{background:rgba(255,255,255,.09);border-radius:9px;padding:3px 9px;font-size:11.5px;user-select:none}',
    '#jf-app .chip{cursor:pointer}',
    '#jf-app .chip.on{background:rgba(96,165,250,.30)}',
    '#jf-app .grp{border-top:1px solid rgba(255,255,255,.09);padding:7px 0 3px}',
    '#jf-app .ghead{display:flex;align-items:center;gap:8px;cursor:pointer}',
    '#jf-app .caret{width:11px;flex:none;font-size:10px}',
    '#jf-app .gname{font-weight:700}',
    '#jf-app .strip{display:flex;gap:3px;margin-left:auto;flex:none}',
    '#jf-app .strip img{width:22px;height:30px;object-fit:cover;object-position:top;border-radius:2px;background:#fff}',
    '#jf-app .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(102px,1fr));gap:8px;margin:8px 0 4px}',
    '#jf-app .card{cursor:pointer}',
    '#jf-app .shot{height:128px;overflow:hidden;border-radius:6px;background:#fff;border:1px solid rgba(255,255,255,.15)}',
    '#jf-app .shot img{width:100%;display:block}',
    '#jf-app .cn{font-size:11px;font-weight:700;margin-top:3px}',
    '#jf-app .cs{font-size:10.5px}',
    '#jf-app .cn,#jf-app .cs{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#jf-box{position:fixed;inset:0;z-index:9999;background:rgba(10,12,16,.97);overflow:auto;color:var(--fg);',
    'font:12.5px -apple-system,BlinkMacSystemFont,sans-serif;-webkit-overflow-scrolling:touch}',
    '#jf-box .bar{position:sticky;top:0;background:rgba(10,12,16,.97);padding:9px 12px;',
    'border-bottom:1px solid rgba(255,255,255,.12);display:flex;align-items:center;gap:10px}',
    '#jf-box .bar b{font-size:14px}',
    '#jf-box .nav{margin-left:auto;display:flex;gap:6px;flex:none}',
    '#jf-box button{background:rgba(255,255,255,.10);border:0;border-radius:8px;color:inherit;',
    'font:inherit;padding:5px 11px;cursor:pointer}',
    '#jf-box .meta{padding:8px 12px 4px}',
    '#jf-box img.full{display:block;width:100%;background:#fff}',
    '#jf-box a{color:#93c5fd}',
  ].join('');

  // ---- mounting ----------------------------------------------------------
  function ensure() {
    var panel = document.getElementById('panel');
    if (!panel) return null;
    var style = document.getElementById('jf-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'jf-style';
      document.head.appendChild(style);
    }
    if (style.textContent !== CSS) style.textContent = CSS;

    var host = document.getElementById('jf-app');
    if (!host) {
      host = document.createElement('div');
      host.id = 'jf-app';
      host.innerHTML =
        '<div><input class="q" id="jf-q" type="search" ' +
        'placeholder="search company, platform, role" autocomplete="off" autocorrect="off" spellcheck="false"></div>' +
        '<div class="chips" id="jf-sort"></div>' +
        '<div id="jf-groups"></div>';
      panel.appendChild(host);
      host.querySelector('#jf-q').addEventListener('input', function (e) {
        S.q = e.target.value.trim().toLowerCase();
        groups();
      });
      host.querySelector('#jf-sort').addEventListener('click', function (e) {
        var c = e.target.closest('[data-sort]');
        if (!c) return;
        S.sort = c.getAttribute('data-sort');
        sorts();
        groups();
      });
      host.querySelector('#jf-groups').addEventListener('click', function (e) {
        var g = e.target.closest('[data-group]');
        var card = e.target.closest('[data-i]');
        if (card) return open(+card.getAttribute('data-i'));
        if (g) {
          var n = g.getAttribute('data-group');
          S.open[n] = !S.open[n];
          groups();
        }
      });
      sorts();
    }
    return host;
  }

  function sorts() {
    var el = document.getElementById('jf-sort');
    if (!el) return;
    var opts = [['new', 'newest'], ['fields', 'most fields'], ['az', 'A–Z']];
    el.innerHTML = opts
      .map(function (o) {
        return '<span class="chip' + (S.sort === o[0] ? ' on' : '') + '" data-sort="' + o[0] + '">' + o[1] + '</span>';
      })
      .join('');
  }

  // ---- the groups --------------------------------------------------------
  function match(f) {
    if (!S.q) return true;
    return (f.c + ' ' + f.g + ' ' + f.label + ' ' + f.t + ' ' + f.loc).toLowerCase().indexOf(S.q) >= 0;
  }
  function order(list) {
    var c = list.slice();
    if (S.sort === 'fields') c.sort(function (a, b) { return b.n - a.n; });
    else if (S.sort === 'az') c.sort(function (a, b) { return a.c.localeCompare(b.c); });
    else c.sort(function (a, b) { return b.at - a.at; });
    return c;
  }

  function groups() {
    var d = S.data;
    var box = document.getElementById('jf-groups');
    if (!box || !d) return;
    var hits = order(d.forms.filter(match));
    S.shown = hits;

    if (!hits.length) {
      box.innerHTML = '<div class="muted" style="padding:14px 0">nothing matches “' + esc(S.q) + '”</div>';
      return;
    }

    var by = {};
    hits.forEach(function (f) {
      (by[f.g] = by[f.g] || []).push(f);
    });
    var names = Object.keys(by).sort(function (a, b) { return by[b].length - by[a].length; });

    var html = S.q
      ? '<div class="muted" style="padding:7px 0 0">' + hits.length + ' of ' + d.forms.length +
        ' forms across ' + names.length + ' platforms</div>'
      : '';
    names.forEach(function (n) {
      var list = by[n];
      // A search is a request to see the matches, so it opens what it hits.
      var isOpen = !!S.q || !!S.open[n];
      html +=
        '<div class="grp"><div class="ghead" data-group="' + esc(n) + '">' +
        '<span class="caret muted">' + (isOpen ? '&#9662;' : '&#9656;') + '</span>' +
        '<span class="gname">' + esc(list[0].label) + '</span>' +
        '<span class="muted">' + list.length + '</span>' +
        (isOpen
          ? ''
          : '<span class="strip">' +
            list.slice(0, 4).map(function (f) {
              return '<img loading="lazy" src="' + url(f.thumb) + '" alt="">';
            }).join('') +
            '</span>') +
        '</div>';
      if (isOpen) {
        html +=
          '<div class="grid">' +
          list.map(function (f) {
            return (
              '<div class="card" data-i="' + hits.indexOf(f) + '">' +
              '<div class="shot"><img loading="lazy" src="' + url(f.thumb) + '" alt=""></div>' +
              '<div class="cn">' + esc(titleCase(f.c)) + '</div>' +
              '<div class="cs muted">' + (f.n ? f.n + ' fields' : 'form') + '</div></div>'
            );
          }).join('') +
          '</div>';
      }
      html += '</div>';
    });
    box.innerHTML = html;
  }

  // ---- one form, full size ------------------------------------------------
  function open(i) {
    S.box = i;
    var f = S.shown[i];
    if (!f) return;
    var b = document.getElementById('jf-box');
    if (!b) {
      b = document.createElement('div');
      b.id = 'jf-box';
      document.body.appendChild(b);
      b.addEventListener('click', function (e) {
        var a = e.target.closest('[data-act]');
        if (!a) return;
        var act = a.getAttribute('data-act');
        if (act === 'close') close();
        else open(Math.min(S.shown.length - 1, Math.max(0, S.box + (act === 'next' ? 1 : -1))));
      });
    }
    var acts = Object.keys(f.act || {})
      .sort(function (a, c) { return f.act[c] - f.act[a]; })
      .map(function (k) {
        return '<span class="chip">' + esc(ACTION[k] || k) + ' <b>' + f.act[k] + '</b></span>';
      })
      .join('');
    b.innerHTML =
      '<div class="bar"><b>' + esc(titleCase(f.c)) + '</b>' +
      '<span class="muted">' + esc(f.label) + '</span>' +
      '<span class="nav">' +
      '<button data-act="prev"' + (i <= 0 ? ' disabled' : '') + '>&#8249;</button>' +
      '<button data-act="next"' + (i >= S.shown.length - 1 ? ' disabled' : '') + '>&#8250;</button>' +
      '<button data-act="close">close</button></span></div>' +
      '<div class="meta"><div>' + esc(f.t) + '</div>' +
      '<div class="muted" style="margin-top:2px">' +
      (f.loc ? esc(f.loc) + ' &middot; ' : '') + f.n + ' fields &middot; captured ' +
      ago(Date.now() - f.at) + ' ago' + (f.cov ? '' : ' &middot; <span class="warn">capture may be cut off</span>') +
      '</div>' +
      (acts ? '<div class="chips">' + acts + '</div>' : '') +
      '<div style="margin:6px 0 8px">' +
      '<a href="' + url(f.full) + '" target="_blank" rel="noopener">full-resolution PNG</a>' +
      (f.url ? ' &nbsp; <a href="' + esc(f.url) + '" target="_blank" rel="noopener">the live posting</a>' : '') +
      '</div></div>' +
      '<img class="full" src="' + url(f.big) + '" alt="">';
    b.scrollTop = 0;
    b.style.display = 'block';
    document.addEventListener('keydown', keys);
  }
  function close() {
    S.box = -1;
    var b = document.getElementById('jf-box');
    if (b) b.style.display = 'none';
    document.removeEventListener('keydown', keys);
  }
  function keys(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && S.box < S.shown.length - 1) open(S.box + 1);
    else if (e.key === 'ArrowLeft' && S.box > 0) open(S.box - 1);
  }

  // ---- data --------------------------------------------------------------
  function load() {
    if (!ensure()) return;
    fetch(cfg.data, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.forms) return;
        var fresh = !S.data || S.data.at !== d.at;
        if (!fresh) return;
        // The index carries platform names once; each form borrows its label so
        // search and the preview header do not have to look it up.
        var labels = {};
        d.groups.forEach(function (g) { labels[g.name] = g.label; });
        d.forms.forEach(function (f) { f.label = labels[f.g] || f.g; });
        S.data = d;
        groups();
      })
      .catch(function () {});
  }

  window.__jfApp = {
    v: cfg.v,
    tick: function () {
      // Called by the panel bootstrap on every harness re-render: cheap, and the
      // only thing that puts the app back if the panel is ever rebuilt.
      if (!document.getElementById('jf-app')) {
        ensure();
        groups();
      }
    },
    destroy: function () {
      clearInterval(timer);
      var h = document.getElementById('jf-app');
      if (h) h.remove();
      var b = document.getElementById('jf-box');
      if (b) b.remove();
    },
  };

  ensure();
  load();
  timer = setInterval(load, 8000);
})();
