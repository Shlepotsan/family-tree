/* model.js — данные, оценка годов и раскладка по кольцам.
   Ничего про конкретную семью: работает с любой формой family. */
(function (global) {
  'use strict';

  var NOW = new Date().getFullYear();
  var KEY = 'rings-tree-v2';

  // сектор -> [от, до] в градусах (0 = восток, против часовой)
  var SECTORS = {
    father: [95, 178],
    mother: [182, 272],
    partner: [-40, 40],
    other: [286, 314]
  };

  var SECTOR_TITLE = {
    father: 'линия отца',
    mother: 'линия матери',
    partner: 'линия партнёра',
    other: 'вне рода'
  };

  function yearOf(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    if (!s) return null;
    if (/войн/i.test(s)) return 1943;
    var m = s.match(/(1[5-9]\d\d|20[0-4]\d)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function normalize(src) {
    var out = {
      meta: src.meta || {},
      branches: src.branches || {},
      people: [],
      unions: []
    };
    (src.people || []).forEach(function (p, i) {
      out.people.push({
        id: p.id || ('p' + i),
        first: p.first || '',
        middle: p.middle || '',
        last: p.last || '',
        maiden: p.maiden || '',
        sex: p.sex || '',
        branch: p.branch || 'other',
        born: p.born || '',
        died: p.died || '',
        bornPlace: p.bornPlace || '',
        diedPlace: p.diedPlace || '',
        bio: p.bio || '',
        note: p.note || '',
        isSelf: !!p.isSelf,
        lifeFrom: p.lifeFrom != null && p.lifeFrom !== '' ? +p.lifeFrom : null,
        lifeTo: p.lifeTo != null && p.lifeTo !== '' ? +p.lifeTo : null,
        anchor: p.anchor || null
      });
    });
    (src.unions || []).forEach(function (u, i) {
      out.unions.push({
        id: u.id || ('u' + i),
        partners: (u.partners || []).slice(),
        children: (u.children || []).slice(),
        type: u.type || ''
      });
    });
    return out;
  }

  function graph(data) {
    var byId = {}, parents = {}, kids = {}, spouse = {};
    data.people.forEach(function (p) { byId[p.id] = p; });
    data.unions.forEach(function (u) {
      u.partners.forEach(function (a) {
        u.partners.forEach(function (b) { if (a !== b) spouse[a] = b; });
        u.children.forEach(function (c) {
          if (!parents[c]) parents[c] = [];
          if (parents[c].indexOf(a) < 0) parents[c].push(a);
          if (!kids[a]) kids[a] = [];
          if (kids[a].indexOf(c) < 0) kids[a].push(c);
        });
      });
    });
    return { byId: byId, parents: parents, kids: kids, spouse: spouse };
  }

  function median(a) {
    if (!a.length) return null;
    a = a.slice().sort(function (x, y) { return x - y; });
    return a[a.length >> 1];
  }

  /* годы: точные -> от родни -> медиана */
  function years(data, g) {
    data.people.forEach(function (p) {
      p.b = yearOf(p.born);
      p.d = yearOf(p.died);
      p.bKnown = p.b !== null;
      p.dKnown = p.d !== null;
    });

    for (var pass = 0; pass < 8; pass++) {
      var changed = false;
      data.people.forEach(function (p) {
        if (p.b !== null) return;
        var c = [];
        (g.parents[p.id] || []).forEach(function (q) {
          if (g.byId[q] && g.byId[q].b !== null) c.push(g.byId[q].b + 27);
        });
        (g.kids[p.id] || []).forEach(function (q) {
          if (g.byId[q] && g.byId[q].b !== null) c.push(g.byId[q].b - 28);
        });
        if (c.length) {
          var v = median(c);
          if (p.lifeFrom !== null && v < p.lifeFrom) v = p.lifeFrom;
          if (p.lifeTo !== null && v > p.lifeTo) v = p.lifeTo;
          p.b = v;
          changed = true;
        }
      });
      if (!changed) break;
    }

    data.people.forEach(function (p) {
      if (p.b === null && g.spouse[p.id] && g.byId[g.spouse[p.id]].b !== null) {
        p.b = g.byId[g.spouse[p.id]].b + 2;
      }
    });

    var med = median(data.people.filter(function (p) { return p.b !== null; })
      .map(function (p) { return p.b; })) || 1945;

    data.people.forEach(function (p) {
      if (p.b === null) p.b = p.lifeFrom !== null ? p.lifeFrom : med - 10;
      if (p.d === null) {
        p.d = p.lifeTo !== null ? p.lifeTo : (p.b <= NOW - 96 ? p.b + 76 : NOW);
      }
      p.alive = !p.dKnown && p.lifeTo === null && p.d >= NOW;
      p.from = p.lifeFrom !== null ? p.lifeFrom : p.b;
      p.to = p.lifeTo !== null ? p.lifeTo : p.d;
      if (p.from > p.to) { var t = p.from; p.from = p.to; p.to = t; }
    });
    return data;
  }

  function generations(data, g, selfId) {
    var gen = {};
    if (!selfId) return gen;
    gen[selfId] = 0;
    var q = [selfId];
    while (q.length) {
      var id = q.shift();
      (g.parents[id] || []).forEach(function (x) {
        if (gen[x] === undefined) { gen[x] = gen[id] + 1; q.push(x); }
      });
      (g.kids[id] || []).forEach(function (x) {
        if (gen[x] === undefined) { gen[x] = gen[id] - 1; q.push(x); }
      });
    }
    return gen;
  }

  function place(data, g, self, partner, gen) {
    var sectorOf = {};
    function paint(rootId, key) {
      if (!rootId) return;
      var stack = [rootId];
      while (stack.length) {
        var id = stack.pop();
        if (sectorOf[id]) continue;
        sectorOf[id] = key;
        (g.parents[id] || []).forEach(function (x) { stack.push(x); });
        (g.kids[id] || []).forEach(function (x) { stack.push(x); });
      }
    }

    var par = (g.parents[self.id] || []).map(function (id) { return g.byId[id]; }).filter(Boolean);
    var father = par.filter(function (p) { return p.sex === 'm'; })[0] || par[0] || null;
    var mother = par.filter(function (p) { return p.sex === 'f'; })[0] || par[1] || null;

    paint(father && father.id, 'father');
    paint(mother && mother.id, 'mother');
    paint(partner && partner.id, 'partner');

    data.people.forEach(function (p) {
      if (!sectorOf[p.id]) sectorOf[p.id] = 'other';
      p.sector = sectorOf[p.id];
      p.gen = gen[p.id] === undefined ? 99 : gen[p.id];
    });

    var order = Object.keys(data.branches);
    var bi = {};
    order.forEach(function (b, i) { bi[b] = i; });

    ['father', 'mother', 'partner', 'other'].forEach(function (key) {
      var list = data.people.filter(function (p) {
        return p.sector === key && p !== self && p !== partner;
      });
      list.sort(function (a, b) {
        return (b.gen - a.gen) || ((bi[a.branch] || 99) - (bi[b.branch] || 99)) || (a.b - b.b);
      });
      var a0 = SECTORS[key][0], a1 = SECTORS[key][1];
      var step = (a1 - a0) / Math.max(1, list.length);
      list.forEach(function (p, i) { p.ang = a0 + step * (i + 0.5); });
    });

    self.ang = 180;
    if (partner) partner.ang = 0;
    if (self.sector === 'other') self.sector = 'father';
    return data;
  }

  function build(src) {
    var data = normalize(src);
    var g = graph(data);
    var self = data.people.filter(function (p) { return p.isSelf; })[0] || data.people[0];
    if (!self) return { data: data, g: g, self: null, partner: null };
    var partner = g.spouse[self.id] ? g.byId[g.spouse[self.id]] : null;
    years(data, g);
    var gen = generations(data, g, self.id);
    place(data, g, self, partner, gen);

    var oldest = Math.min.apply(null, data.people.map(function (p) { return p.from; }));
    var y0 = Math.max(1780, Math.floor((oldest - 15) / 10) * 10);
    return { data: data, graph: g, self: self, partner: partner, y0: y0, now: NOW };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* приватный режим */ }
    return null;
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ meta: data.meta, branches: data.branches, people: data.people, unions: data.unions }));
      return true;
    } catch (e) { return false; }
  }

  function reset() {
    try { localStorage.removeItem(KEY); } catch (e) { /* */ }
  }

  global.RingsModel = {
    NOW: NOW, KEY: KEY, SECTORS: SECTORS, SECTOR_TITLE: SECTOR_TITLE,
    build: build, normalize: normalize, yearOf: yearOf, load: load, save: save, reset: reset
  };
})(window);
