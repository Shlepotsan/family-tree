/* app.js — кольца: отрисовка, жесты, карточка, форма */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var M = window.RingsModel;
  var R0 = 620;

  var stage = document.getElementById('stage');
  var svg = document.getElementById('tree');
  var sheet = document.getElementById('sheet');
  var sheetBody = document.getElementById('sheet-body');
  var scrim = document.getElementById('scrim');
  var fab = document.getElementById('fab');
  var titleEl = document.getElementById('title');
  var countEl = document.getElementById('count');

  var seed = window.FAMILY ? JSON.parse(JSON.stringify(window.FAMILY))
    : { meta: {}, branches: {}, people: [], unions: [] };
  var data = M.load() || seed;

  var st = {
    built: null, k: 1, tx: 0, ty: 0, sel: null, fit: 1,
    W: 0, H: 0, pts: [], rings: [], years: [], people: [], labels: []
  };

  /* ---------------------------------------------------------------- утилиты */
  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function fullName(p) {
    return [p.first, p.middle, p.last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || 'Без имени';
  }

  function shortName(p) {
    return [p.first, p.last].filter(Boolean).join(' ') || 'Без имени';
  }

  function yearsText(p) {
    if (p.bKnown && p.dKnown) return p.b + ' — ' + p.d;
    if (p.bKnown) return 'род. ' + p.b + (p.alive ? ' · жив(а)' : '');
    return '≈ ' + p.from + ' — ' + p.to;
  }

  /* ---------------------------------------------------------------- построение */
  function rebuild(keepView) {
    st.built = M.build(data);
    st.sel = null;
    draw();
    if (!keepView) fitAll();
    place();
    updateHeader();
  }

  function updateHeader() {
    var n = data.people.length;
    titleEl.textContent = 'Древо рода';
    countEl.innerHTML = n
      ? (n + ' ' + plural(n, 'человек', 'человека', 'человек') + '<span class="dim"> · кольца = 10 лет</span>')
      : 'пока пусто — начните с себя';
    var empty = document.getElementById('empty');
    if (empty) empty.hidden = n > 0;
  }

  function plural(n, a, b, c) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return a;
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return b;
    return c;
  }

  function draw() {
    clear(svg);
    st.rings = []; st.years = []; st.people = []; st.labels = [];

    var B = st.built;
    if (!B || !B.self) return;

    var gRings = el('g', { class: 'rings' });
    var gPeople = el('g', { class: 'people' });
    var gLabels = el('g', { class: 'labels' });
    var gSect = el('g', { class: 'sectors' });
    svg.appendChild(gSect); svg.appendChild(gRings); svg.appendChild(gPeople); svg.appendChild(gLabels);

    // кольца
    for (var y = B.y0; y <= B.now; y += 10) {
      var c = el('circle', { class: 'ring' + (y % 100 === 0 ? ' century' : '') });
      gRings.appendChild(c);
      st.rings.push({ el: c, year: y });

      var t = el('text', { class: 'year' });
      t.textContent = y;
      gRings.appendChild(t);
      st.years.push({ el: t, year: y });
    }

    // сектора
    Object.keys(M.SECTORS).forEach(function (key) {
      var s = M.SECTORS[key];
      if (!B.data.people.some(function (p) { return p.sector === key && p !== B.self && p !== B.partner; })) return;
      [s[0], s[1]].forEach(function (a) {
        var l = el('line', { class: 'sector-line' });
        gSect.appendChild(l);
        l.dataset.ang = a;
      });
    });

    // люди
    B.data.people.forEach(function (p) {
      var g = el('g', { class: 'p' });
      g.dataset.id = p.id;
      var band = el('line', { class: 'band' });
      var dot = el('circle', { class: 'dot' + (p.bKnown ? ' known' : ' est') });
      var hit = el('circle', { class: 'hit', r: 18 });
      g.appendChild(band); g.appendChild(dot); g.appendChild(hit);
      gPeople.appendChild(g);
      st.people.push({ g: g, band: band, dot: dot, p: p });

      var lab = el('text', { class: 'lbl' });
      lab.textContent = shortName(p);
      gLabels.appendChild(lab);
      st.labels.push({ el: lab, p: p });
    });

    applyColors();
  }

  function color(p) {
    if (p === st.built.self || p === st.built.partner) return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8a3f2a';
    var b = data.branches[p.branch];
    return b && b.color ? b.color : '#7a7466';
  }

  function applyColors() {
    st.people.forEach(function (it) {
      var c = color(it.p);
      it.band.setAttribute('stroke', c);
      if (it.p.bKnown) it.dot.setAttribute('fill', c);
      else { it.dot.setAttribute('fill', 'none'); it.dot.setAttribute('stroke', c); }
    });
  }

  /* ---------------------------------------------------------------- позиции */
  function view() {
    var B = st.built;
    var kw = st.k, cx = st.W / 2 + st.tx, cy = st.H / 2 + st.ty;
    return {
      cx: cx, cy: cy,
      R: function (year) { return R0 * kw * (B.now - year) / (B.now - B.y0); },
      xy: function (r, ang) {
        var a = ang * Math.PI / 180;
        return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
      }
    };
  }

  function place() {
    var B = st.built;
    if (!B || !B.self) return;
    var v = view();
    var k = st.k;

    st.rings.forEach(function (it) {
      var r = v.R(it.year);
      it.el.setAttribute('cx', v.cx); it.el.setAttribute('cy', v.cy);
      it.el.setAttribute('r', Math.max(0, r));
      it.el.style.display = r > 3 ? '' : 'none';
    });

    var per10 = R0 * k * 10 / (B.now - B.y0);
    var step = per10 > 15 ? 10 : per10 > 8 ? 20 : 50;
    st.years.forEach(function (it) {
      var r = v.R(it.year);
      var q = v.xy(r, 66);
      it.el.setAttribute('x', q[0]); it.el.setAttribute('y', q[1]);
      it.el.style.display = (it.year % step === 0 && r > 80 && r < R0 * k * 1.02) ? '' : 'none';
    });

    var lines = svg.querySelectorAll('.sector-line');
    for (var i = 0; i < lines.length; i++) {
      var a = +lines[i].dataset.ang;
      var p0 = v.xy(34 * k, a), p1 = v.xy(R0 * k * 0.985, a);
      lines[i].setAttribute('x1', p0[0]); lines[i].setAttribute('y1', p0[1]);
      lines[i].setAttribute('x2', p1[0]); lines[i].setAttribute('y2', p1[1]);
    }

    st.pts = [];
    st.people.forEach(function (it) {
      var p = it.p;
      var rFrom = v.R(p.from), rTo = v.R(p.to), rBirth = v.R(p.b);
      var a = v.xy(rFrom, p.ang), b = v.xy(rTo, p.ang);
      it.band.setAttribute('x1', a[0]); it.band.setAttribute('y1', a[1]);
      it.band.setAttribute('x2', b[0]); it.band.setAttribute('y2', b[1]);
      it.band.style.display = Math.abs(rFrom - rTo) > 2 ? '' : 'none';

      it.dot.setAttribute('cx', a[0]); it.dot.setAttribute('cy', a[1]); it.dot.setAttribute('r', 5.2);
      it.dot.style.display = rFrom > 2 ? '' : 'none';
      var hit = it.g.querySelector('.hit');
      hit.setAttribute('cx', a[0]); hit.setAttribute('cy', a[1]);
      st.pts.push({ id: p.id, x: a[0], y: a[1], r: 14 });
    });

    var level = st.k > st.fit * 4 ? 99 : st.k > st.fit * 2.4 ? 3 : st.k > st.fit * 1.45 ? 2 : 2;
    st.labels.forEach(function (it) { it.el.style.display = 'none'; });
    var boxes = [];
    st.labels.slice()
      .sort(function (a, b) {
        var sa = a.p.id === st.sel ? -1 : a.p.gen;
        var sb = b.p.id === st.sel ? -1 : b.p.gen;
        return sa - sb;
      })
      .forEach(function (it) {
        var p = it.p;
        if (p.gen > level && p.id !== st.sel) return;
        var r = v.R(p.from);
        if (r < 24) return;
        var cosv = Math.cos(p.ang * Math.PI / 180);
        var w = shortName(p).length * 6.6;
        var placed = false;
        [12, 26, 40, 54].forEach(function (off) {
          if (placed) return;
          var q = v.xy(r + off, p.ang);
          var x0 = cosv < 0 ? q[0] - w - 5 : q[0] + 5;
          if (x0 < 6 || x0 + w > st.W - 6 || q[1] < 30 || q[1] > st.H - 10) return;
          var box = [x0, q[1] - 9, x0 + w, q[1] + 9];
          for (var i = 0; i < boxes.length; i++) {
            var a = boxes[i];
            if (!(box[2] < a[0] - 2 || box[0] > a[2] + 2 || box[3] < a[1] - 2 || box[1] > a[3] + 2)) return;
          }
          boxes.push(box);
          placed = true;
          it.el.style.display = '';
          it.el.setAttribute('x', cosv < 0 ? q[0] - 5 : q[0] + 5);
          it.el.setAttribute('y', q[1]);
          it.el.setAttribute('text-anchor', cosv < 0 ? 'end' : 'start');
        });
      });

    highlight();
  }

  function highlight() {
    st.people.forEach(function (it) {
      var on = it.p.id === st.sel;
      it.g.classList.toggle('sel', on);
      it.dot.setAttribute('r', on ? 7.4 : 5.2);
      it.band.setAttribute('stroke-width', on ? 3.4 : 1.7);
    });
    st.labels.forEach(function (it) {
      it.el.classList.toggle('sel', it.p.id === st.sel);
    });
  }

  /* ---------------------------------------------------------------- жесты */
  function resize() {
    var r = stage.getBoundingClientRect();
    st.W = Math.round(r.width); st.H = Math.round(r.height);
    svg.setAttribute('width', st.W); svg.setAttribute('height', st.H);
    if (!st.fitted) fitAll();
    place();
  }

  function fitAll() {
    var m = Math.min(st.W, st.H);
    if (!m) return;
    var B = st.built;
    if (B && B.data.people.length) {
      var sx = 0, sy = 0, n = 0;
      B.data.people.forEach(function (p) {
        var r = R0 * (B.now - p.b) / (B.now - B.y0);
        var a = p.ang * Math.PI / 180;
        sx += r * Math.cos(a); sy -= r * Math.sin(a); n++;
      });
      var cxw = sx / n, cyw = sy / n, far = 0;
      B.data.people.forEach(function (p) {
        var r = R0 * (B.now - p.b) / (B.now - B.y0);
        var a = p.ang * Math.PI / 180;
        var d = Math.hypot(r * Math.cos(a) - cxw, -r * Math.sin(a) - cyw);
        if (d > far) far = d;
      });
      st.fit = Math.min(st.W * 0.55, st.H * 0.44) / Math.max(far + 20, 130);
      st.k = st.fit;
      st.tx = -cxw * st.k * 0.5;
      st.ty = -cyw * st.k * 0.5;
    } else {
      st.fit = (m / 2) * 0.86 / R0;
      st.k = st.fit;
      st.tx = 0; st.ty = 0;
    }
    st.fitted = true;
    place();
  }

  function zoomAt(sx, sy, factor) {
    var k2 = clamp(st.k * factor, st.fit * 0.75, st.fit * 12);
    var wx = (sx - st.W / 2 - st.tx) / st.k;
    var wy = (sy - st.H / 2 - st.ty) / st.k;
    st.k = k2;
    st.tx = sx - st.W / 2 - k2 * wx;
    st.ty = sy - st.H / 2 - k2 * wy;
    place();
  }

  var pointers = new Map();
  var pan = null, pinch = null, tap = null;

  function locals(e) {
    var r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  svg.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      pan = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty, moved: 0 };
      tap = { t: Date.now(), x: e.clientX, y: e.clientY };
      pinch = null;
    } else if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinch = {
        d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        mx0: (pts[0].x + pts[1].x) / 2, my0: (pts[0].y + pts[1].y) / 2,
        k0: st.k, tx0: st.tx, ty0: st.ty
      };
      pan = null; tap = null;
    }
  });

  svg.addEventListener('pointermove', function (e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (d < 8 || pinch.d0 < 8) return;
      var k2 = clamp(pinch.k0 * d / pinch.d0, st.fit * 0.75, st.fit * 12);
      var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      var wx = (pinch.mx0 - st.W / 2 - pinch.tx0) / pinch.k0;
      var wy = (pinch.my0 - st.H / 2 - pinch.ty0) / pinch.k0;
      st.k = k2;
      st.tx = mx - st.W / 2 - k2 * wx;
      st.ty = my - st.H / 2 - k2 * wy;
      place();
      return;
    }

    if (pan) {
      var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) pan.moved = 1;
      st.tx = pan.tx + dx;
      st.ty = pan.ty + dy;
      place();
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pan && pointers.size === 0) {
      if (!pan.moved && tap && Date.now() - tap.t < 700) {
        var q = locals(e);
        pick(q.x, q.y);
      }
      pan = null;
    }
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 1 && !pan) {
      var p1 = Array.from(pointers.values())[0];
      pan = { x: p1.x, y: p1.y, tx: st.tx, ty: st.ty, moved: 1 };
    }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var q = locals(e);
    zoomAt(q.x, q.y, Math.exp(-e.deltaY * 0.0016));
  }, { passive: false });

  function pick(x, y) {
    var best = null, bd = 1e9;
    st.pts.forEach(function (pt) {
      var d = Math.hypot(pt.x - x, pt.y - y);
      if (d < pt.r + 10 && d < bd) { bd = d; best = pt.id; }
    });
    if (best) openCard(best); else closeSheet();
  }

  /* ---------------------------------------------------------------- карточка */
  function openCard(id) {
    var B = st.built;
    var p = B.data.people.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    st.sel = id;
    highlight();

    var g = B.graph;
    var par = (g.parents[id] || []).map(function (x) { return g.byId[x]; }).filter(Boolean);
    var ch = (g.kids[id] || []).map(function (x) { return g.byId[x]; }).filter(Boolean);
    var sp = g.spouse[id] ? g.byId[g.spouse[id]] : null;

    var rel = [];
    if (par.length) rel.push('<div class="rel"><span>родители</span>' + par.map(chip).join('') + '</div>');
    if (sp) rel.push('<div class="rel"><span>пара</span>' + chip(sp) + '</div>');
    if (ch.length) rel.push('<div class="rel"><span>дети</span>' + ch.map(chip).join('') + '</div>');

    var meta = yearsText(p) + ' · ' + (M.SECTOR_TITLE[p.sector] || '');
    if (!p.bKnown || !p.dKnown) meta += ' · посчитано';

    sheetBody.innerHTML =
      '<div class="card">' +
      '<div class="card-top"><div><h2>' + esc(fullName(p)) + '</h2>' +
      '<div class="card-meta">' + esc(meta) + '</div></div>' +
      '<button class="x" data-close aria-label="Закрыть">×</button></div>' +
      (p.bio ? '<p class="card-bio">' + esc(p.bio) + '</p>' : '') +
      (rel.length ? '<div class="rels">' + rel.join('') + '</div>' : '') +
      '<div class="card-actions">' +
      '<button class="btn ghost" data-act="edit">Изменить</button>' +
      '<button class="btn ghost" data-act="add">Добавить родню</button>' +
      '<button class="btn ghost danger" data-act="del">Удалить</button>' +
      '</div></div>';

    openSheet();

    sheetBody.querySelector('[data-close]').onclick = closeSheet;
    sheetBody.querySelectorAll('.chip').forEach(function (c) {
      c.onclick = function () { openCard(c.dataset.id); };
    });
    sheetBody.querySelector('[data-act="edit"]').onclick = function () { openForm(p); };
    sheetBody.querySelector('[data-act="add"]').onclick = function () { openForm(null, p); };
    sheetBody.querySelector('[data-act="del"]').onclick = function () { removePerson(p); };
  }

  function chip(p) {
    return '<button class="chip" data-id="' + p.id + '">' + esc(shortName(p)) + '</button>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------------------------------------------------------- форма */
  function openForm(edit, anchor) {
    var B = st.built;
    var opts = B.data.people.slice().sort(function (a, b) { return a.b - b.b; })
      .map(function (p) {
        return '<option value="' + p.id + '"' + (anchor && anchor.id === p.id ? ' selected' : '') + '>' +
          esc(shortName(p)) + ' · ' + p.b + '</option>';
      }).join('');

    var isEdit = !!edit;
    sheetBody.innerHTML =
      '<form class="form" id="pform">' +
      '<div class="card-top"><h2>' + (isEdit ? 'Изменить' : 'Новый человек') + '</h2>' +
      '<button type="button" class="x" data-close aria-label="Закрыть">×</button></div>' +
      '<div class="row2"><label class="field"><span>Имя</span>' +
      '<input name="first" value="' + esc(edit ? edit.first : '') + '" placeholder="Анна" required></label>' +
      '<label class="field"><span>Фамилия</span>' +
      '<input name="last" value="' + esc(edit ? edit.last : '') + '" placeholder="Иванова"></label></div>' +
      '<div class="field"><span>Годы жизни <b>обязательно</b></span><div class="row2">' +
      '<label class="sub"><span>от</span><input name="from" type="number" inputmode="numeric" min="1500" max="2100" ' +
      'value="' + (edit ? edit.from : 1900) + '" required></label>' +
      '<label class="sub"><span>до</span><input name="to" type="number" inputmode="numeric" min="1500" max="2100" ' +
      'value="' + (edit ? edit.to : 1980) + '" required></label>' +
      '</div><div class="hint">можно примерно: крайние годы, между которыми жил человек</div></div>' +
      (isEdit ? '' :
        '<div class="field"><span>Ориентир <i>не обязательно</i></span><select name="anchor">' +
        '<option value="">— сам по себе —</option>' + opts + '</select></div>' +
        '<div class="field"><span>Кем приходится</span><select name="rel">' +
        '<option value="child">ребёнок этого человека</option>' +
        '<option value="parent">родитель этого человека</option>' +
        '<option value="spouse">пара этого человека</option>' +
        '<option value="near">просто рядом</option></select></div>') +
      '<button class="btn primary" type="submit">' + (isEdit ? 'Сохранить' : 'Добавить') + '</button>' +
      '</form>';

    openSheet();
    var f = document.getElementById('pform');
    sheetBody.querySelector('[data-close]').onclick = closeSheet;
    f.onsubmit = function (e) {
      e.preventDefault();
      var fd = new FormData(f);
      var from = parseInt(fd.get('from'), 10);
      var to = parseInt(fd.get('to'), 10);
      if (!(from <= to)) { alert('«от» должно быть не позже «до»'); return; }

      if (isEdit) {
        edit.first = fd.get('first');
        edit.last = fd.get('last');
        edit.lifeFrom = from;
        edit.lifeTo = to;
        edit.born = String(from);
        edit.died = String(to);
      } else {
        addPerson(fd.get('first'), fd.get('last'), from, to, fd.get('anchor'), fd.get('rel'));
      }
      M.save(data);
      rebuild(true);
      place();
      closeSheet();
    };
  }

  function addPerson(first, last, from, to, anchorId, rel) {
    var B = st.built;
    var id = 'p' + Date.now().toString(36);
    var anchor = anchorId ? B.data.people.filter(function (p) { return p.id === anchorId; })[0] : null;
    var person = {
      id: id, first: first || '', middle: '', last: last || '', sex: '',
      branch: anchor ? anchor.branch : 'other',
      born: String(from), died: String(to),
      lifeFrom: from, lifeTo: to, bio: '', note: '',
      anchor: anchor ? { id: anchor.id, rel: rel } : null
    };
    data.people.push(person);

    if (anchor) {
      if (rel === 'child') {
        var u = data.unions.filter(function (x) { return x.partners.indexOf(anchor.id) >= 0; })[0];
        if (u) u.children.push(id);
        else data.unions.push({ id: 'u' + id, partners: [anchor.id], children: [id], type: 'single' });
      } else if (rel === 'parent') {
        data.unions.push({ id: 'u' + id, partners: [id], children: [anchor.id], type: 'single' });
      } else if (rel === 'spouse') {
        var u2 = data.unions.filter(function (x) {
          return x.partners.indexOf(anchor.id) >= 0 && x.partners.length < 2;
        })[0];
        if (u2) u2.partners.push(id);
        else data.unions.push({ id: 'u' + id, partners: [anchor.id, id], children: [] });
      }
    }
    st.sel = id;
    return person;
  }

  function removePerson(p) {
    if (!confirm('Удалить «' + fullName(p) + '»?')) return;
    data.people = data.people.filter(function (x) { return x.id !== p.id; });
    data.unions.forEach(function (u) {
      u.partners = u.partners.filter(function (x) { return x !== p.id; });
      u.children = u.children.filter(function (x) { return x !== p.id; });
    });
    data.unions = data.unions.filter(function (u) { return u.partners.length || u.children.length; });
    M.save(data);
    st.sel = null;
    closeSheet();
    rebuild(true);
  }

  /* ---------------------------------------------------------------- шторка */
  function openSheet() {
    scrim.hidden = false;
    sheet.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('open'); scrim.classList.add('on'); });
  }

  function closeSheet() {
    sheet.classList.remove('open');
    scrim.classList.remove('on');
    st.sel = null;
    highlight();
    setTimeout(function () { sheet.hidden = true; scrim.hidden = true; }, 220);
  }

  scrim.onclick = closeSheet;
  fab.onclick = function () { openForm(null, st.built && st.built.self); };

  document.getElementById('btn-fit').onclick = fitAll;
  document.getElementById('btn-in').onclick = function () { zoomAt(st.W / 2, st.H / 2, 1.35); };
  document.getElementById('btn-out').onclick = function () { zoomAt(st.W / 2, st.H / 2, 1 / 1.35); };

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 250); });

  /* ---------------------------------------------------------------- старт */
  resize();
  rebuild(false);
  resize();

  function fromHash() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (h.indexOf('p=') === 0) openCard(h.slice(2));
    else if (h === 'new') openForm(null, st.built && st.built.self);
  }
  setTimeout(fromHash, 80);
})();
