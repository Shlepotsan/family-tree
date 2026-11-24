/* layout.js — только геометрия.
   Вход: window.FAMILY. Выход: координаты карточек и линий связи.

   Как считается:
   1. персоны объединяются в «группы» (пара, а у кого два брака — трое);
   2. группа получает поколение по самому длинному пути от старших;
   3. группы укладываются как обычное дерево: дети — под родителями,
      ширина поддерева считается заранее, поэтому ничего не наезжает;
   4. пара, у которой родители есть с двух сторон (Шлёповы + Володины),
      встаёт под той линией, что идёт первой, — вторая линия просто
      подходит к ней сбоку. Так дерево остаётся деревом, а не клубком.

   Проверка без браузера:
     node -e "global.window=global;require('./data.js');require('./layout.js');
              console.log(window.FamilyLayout.compute(window.FAMILY).width)"   */

(function (global) {
  'use strict';

  var CARD_W = 182;      // ширина карточки персоны
  var CARD_H = 106;      // высота карточки (с полосой родства сверху)
  var CARD_GAP = 20;     // между супругами в одной группе
  var CLUSTER_GAP = 44;  // между соседними группами
  var LAYER_GAP = 120;   // между поколениями
  var PAD = 170;         // поля холста

  function compute(family) {
    var people = family.people;
    var unions = family.unions;

    var byId = new Map();
    people.forEach(function (p) { byId.set(p.id, p); });

    var unionsOf = new Map();
    people.forEach(function (p) { unionsOf.set(p.id, []); });
    unions.forEach(function (u) {
      u.partners.forEach(function (id) {
        if (unionsOf.has(id)) unionsOf.get(id).push(u);
      });
    });

    /* ---------- группы ---------- */

    var clusterOf = new Map();
    var clusters = [];

    people.forEach(function (p, i) {
      if (clusterOf.has(p.id)) return;

      var spouses = [];
      unionsOf.get(p.id).forEach(function (u) {
        u.partners.forEach(function (id) {
          if (id === p.id || clusterOf.has(id)) return;
          if (spouses.some(function (s) { return s.id === id; })) return;
          var sp = byId.get(id);
          if (sp) spouses.push(sp);
        });
      });

      var members;
      if (spouses.length === 2 && spouses.every(function (s) { return s.sex !== p.sex; })) {
        members = [spouses[0].id, p.id, spouses[1].id];   // двое браков — персона в центре
      } else {
        members = [p.id].concat(spouses.map(function (s) { return s.id; }));
      }

      var c = {
        id: 'c' + clusters.length,
        members: members,
        width: members.length * CARD_W + (members.length - 1) * CARD_GAP,
        x: 0,
        layer: 0,
        ord: i
      };
      members.forEach(function (id) { clusterOf.set(id, c); });
      clusters.push(c);
    });

    /* ---------- родители ---------- */

    var parentUnions = new Map();
    people.forEach(function (p) { parentUnions.set(p.id, []); });
    unions.forEach(function (u) {
      u.children.forEach(function (id) {
        if (parentUnions.has(id)) parentUnions.get(id).push(u);
      });
    });

    function ownUnions(cluster) {
      var out = [];
      cluster.members.forEach(function (id) {
        unionsOf.get(id).forEach(function (u) {
          var belongs = u.partners.some(function (pid) { return cluster.members.indexOf(pid) !== -1; });
          if (belongs && out.indexOf(u) === -1) out.push(u);
        });
      });
      return out;
    }

    function parentClusters(personId) {
      var out = [];
      parentUnions.get(personId).forEach(function (u) {
        var pc = clusterOf.get(u.partners[0]);
        if (pc && out.indexOf(pc) === -1) out.push(pc);
      });
      return out;
    }

    /* ---------- поколения ---------- */

    var guard = 0;
    var changed = true;
    while (changed && guard++ < 60) {
      changed = false;
      clusters.forEach(function (c) {
        c.members.forEach(function (id) {
          parentClusters(id).forEach(function (pc) {
            if (pc !== c && pc.layer + 1 > c.layer) {
              c.layer = pc.layer + 1;
              changed = true;
            }
          });
        });
      });
    }

    // у кого родителей нет, но дети есть — поднимаем к детям, иначе линия
    // уходит через полдерева и прячется за чужими карточками
    var pullGuard = 0;
    var pulled = true;
    while (pulled && pullGuard++ < 40) {
      pulled = false;
      clusters.forEach(function (c) {
        var hasParents = false;
        c.members.forEach(function (id) {
          if (parentClusters(id).some(function (pc) { return pc !== c; })) hasParents = true;
        });
        if (hasParents) return;
        var kids = [];
        c.members.forEach(function (id) {
          unionsOf.get(id).forEach(function (u) {
            if (u.partners.indexOf(id) === -1) return;
            (u.children || []).forEach(function (cid) {
              var kc = clusterOf.get(cid);
              if (kc && kc !== c && kids.indexOf(kc) === -1) kids.push(kc);
            });
          });
        });
        if (!kids.length) return;
        var want = Math.min.apply(null, kids.map(function (k) { return k.layer; })) - 1;
        if (want > c.layer) { c.layer = want; pulled = true; }
      });
      if (pulled) {
        clusters.forEach(function (c) {
          c.members.forEach(function (id) {
            parentClusters(id).forEach(function (pc) {
              if (pc !== c && pc.layer + 1 > c.layer) c.layer = pc.layer + 1;
            });
          });
        });
      }
    }

    var layerCount = 0;
    clusters.forEach(function (c) { layerCount = Math.max(layerCount, c.layer + 1); });
    var layers = [];
    for (var i = 0; i < layerCount; i++) layers.push([]);
    clusters.forEach(function (c) { layers[c.layer].push(c); });

    /* ---------- дерево: один основной родитель ---------- */

    var primary = new Map();
    var kidsOf = new Map();
    clusters.forEach(function (c) { kidsOf.set(c, []); });

    clusters.forEach(function (c) {
      var ps = [];
      c.members.forEach(function (id) {
        parentClusters(id).forEach(function (pc) {
          if (pc !== c && ps.indexOf(pc) === -1) ps.push(pc);
        });
      });
      if (!ps.length) return;
      primary.set(c, ps[0]);
      kidsOf.get(ps[0]).push(c);
    });

    kidsOf.forEach(function (list) { list.sort(function (a, b) { return a.ord - b.ord; }); });

    /* ---------- укладка ---------- */

    var widths = new Map();
    function subtreeWidth(c) {
      if (widths.has(c)) return widths.get(c);
      var kids = kidsOf.get(c);
      var w = c.width;
      if (kids.length) {
        var total = 0;
        kids.forEach(function (k, i) { total += subtreeWidth(k) + (i ? CLUSTER_GAP : 0); });
        w = Math.max(w, total);
      }
      widths.set(c, w);
      return w;
    }

    function place(c, left) {
      var w = subtreeWidth(c);
      var kids = kidsOf.get(c);
      if (kids.length) {
        var total = 0;
        kids.forEach(function (k, i) { total += subtreeWidth(k) + (i ? CLUSTER_GAP : 0); });
        var x = left + (w - total) / 2;
        kids.forEach(function (k, i) {
          place(k, x);
          x += subtreeWidth(k) + (i + 1 < kids.length ? CLUSTER_GAP : 0);
        });
      }
      c.x = left + (w - c.width) / 2;
    }

    var roots = clusters.filter(function (c) { return !primary.has(c); })
      .sort(function (a, b) { return a.ord - b.ord; });

    var cursor = 0;
    roots.forEach(function (c) {
      place(c, cursor);
      cursor += subtreeWidth(c) + CLUSTER_GAP;
    });

    /* ---------- стороны: его / её / центр ---------- */

    // Центральная пара — «я» (isSelf) и супруг(а).
    var selfPerson = people.filter(function (p) { return p.isSelf; })[0] || null;
    var selfCluster = selfPerson ? clusterOf.get(selfPerson.id) : null;
    var spouseClusterMember = null;
    if (selfPerson) {
      unionsOf.get(selfPerson.id).forEach(function (u) {
        u.partners.forEach(function (id) {
          if (id !== selfPerson.id && clusterOf.get(id) === selfCluster) spouseClusterMember = id;
        });
      });
    }

    var parentIdsOf = function (id) {
      var out = [];
      (parentUnions.get(id) || []).forEach(function (u) {
        u.partners.forEach(function (pid) { if (pid !== id && out.indexOf(pid) === -1) out.push(pid); });
      });
      return out;
    };
    var kidIdsOf = function (id) {
      var out = [];
      unionsOf.get(id).forEach(function (u) {
        (u.children || []).forEach(function (cid) { if (cid !== id && out.indexOf(cid) === -1) out.push(cid); });
      });
      return out;
    };
    var spouseIdsOf = function (id) {
      var out = [];
      unionsOf.get(id).forEach(function (u) {
        u.partners.forEach(function (pid) { if (pid !== id && out.indexOf(pid) === -1) out.push(pid); });
      });
      return out;
    };
    function reach(startId, blockedId) {
      var seen = {}, queue = [startId];
      seen[startId] = true;
      while (queue.length) {
        var id = queue.shift();
        parentIdsOf(id).concat(kidIdsOf(id)).concat(spouseIdsOf(id)).forEach(function (nid) {
          if (!nid || nid === blockedId || seen[nid] || !clusterOf.has(nid)) return;
          seen[nid] = true;
          queue.push(nid);
        });
      }
      return seen;
    }

    var mineSet = selfPerson ? reach(selfPerson.id, spouseClusterMember) : {};
    var herSet = spouseClusterMember ? reach(spouseClusterMember, selfPerson.id) : {};

    clusters.forEach(function (c) {
      var inMine = false, inHers = false;
      c.members.forEach(function (id) {
        if (mineSet[id]) inMine = true;
        if (herSet[id]) inHers = true;
      });
      c.side = (inMine && inHers) ? 0 : (inHers ? 1 : (inMine ? -1 : -1));
    });
    if (selfCluster) selfCluster.side = 0;

    /* ---------- зе зеркалим к центру: его — слева, её — справа ---------- */

    var axis = selfCluster ? selfCluster.x + selfCluster.width / 2 : 0;

    clusters.forEach(function (c) {
      if (c.side === 1) c.x = 2 * axis - (c.x + c.width);
    });

    // укладка по сторонам: слева — до оси, справа — после, центр — на оси
    var SIDE_GAP = 90;
    layers.forEach(function (layer) {
      layer.sort(function (a, b) { return a.x - b.x; });
      var mid = layer.filter(function (c) { return c.side === 0; });
      var left = layer.filter(function (c) { return c.side === -1; });
      var right = layer.filter(function (c) { return c.side === 1; });

      // центр: пакуем вокруг оси и запоминаем его фактические границы
      var midTotal = 0;
      mid.forEach(function (c, i) { midTotal += c.width + (i ? CLUSTER_GAP : 0); });
      var midLeft = midTotal ? axis - midTotal / 2 : axis;
      var cursorMid = midLeft;
      mid.forEach(function (c) { c.x = cursorMid; cursorMid += c.width + CLUSTER_GAP; });
      var midRight = midTotal ? midLeft + midTotal : axis;

      // его сторона: пакуем справа налево, последняя упирается в центр
      var cursorLeft = midLeft - SIDE_GAP;
      for (var i = left.length - 1; i >= 0; i--) {
        var c = left[i];
        c.x = cursorLeft - c.width;
        cursorLeft = c.x - CLUSTER_GAP;
      }

      // её сторона: слева направо, первая отходит от центра
      var cursorRight = midRight + SIDE_GAP;
      right.forEach(function (c) {
        c.x = cursorRight;
        cursorRight = c.x + c.width + CLUSTER_GAP;
      });
    });

    // внутри стороны — без наложений, но не сдвигая центр
    function separateSide(layer, side) {
      var list = layer.filter(function (c) { return c.side === side; })
        .sort(function (a, b) { return a.x - b.x; });
      for (var i = 1; i < list.length; i++) {
        var min = list[i - 1].x + list[i - 1].width + CLUSTER_GAP;
        if (list[i].x < min) list[i].x = min;
      }
    }
    layers.forEach(function (layer) {
      separateSide(layer, -1);
      separateSide(layer, 1);
    });

    var minX = Infinity;
    clusters.forEach(function (c) { minX = Math.min(minX, c.x); });
    clusters.forEach(function (c) { c.x = c.x - minX + PAD; });

    var layerY = function (n) { return PAD + n * (CARD_H + LAYER_GAP); };

    /* ---------- карточки ---------- */

    var cards = [];
    clusters.forEach(function (c) {
      c.members.forEach(function (id, idx) {
        var p = byId.get(id);
        if (!p) return;
        cards.push({
          id: id,
          person: p,
          x: c.x + idx * (CARD_W + CARD_GAP),
          y: layerY(c.layer),
          w: CARD_W,
          h: CARD_H,
          layer: c.layer
        });
      });
    });

    /* ---------- линии ---------- */

    var cardCentre = function (c, id) {
      var idx = c.members.indexOf(id);
      return c.x + (idx < 0 ? 0 : idx) * (CARD_W + CARD_GAP) + CARD_W / 2;
    };

/* Новый блок линий: коридоры вокруг карточек, шины по своим высотам, разрывы на пересечениях. */

    var marriages = [];
    var drops = [];

    // занят ли вертикальный отрезок карточками
    function xFree(x, yTop, yBot) {
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        if (c.y < yBot - 1 && c.y + c.h > yTop + 1 && x > c.x + 2 && x < c.x + c.w - 2) return false;
      }
      return true;
    }

    // свободный коридор рядом с карточкой ребёнка
    function corridorFor(cardX, cardW, yTop, yBot) {
      var candidates = [
        cardX - cardW / 2 - 12,
        cardX + cardW / 2 + 12,
        cardX - cardW / 2 - 12 - CARD_W - CARD_GAP,
        cardX + cardW / 2 + 12 + CARD_W + CARD_GAP
      ];
      for (var i = 0; i < candidates.length; i++) {
        if (xFree(candidates[i], yTop, yBot)) return candidates[i];
      }
      return cardX;
    }

    unions.forEach(function (u) {
      var ca = clusterOf.get(u.partners[0]);
      if (!ca) return;
      var cb = u.partners[1] ? clusterOf.get(u.partners[1]) : null;

      var ax = cardCentre(ca, u.partners[0]);
      var ay = layerY(ca.layer) + CARD_H / 2;

      if (cb) {
        marriages.push({
          id: u.id,
          a: u.partners[0],
          b: u.partners[1],
          x1: ax, y1: ay,
          x2: cardCentre(cb, u.partners[1]), y2: layerY(cb.layer) + CARD_H / 2,
          type: u.type || 'marriage'
        });
      }

      var kids = u.children
        .map(function (id) { return { id: id, cluster: clusterOf.get(id) }; })
        .filter(function (k) { return k.cluster; });
      if (!kids.length) return;

      var baseY = layerY(ca.layer) + CARD_H;
      var childTop = Math.min.apply(null, kids.map(function (k) { return layerY(k.cluster.layer); }));

      // своя высота шины для каждой семьи, чтобы горизонтали не сливались
      var lane = (drops.length % 4) * 7;
      var busY = Math.max(baseY + 20, Math.min(childTop - 16, baseY + 24 + lane));

      var dropX = cb ? (ax + cardCentre(cb, u.partners[1])) / 2 : ax;
      var stems = [];
      var xs = [dropX];

      kids.forEach(function (k) {
        var idx = k.cluster.members.indexOf(k.id);
        var cardX = k.cluster.x + (idx < 0 ? 0 : idx) * (CARD_W + CARD_GAP) + CARD_W / 2;
        var top = layerY(k.cluster.layer);
        var span = k.cluster.layer - ca.layer;

        if (span > 1) {
          // длинная связь: уходим в свободный коридор и спускаемся по нему
          var corr = corridorFor(cardX, CARD_W, busY, top);
          stems.push({
            child: k.id,
            points: [[corr, busY], [corr, top - 14], [cardX, top - 14], [cardX, top]]
          });
          xs.push(corr);
        } else {
          stems.push({ child: k.id, points: [[cardX, busY], [cardX, top]] });
          xs.push(cardX);
        }
      });

      var left = Math.min.apply(null, xs);
      var right = Math.max.apply(null, xs);

      drops.push({
        id: u.id,
        partners: u.partners.slice(),
        children: kids.map(function (k) { return k.id; }),
        trunk: { x: dropX, y1: baseY, y2: busY },
        bus: (Math.abs(right - left) < 1) ? null : { x1: left, x2: right, y: busY },
        stems: stems
      });
    });

    /* разрывы в шинах там, где их пересекают чужие вертикали:
       так видно, что линии не соединяются */
    var verticals = [];
    drops.forEach(function (d) {
      verticals.push({ u: d.id, x: d.trunk.x, y1: d.trunk.y1, y2: d.trunk.y2 });
      d.stems.forEach(function (s) {
        for (var i = 0; i < s.points.length - 1; i++) {
          var a = s.points[i], b = s.points[i + 1];
          if (Math.abs(a[0] - b[0]) < 0.5) {
            verticals.push({ u: d.id + '|' + s.child, x: a[0], y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]) });
          }
        }
      });
    });

    var GAP = 6;
    drops.forEach(function (d) {
      if (!d.bus) return;
      var cuts = [];
      verticals.forEach(function (v) {
        if (v.u === d.id) return;
        if (v.x <= d.bus.x1 + 1 || v.x >= d.bus.x2 - 1) return;
        if (v.y1 < d.bus.y - 1 && v.y2 > d.bus.y + 1) cuts.push(v.x);
      });
      cuts.sort(function (a, b) { return a - b; });
      var segs = [];
      var from = d.bus.x1;
      cuts.forEach(function (x) {
        if (x - GAP > from + 1) segs.push({ x1: from, x2: x - GAP });
        from = Math.max(from, x + GAP);
      });
      if (d.bus.x2 > from + 1) segs.push({ x1: from, x2: d.bus.x2 });
      d.busSegs = segs.map(function (s) { return { x1: s.x1, x2: s.x2, y: d.bus.y }; });
    });

    var maxX = 0, maxY = 0;
    cards.forEach(function (c) {
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h);
    });

    return {
      cards: cards,
      marriages: marriages,
      drops: drops,
      width: maxX + PAD,
      height: maxY + PAD,
      layers: layers.map(function (layer, i) {
        return { index: i, y: layerY(i), count: layer.length };
      }),
      metrics: { CARD_W: CARD_W, CARD_H: CARD_H, LAYER_GAP: LAYER_GAP }
    };
  }

  global.FamilyLayout = { compute: compute };
})(window);
