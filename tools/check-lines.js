/* РџСЂРѕРІРµСЂРєР° РїСЂР°РІРёР» Р»РёРЅРёР№: РїСЂРѕСЃРІРµС‚ РјРµР¶РґСѓ Р»РёРЅРёСЏРјРё Рё РєР°СЂС‚РѕС‡РєР°РјРё РЅРµ РјРµРЅСЊС€Рµ 7 С‚РѕР»С‰РёРЅ,
   Р»РёРЅРёРё РЅРµ РїСЂРѕС…РѕРґСЏС‚ СЃРєРІРѕР·СЊ РєР°СЂС‚РѕС‡РєРё, РїРµСЂРµСЃРµС‡РµРЅРёР№ РЅРµС‚. */

global.window = global;
global.localStorage = { getItem: function () { return null; }, setItem: function () {} };
require('../data.js');
require('../layout.js');

var L = window.FamilyLayout.compute(window.FAMILY);
var CLEAR = 10.5;
var HALF = 0.75;

var segs = [];

L.drops.forEach(function (d) {
  segs.push({ k: 'trunk:' + d.id, o: 'v', x: d.trunk.x, a: d.trunk.y1, b: d.trunk.y2 });

  (d.busSegs || []).forEach(function (s, i) {
    segs.push({ k: 'bus:' + d.id + ':' + i, o: 'h', y: s.y, a: s.x1, b: s.x2 });
  });

  d.stems.forEach(function (st) {
    for (var i = 0; i < st.points.length - 1; i++) {
      var p = st.points[i], q = st.points[i + 1];
      var name = 'stem:' + st.child + ':' + i;
      if (Math.abs(p[0] - q[0]) < 0.5) {
        segs.push({ k: name, o: 'v', x: p[0], a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]) });
      } else {
        segs.push({ k: name, o: 'h', y: p[1], a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]) });
      }
    }
  });
});

function rectDist(seg, c) {
  var x1 = c.x, x2 = c.x + c.w, y1 = c.y, y2 = c.y + c.h;
  if (seg.o === 'v') {
    var dx = Math.max(0, x1 - seg.x, seg.x - x2);
    var dy = Math.max(0, y1 - seg.b, seg.a - y2);
    return Math.hypot(dx, dy);
  }
  var dx2 = Math.max(0, x1 - seg.b, seg.a - x2);
  var dy2 = Math.max(0, y1 - seg.y, seg.y - y2);
  return Math.hypot(dx2, dy2);
}

function touchesEdge(seg, c) {
  /* СЃРѕРµРґРёРЅРµРЅРёРµ В«СЃС‚РІРѕР» вЂ” РєР°СЂС‚РѕС‡РєР°В» СѓРїРёСЂР°РµС‚СЃСЏ РІ РєСЂР°Р№: СЌС‚Рѕ РЅРµ РЅР°СЂСѓС€РµРЅРёРµ */
  var pts = seg.o === 'v' ? [[seg.x, seg.a], [seg.x, seg.b]] : [[seg.a, seg.y], [seg.b, seg.y]];
  return pts.some(function (pt) {
    var onX = pt[0] >= c.x - 1 && pt[0] <= c.x + c.w + 1;
    var onY = pt[1] >= c.y - 1 && pt[1] <= c.y + c.h + 1;
    var nearBottom = Math.abs(pt[1] - (c.y + c.h)) < 1.5;
    var nearTop = Math.abs(pt[1] - c.y) < 1.5;
    return onX && (nearBottom || nearTop) && onY;
  });
}

var cardBad = [];
segs.forEach(function (seg) {
  L.cards.forEach(function (c) {
    var d = rectDist(seg, c);
    if (d < CLEAR - 0.01) {
      if (touchesEdge(seg, c)) return;
      cardBad.push({ seg: seg.k, card: c.id, d: Math.round(d * 100) / 100 });
    }
  });
});

var parBad = [];
for (var i = 0; i < segs.length; i++) {
  for (var j = i + 1; j < segs.length; j++) {
    var s = segs[i], t = segs[j];
    if (s.o !== t.o) continue;
    if (s.o === 'h') {
      var overX = Math.min(s.b, t.b) - Math.max(s.a, t.a);
      if (overX <= 0.5) continue;
      var gapH = Math.abs(s.y - t.y);
      if (gapH < CLEAR - 0.01 && gapH > 0.01) parBad.push({ a: s.k, b: t.k, gap: Math.round(gapH * 100) / 100 });
    } else {
      var overY = Math.min(s.b, t.b) - Math.max(s.a, t.a);
      if (overY <= 0.5) continue;
      var gapV = Math.abs(s.x - t.x);
      if (gapV < CLEAR - 0.01 && gapV > 0.01) parBad.push({ a: s.k, b: t.k, gap: Math.round(gapV * 100) / 100 });
    }
  }
}

var cross = [];
segs.forEach(function (s) {
  if (s.o !== 'h') return;
  segs.forEach(function (t) {
    if (t.o !== 'v') return;
    if (t.x > s.a + 0.5 && t.x < s.b - 0.5 && s.y > t.a + 0.5 && s.y < t.b - 0.5) {
      cross.push({ h: s.k, v: t.k, x: Math.round(t.x), y: Math.round(s.y) });
    }
  });
});

function top(list, n) {
  return list.slice(0, n || 8).map(function (x) { return JSON.stringify(x); }).join('\n  ');
}

console.log('РєР°СЂС‚РѕС‡РµРє:', L.cards.length, 'РѕС‚СЂРµР·РєРѕРІ:', segs.length);
console.log('РЅР°СЂСѓС€РµРЅРёР№ В«Р»РёРЅРёСЏ Сѓ РєР°СЂС‚РѕС‡РєРёВ»:', cardBad.length);
if (cardBad.length) console.log('  ' + top(cardBad));
console.log('РЅР°СЂСѓС€РµРЅРёР№ В«Р»РёРЅРёРё Р±Р»РёР¶Рµ 7 С‚РѕР»С‰РёРЅВ»:', parBad.length);
if (parBad.length) console.log('  ' + top(parBad));
console.log('РїРµСЂРµСЃРµС‡РµРЅРёР№ (РіРѕСЂРёР·. Г— РІРµСЂС‚РёРє.):', cross.length);
if (cross.length) console.log('  ' + top(cross));

