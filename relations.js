/* relations.js — родство относительно «себя» (person.isSelf).
   Даёт каждой персоне термин (мама, дед, прабабушка, двоюродный брат…),
   сторону (его / её / центр) и глубину, чтобы интерфейс мог подписать карточку.

   Проверка без браузера:
     node -e "global.window=global;require('./data.js');require('./relations.js');
              const r=window.FamilyRelations.compute(window.FAMILY);
              console.log(r.byId['shlepova-lidiya'])"                                */

(function (global) {
  'use strict';

  function upTerm(depth, sex) {
    var f = sex === 'f';
    if (depth === 1) return f ? 'мама' : 'папа';
    if (depth === 2) return f ? 'бабушка' : 'дед';
    if (depth === 3) return f ? 'прабабушка' : 'прадед';
    if (depth === 4) return f ? 'прапрабабушка' : 'прапрадед';
    if (depth === 5) return f ? 'прапрапрабабушка' : 'прапрапрадед';
    return (f ? 'прабабушка' : 'прадед') + ' в ' + depth + '-м колене';
  }

  function downTerm(depth, sex) {
    var f = sex === 'f';
    if (depth === 1) return f ? 'дочь' : 'сын';
    if (depth === 2) return f ? 'внучка' : 'внук';
    if (depth === 3) return f ? 'правнучка' : 'правнук';
    return (f ? 'внучка' : 'внук') + ' в ' + depth + '-м колене';
  }

  function compute(family, selfId, depth) {
    var people = family.people;
    var unions = family.unions;
    var byId = {};
    people.forEach(function (p) { byId[p.id] = p; });

    var self = selfId ? byId[selfId] : people.filter(function (p) { return p.isSelf; })[0];
    if (!self) return { byId: {}, selfId: null };

    /* --- индексы --- */
    var parentUnions = {};   // ребёнок -> [союз]
    var spousesOf = {};      // персона -> [персона]
    var childrenOf = {};     // персона -> [ребёнок]
    people.forEach(function (p) {
      parentUnions[p.id] = [];
      spousesOf[p.id] = [];
      childrenOf[p.id] = [];
    });
    unions.forEach(function (u) {
      (u.children || []).forEach(function (cid) {
        if (parentUnions[cid]) parentUnions[cid].push(u);
      });
      u.partners.forEach(function (pid) {
        if (!childrenOf[pid]) return;
        (u.children || []).forEach(function (cid) {
          if (pid !== cid && childrenOf[pid].indexOf(cid) === -1) childrenOf[pid].push(cid);
        });
        u.partners.forEach(function (other) {
          if (other !== pid && spousesOf[pid] && spousesOf[pid].indexOf(other) === -1) {
            spousesOf[pid].push(other);
          }
        });
      });
    });

    // братья и сёстры: общий родительский союз + явные пометки siblingOf
    function siblingsOf(id) {
      var out = [];
      parentsOf(id).forEach(function (pid) {
        (childrenOf[pid] || []).forEach(function (cid) {
          if (cid !== id && out.indexOf(cid) === -1) out.push(cid);
        });
      });
      var person = byId[id];
      if (person && person.siblingOf) {
        person.siblingOf.forEach(function (sid) {
          if (sid !== id && out.indexOf(sid) === -1 && byId[sid]) out.push(sid);
        });
      }
      // и обратная сторона: если кто-то назвал этого человека своим братом/сестрой
      people.forEach(function (other) {
        if (other.siblingOf && other.siblingOf.indexOf(id) !== -1 && out.indexOf(other.id) === -1) {
          out.push(other.id);
        }
      });
      return out;
    }

    function parentsOf(id) {
      var out = [];
      (parentUnions[id] || []).forEach(function (u) {
        u.partners.forEach(function (pid) { if (pid !== id && out.indexOf(pid) === -1) out.push(pid); });
      });
      return out;
    }

    /* --- одна сторона: обход без перехода через «мост» --- */
    function sideFrom(startId, blockedId) {
      var seen = {}, queue = [startId];
      seen[startId] = true;
      while (queue.length) {
        var id = queue.shift();
        var next = parentsOf(id)
          .concat(childrenOf[id] || [])
          .concat(spousesOf[id] || []);
        next.forEach(function (nid) {
          if (!nid || nid === blockedId || seen[nid] || !byId[nid]) return;
          seen[nid] = true;
          queue.push(nid);
        });
      }
      return seen;
    }

    var spouse = null;
    unions.forEach(function (u) {
      if (u.partners.length !== 2) return;
      if (u.partners[0] === self.id) spouse = u.partners[1];
      else if (u.partners[1] === self.id) spouse = u.partners[0];
    });
    var mine = sideFrom(self.id, spouse);
    var hers = spouse ? sideFrom(spouse, self.id) : {};

    /* --- предки: подъём по родителям --- */
    var result = {};

    function put(id, term, detail, side, depth, line) {
      if (!byId[id] || id === self.id) return;
      var old = result[id];
      // ближайшая степень родства важнее дальней
      if (old && old.depth <= depth) return;
      result[id] = { term: term, detail: detail || '', side: side, depth: depth, line: line || '' };
    }

    // предки: BFS вверх с запоминанием первого шага (по отцу / по матери)
    function walkAncestors(startId, side, prefix, maxDepth, inLaw) {
      var queue = [{ id: startId, d: 0, first: '' }];
      var seen = {};
      while (queue.length) {
        var cur = queue.shift();
        if (cur.d > maxDepth) continue;
        parentsOf(cur.id).forEach(function (pid) {
          var d = cur.d + 1;
          var first = cur.first || byId[pid].sex;
          var key = pid + '@' + d + '@' + first;
          if (seen[key]) return;
          seen[key] = true;
          var p = byId[pid];
          var detail = '';
          var term;
          if (inLaw) {
            if (d === 1) term = (self.sex === 'm')
              ? (p.sex === 'f' ? 'тёща' : 'тесть')
              : (p.sex === 'f' ? 'свекровь' : 'свёкор');
            else term = upTerm(d, p.sex) + (self.sex === 'm' ? ' жены' : ' мужа');
            detail = '';
          } else {
            term = upTerm(d, p.sex);
            detail = first === 'm' ? 'по папе' : 'по маме';
          }
          put(pid, term, detail, side, d, 'up');
          queue.push({ id: pid, d: d, first: first });
        });
      }
    }

    walkAncestors(self.id, -1, '', 5, false);
    if (spouse) walkAncestors(spouse, 1, 'жены', 5, true);

    // жена / муж
    (spousesOf[self.id] || []).forEach(function (sid) {
      var sp = byId[sid];
      if (sp) put(sid, sp.sex === 'f' ? 'жена' : 'муж', '', 0, 1, 'spouse');
    });

    // братья и сёстры (общий родительский союз + явные пометки)
    var sibs = {};
    siblingsOf(self.id).forEach(function (cid) { sibs[cid] = true; });
    Object.keys(sibs).forEach(function (cid) {
      if (cid === self.id) return;
      put(cid, byId[cid].sex === 'f' ? 'сестра' : 'брат', '', -1, 1, 'sib');
    });

    // дети и внуки
    function walkDown(startId, side) {
      var queue = [{ id: startId, d: 0 }];
      var seen = {};
      while (queue.length) {
        var cur = queue.shift();
        if (cur.d > 3) continue;
        (childrenOf[cur.id] || []).forEach(function (cid) {
          var d = cur.d + 1;
          if (seen[cid + '@' + d]) return;
          seen[cid + '@' + d] = true;
          put(cid, downTerm(d, byId[cid].sex), '', side, 10 + d, 'down');
          queue.push({ id: cid, d: d });
        });
      }
    }
    walkDown(self.id, 0);

    // дяди, тёти и двоюродные
    Object.keys(sibs).forEach(function (sid) {
      if (sid === self.id) return;
      (childrenOf[sid] || []).forEach(function (cid) {
        put(cid, byId[cid].sex === 'f' ? 'племянница' : 'племянник', '', -1, 5, 'nephew');
      });
    });
    parentsOf(self.id).forEach(function (pid) {
      // братья и сёстры родителей — родные и явно указанные
      siblingsOf(pid).forEach(function (unc) {
        if (unc === pid || sibs[unc]) return;
        var u = byId[unc];
        var d = byId[pid].sex === 'f' ? 'по маме' : 'по папе';
        put(unc, u.sex === 'f' ? 'тётя' : 'дядя', d, -1, 4, 'uncle');
        (childrenOf[unc] || []).forEach(function (cous) {
          if (cous === self.id) return;
          var c = byId[cous];
          put(cous, (c.sex === 'f' ? 'двоюродная сестра' : 'двоюродный брат'), d, -1, 5, 'cousin');
          // дети двоюродных — двоюродные племянники
          (childrenOf[cous] || []).forEach(function (nep) {
            if (nep === self.id) return;
            var n = byId[nep];
            put(nep, (n.sex === 'f' ? 'двоюродная племянница' : 'двоюродный племянник'), d, -1, 6, 'cousin-kid');
          });
        });
      });
    });

    // родня жены/мужа: те же термины, что у супруга, но с пометкой
    if (spouse && !depth) {
      var herSide = compute(family, spouse, 1);
      Object.keys(herSide.byId).forEach(function (id) {
        if (id === self.id || result[id]) return;
        var r = herSide.byId[id];
        if (!r || !r.term) return;
        result[id] = {
          term: r.term + (self.sex === 'm' ? ' жены' : ' мужа'),
          detail: '',
          side: 1,
          depth: (r.depth || 0) + 1,
          line: 'inlaw'
        };
      });
    }

    // сёстры и братья жены/мужа
    if (spouse) {
      parentsOf(spouse).forEach(function (pid) {
        (childrenOf[pid] || []).forEach(function (cid) {
          if (cid === spouse) return;
          var c = byId[cid];
          put(cid, (c.sex === 'f' ? 'сестра жены' : 'брат жены'), '', 1, 4, 'inlaw');
        });
      });
    }

    // все, кто остался: сторона по обходу, без термина
    people.forEach(function (p) {
      if (p.id === self.id || result[p.id]) return;
      var side = 0;
      if (mine[p.id] && !hers[p.id]) side = -1;
      else if (hers[p.id] && !mine[p.id]) side = 1;
      else if (mine[p.id] && hers[p.id]) side = 0;
      put(p.id, '', '', side, 99, 'other');
    });

    return { byId: result, selfId: self.id, spouseId: spouse || null };
  }

  global.FamilyRelations = { compute: compute, upTerm: upTerm, downTerm: downTerm };
})(window);
