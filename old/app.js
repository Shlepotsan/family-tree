/* app.js — поведение страницы: вид, карточки, панель, редактор, хранение.
   Данные — data.js, координаты — layout.js. Здесь только DOM и операции над данными. */

(function () {
  'use strict';

  var DATA = window.FAMILY;
  var STORE_KEY = 'family-tree-v2';

  var el = {
    viewport: document.getElementById('viewport'),
    canvas: document.getElementById('canvas'),
    links: document.getElementById('links'),
    cards: document.getElementById('cards'),
    panel: document.getElementById('panel'),
    search: document.getElementById('search'),
    results: document.getElementById('results'),
    zoomValue: document.getElementById('zoom-value'),
    legend: document.getElementById('legend'),
    stats: document.getElementById('stats'),
    toast: document.getElementById('toast'),
    modal: document.getElementById('modal-root'),
    photoInput: document.getElementById('photo-input')
  };

  var CAN_ZOOM = typeof document.documentElement.style.zoom !== 'undefined';

  var state = {
    people: [],
    unions: [],
    branches: DATA.branches,
    view: { x: 0, y: 0, s: 0.6 },
    layout: null,
    selected: null,
    filter: null,
    mode: 'view',        // view | edit | new
    form: null,          // черновик при правке
    undo: null,
    collapsed: [],       // id тех, чьи дети свёрнуты
    kin: false,          // показывать подписи родства
    kinRef: null         // относительно кого считаем родство
  };

  /* ==================== данные ==================== */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.people && saved.people.length) {
          state.people = saved.people;
          state.unions = saved.unions || [];
          return;
        }
      }
    } catch (e) { /* хранилище недоступно — работаем с исходными данными */ }
    state.people = clone(DATA.people);
    state.unions = clone(DATA.unions);
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: 2, people: state.people, unions: state.unions }));
    } catch (e) {
      toast('Браузер не сохранил изменения — выгрузите файл кнопкой «Данные»');
    }
    pushRemote();
  }

  /* ==================== общая база (Google-таблица) ==================== */

  function pushRemote() {
    if (!window.FamilySync || !window.FamilySync.enabled) return;
    window.FamilySync.queue({ people: state.people, unions: state.unions });
  }

  function pullRemote() {
    if (!window.FamilySync || !window.FamilySync.enabled) return;

    window.FamilySync.pull().then(function (remote) {
      if (!remote) return;

      /* таблица пустая — заливаем то, что открыто сейчас */
      if (!remote.people || !remote.people.length) {
        window.FamilySync.queue({ people: state.people, unions: state.unions });
        return;
      }

      /* нового с прошлого раза нет */
      if (remote.updated && remote.updated === window.FamilySync.mark()) return;

      /* фотографии в таблицу не ездят — берём из этого браузера */
      var photos = {};
      state.people.forEach(function (p) { if (p.photo) photos[p.id] = p.photo; });

      snapshot();
      state.people = remote.people.map(function (p) {
        if (!p.photo && photos[p.id]) p.photo = photos[p.id];
        return p;
      });
      state.unions = remote.unions || [];

      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ v: 2, people: state.people, unions: state.unions }));
      } catch (e) { /* приватный режим */ }

      if (remote.updated) window.FamilySync.setMark(remote.updated);

      render();
      toast('Загружены правки из общей таблицы', 'Вернуть', undoLast);
    }).catch(function () {
      toast('Общая таблица недоступна — показаны данные этого браузера');
    });
  }

  function snapshot() {
    state.undo = { people: clone(state.people), unions: clone(state.unions) };
  }

  function undoLast() {
    if (!state.undo) return;
    state.people = state.undo.people;
    state.unions = state.undo.unions;
    state.undo = null;
    state.selected = null;
    state.mode = 'view';
    save();
    render();
    closePanel();
    toast('Изменение отменено');
  }

  function byId(id) {
    for (var i = 0; i < state.people.length; i++) if (state.people[i].id === id) return state.people[i];
    return null;
  }

  function slug(text) {
    var map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
      к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
      х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    var out = String(text || '').toLowerCase().split('').map(function (ch) {
      return map[ch] !== undefined ? map[ch] : (/[a-z0-9]/.test(ch) ? ch : '-');
    }).join('').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return out || 'person';
  }

  function newId(text) {
    var base = slug(text);
    var id = base;
    var n = 2;
    while (byId(id)) { id = base + '-' + n; n++; }
    return id;
  }

  function createPerson(fields) {
    var person = Object.assign({
      id: newId([fields.first, fields.last].filter(Boolean).join(' ')),
      first: '', middle: '', last: '', maiden: '', sex: 'm', branch: 'other',
      born: '', died: '', bornPlace: '', diedPlace: '', bio: '', note: '',
      facts: [], sources: [], photo: null
    }, fields);
    state.people.push(person);
    return person;
  }

  function updatePerson(id, fields) {
    var p = byId(id);
    if (!p) return;
    Object.keys(fields).forEach(function (k) {
      if (fields[k] === '' || fields[k] === null) delete p[k];
      else p[k] = fields[k];
    });
  }

  function deletePerson(id) {
    var p = byId(id);
    if (!p) return;
    state.people = state.people.filter(function (x) { return x.id !== id; });

    var next = [];
    state.unions.forEach(function (u) {
      u.partners = u.partners.filter(function (x) { return x !== id; });
      u.children = u.children.filter(function (x) { return x !== id; });
      if (!u.partners.length) return;                      // взрослых не осталось — союз больше не нужен
      if (u.partners.length === 1) u.type = 'single';
      next.push(u);
    });
    state.unions = next;
  }

  /* ---- связи ---- */

  function parentUnionOf(personId) {
    for (var i = 0; i < state.unions.length; i++) {
      if (state.unions[i].children.indexOf(personId) !== -1) return state.unions[i];
    }
    return null;
  }

  function partnerUnionsOf(personId) {
    return state.unions.filter(function (u) { return u.partners.indexOf(personId) !== -1; });
  }

  function linkParent(childId, parentId) {
    var u = parentUnionOf(childId);
    if (u) {
      if (u.partners.indexOf(parentId) !== -1) return false;
      if (u.partners.length >= 2) return false;
      u.partners.push(parentId);
      u.type = 'marriage';
    } else {
      state.unions.push({ id: 'u' + Date.now() + Math.floor(Math.random() * 99), partners: [parentId], children: [childId], type: 'single' });
    }
    return true;
  }

  function linkSpouse(aId, bId) {
    var has = state.unions.some(function (u) {
      return u.partners.indexOf(aId) !== -1 && u.partners.indexOf(bId) !== -1;
    });
    if (has) return false;
    state.unions.push({ id: 'u' + Date.now() + Math.floor(Math.random() * 99), partners: [aId, bId], children: [], type: 'marriage' });
    return true;
  }

  function linkChild(parentId, childId) {
    var tryUnions = partnerUnionsOf(parentId);
    var target = tryUnions.filter(function (u) { return u.children.indexOf(childId) === -1; })[0];
    if (!target) {
      target = tryUnions[0];
    }
    if (target) {
      if (target.children.indexOf(childId) === -1) target.children.push(childId);
      return true;
    }
    state.unions.push({ id: 'u' + Date.now() + Math.floor(Math.random() * 99), partners: [parentId], children: [childId], type: 'single' });
    return true;
  }

  function unlinkParent(childId, parentId) {
    state.unions.forEach(function (u) {
      if (u.children.indexOf(childId) === -1) return;
      u.partners = u.partners.filter(function (x) { return x !== parentId; });
      if (!u.partners.length) u.type = 'single';
    });
    state.unions = state.unions.filter(function (u) { return u.partners.length || u.children.length; });
  }

  function unlinkSpouse(aId, bId) {
    state.unions = state.unions.filter(function (u) {
      var both = u.partners.indexOf(aId) !== -1 && u.partners.indexOf(bId) !== -1;
      if (!both) return true;
      u.partners = u.partners.filter(function (x) { return x !== bId; });
      u.type = 'single';
      return u.partners.length > 0 || u.children.length > 0;
    });
  }

  function unlinkChild(parentId, childId) {
    state.unions.forEach(function (u) {
      if (u.partners.indexOf(parentId) === -1) return;
      u.children = u.children.filter(function (x) { return x !== childId; });
    });
    state.unions = state.unions.filter(function (u) { return u.partners.length || u.children.length; });
  }

  function parentsOf(id) {
    var out = [];
    state.unions.forEach(function (u) {
      if (u.children.indexOf(id) === -1) return;
      u.partners.forEach(function (pid) { if (out.indexOf(pid) === -1) out.push(pid); });
    });
    return out;
  }

  function spousesOf(id) {
    var out = [];
    partnerUnionsOf(id).forEach(function (u) {
      u.partners.forEach(function (pid) { if (pid !== id && out.indexOf(pid) === -1) out.push(pid); });
    });
    return out;
  }

  function childrenOf(id) {
    var out = [];
    partnerUnionsOf(id).forEach(function (u) {
      u.children.forEach(function (cid) { if (out.indexOf(cid) === -1) out.push(cid); });
    });
    return out;
  }

  function siblingsOf(id) {
    var out = [];
    state.unions.forEach(function (u) {
      if (u.children.indexOf(id) === -1) return;
      u.children.forEach(function (cid) { if (cid !== id && out.indexOf(cid) === -1) out.push(cid); });
    });
    return out;
  }

  function ancestorsOf(id) {
    var seen = [];
    var queue = parentsOf(id);
    while (queue.length) {
      var cur = queue.shift();
      if (!cur || seen.indexOf(cur) !== -1) continue;
      seen.push(cur);
      parentsOf(cur).forEach(function (p) { queue.push(p); });
    }
    return seen;
  }

  function descendantsOf(id) {
    var seen = [];
    var queue = childrenOf(id);
    while (queue.length) {
      var cur = queue.shift();
      if (!cur || seen.indexOf(cur) !== -1) continue;
      seen.push(cur);
      childrenOf(cur).forEach(function (c) { queue.push(c); });
    }
    return seen;
  }

  /* ---- свёрнутые ветви ---- */

  function hiddenIds() {
    var hidden = [];
    state.collapsed.forEach(function (id) {
      descendantsOf(id).forEach(function (d) { if (hidden.indexOf(d) === -1) hidden.push(d); });
    });
    return hidden;
  }

  function visibleData() {
    var hidden = hiddenIds();
    if (!hidden.length) return { people: state.people, unions: state.unions };
    var people = state.people.filter(function (p) { return hidden.indexOf(p.id) === -1; });
    var unions = state.unions
      .filter(function (u) { return hidden.indexOf(u.partners[0]) === -1; })
      .map(function (u) {
        return {
          id: u.id, type: u.type, note: u.note,
          partners: u.partners.filter(function (id) { return hidden.indexOf(id) === -1; }),
          children: u.children.filter(function (id) { return hidden.indexOf(id) === -1; })
        };
      });
    return { people: people, unions: unions };
  }

  function toggleFold(id) {
    var i = state.collapsed.indexOf(id);
    if (i === -1) state.collapsed.push(id);
    else state.collapsed.splice(i, 1);
    render();
    highlight();
  }

  function expandAncestors(id) {
    var chain = ancestorsOf(id);
    state.collapsed = state.collapsed.filter(function (x) { return chain.indexOf(x) === -1; });
  }

  /* ==================== подписи ==================== */

  function nameFirst(p) {
    return [p.first, p.middle].filter(Boolean).join(' ') || p.last || 'Без имени';
  }

  function fullName(p) {
    return [nameFirst(p), p.last].filter(Boolean).join(' ');
  }

  function yearsOf(p) {
    if (p.born && p.died) return p.born + ' — ' + p.died;
    if (p.born) return 'род. ' + p.born;
    if (p.died) return '† ' + p.died;
    return '';
  }

  function initials(p) {
    var a = (p.first || '').charAt(0);
    var b = (p.middle || '').charAt(0);
    return (a + (b || '')).toUpperCase() || '?';
  }

  function branchOf(p) {
    return state.branches[p.branch] || { title: 'Без ветви', color: '#7a7466' };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ==================== древо ==================== */

  function render() {
    var vis = visibleData();
    var L = window.FamilyLayout.compute({ people: vis.people, unions: vis.unions });
    state.layout = L;

    el.canvas.style.width = L.width + 'px';
    el.canvas.style.height = L.height + 'px';
    el.links.setAttribute('width', L.width);
    el.links.setAttribute('height', L.height);
    el.links.setAttribute('viewBox', '0 0 ' + L.width + ' ' + L.height);

    drawLinks(L, focusUnions());
    drawCards(L);
    renderStats(L);
    renderLegend();
    applyView();
  }

  // все предки человека — вверх по родителям, пока есть данные
  function ancestorIds(id) {
    var out = [], seen = {}, stack = [id];
    while (stack.length) {
      var cur = stack.pop();
      parentsOf(cur).forEach(function (pid) {
        if (seen[pid]) return;
        seen[pid] = true;
        out.push(pid);
        stack.push(pid);
      });
    }
    return out;
  }

  // какие союзы и люди подсветить: выбранный + вся цепочка предков
  function focusUnions() {
    if (!state.selected) return null;
    var people = {};
    people[state.selected] = true;
    ancestorIds(state.selected).forEach(function (id) { people[id] = true; });

    var u = {};
    Object.keys(people).forEach(function (id) {
      state.unions.forEach(function (un) {
        if ((un.children || []).indexOf(id) !== -1) u[un.id] = true;
        if (un.partners.indexOf(id) !== -1) u[un.id] = true;
      });
    });
    return { u: u, p: people };
  }

  function drawLinks(L, focus) {
    if (!L) return;
    var any = !!focus;
    var parts = [];

    function clsFor(on, base) {
      return base + (on ? ' hot' : '') + (any && !on ? ' dim' : '');
    }

    // брак — двойная линия
    L.marriages.forEach(function (m) {
      var on = focus && focus.u[m.id];
      var cls = clsFor(on, "link marriage");
      parts.push('<line class="' + cls + '" x1="' + m.x1 + '" y1="' + (m.y1 - 2) +
        '" x2="' + m.x2 + '" y2="' + (m.y2 - 2) + '"/>');
      parts.push('<line class="' + cls + '" x1="' + m.x1 + '" y1="' + (m.y1 + 2) +
        '" x2="' + m.x2 + '" y2="' + (m.y2 + 2) + '"/>');
    });

    L.drops.forEach(function (d) {
      var kids = d.children || [];
      var firstKid = kids.length ? byId(kids[0]) : null;
      var color = firstKid ? branchOf(firstKid).color : '#b9ad95';
      var style = ' style="--link:' + color + '"';
      var onSpine = !!(focus && focus.u[d.id]);

      // ствол от пары
      parts.push('<path class="' + clsFor(onSpine, "link kin spine") + '" d="M ' + d.trunk.x +
        ' ' + d.trunk.y1 + " V " + d.trunk.y2 + '"' + style + '/>');

      // шина — кусками, с разрывами на пересечениях
      var segs = d.busSegs || (d.bus ? [d.bus] : []);
      segs.forEach(function (sg) {
        parts.push('<path class="' + clsFor(onSpine, "link kin bus") +
          '" d="M ' + sg.x1 + " " + sg.y + " H " + sg.x2 + '"' + style + '/>');
      });

      // ножки к детям (у длинных — с обходом по коридору)
      d.stems.forEach(function (st) {
        var onStem = onSpine && focus && focus.p[st.child];
        var dpath = 'M ' + st.points[0][0] + ' ' + st.points[0][1];
        for (var i = 1; i < st.points.length; i++) dpath += ' L ' + st.points[i][0] + ' ' + st.points[i][1];
        parts.push('<path class="' + clsFor(onStem, "link kin stem") + '" d="' + dpath + '"' + style + '/>');
      });

      // стыки: выход от пары и точки на шине
      parts.push('<circle class="' + clsFor(onSpine, "joint origin") + '" cx="' + d.trunk.x +
        '" cy="' + d.trunk.y1 + '" r="2.8"' + style + '/>');
      if (d.bus) {
        parts.push('<circle class="' + clsFor(onSpine, "joint") + '" cx="' + d.trunk.x +
          '" cy="' + d.bus.y + '" r="2.2"' + style + '/>');
        d.stems.forEach(function (st) {
          if (st.plain) return;   // продолжение после разрыва — точка не нужна
          var onStem = onSpine && focus && focus.p[st.child];
          parts.push('<circle class="' + clsFor(onStem, "joint") + '" cx="' + st.points[0][0] +
            '" cy="' + st.points[0][1] + '" r="2"' + style + '/>');
        });
      }
    });

    el.links.innerHTML = parts.join('');
  }

  function drawCards(L) {
    var self = state.people.filter(function (p) { return p.isSelf; })[0];
    var line = self ? ancestorsOf(self.id) : [];
    var frag = document.createDocumentFragment();
    var rel = (state.kin && state.kinRef && window.FamilyRelations)
      ? window.FamilyRelations.compute({ people: state.people, unions: state.unions }, state.kinRef)
      : null;

    L.cards.forEach(function (card) {
      var p = card.person;
      var b = branchOf(p);
      var node = document.createElement('div');
      var folded = state.collapsed.indexOf(p.id) !== -1;
      var kids = childrenOf(p.id);

      node.className = 'person' + (line.indexOf(p.id) !== -1 ? ' line' : '');
      node.dataset.id = p.id;
      node.style.cssText = 'left:' + card.x + 'px;top:' + card.y + 'px;width:' + card.w + 'px;height:' + card.h + 'px;--branch:' + b.color;
      var kin = rel && rel.byId[p.id];
      var kinHtml = kin
        ? '<span class="kin" title="' + escapeHtml(kin.detail || '') + '">' + escapeHtml(kin.term || '—') + '</span>'
        : '';

      node.innerHTML = kinHtml +
        '<div class="name">' + escapeHtml(nameFirst(p)) + '</div>' +
        '<div class="surname">' + escapeHtml(p.last || '—') +
          (p.maiden ? ' <span class="maiden">' + escapeHtml(p.maiden) + '</span>' : '') + '</div>' +
        '<div class="years' + (yearsOf(p) ? '' : ' muted') + '">' + escapeHtml(yearsOf(p) || 'годы неизвестны') + '</div>' +
        (p.photo ? '<img class="thumb" src="' + p.photo + '" alt="">' : '') +
        (p.isSelf ? '<span class="me">вы</span>' : '') +
        (folded
          ? '<span class="fold" title="Показать детей">+' + descendantsOf(p.id).length + '</span>'
          : (kids.length ? '<span class="fold fold-up" title="Свернуть детей">−</span>' : ''));

      node.addEventListener('click', function (e) {
        if (e.target.closest('.fold')) return;
        select(p.id, true);
      });

      var foldBtn = node.querySelector('.fold');
      if (foldBtn) {
        foldBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          toggleFold(p.id);
        });
      }

      frag.appendChild(node);
    });

    el.cards.innerHTML = '';
    el.cards.appendChild(frag);
    highlight();
  }

  function renderStats(L) {
    var branches = Object.keys(state.branches).filter(function (k) {
      return k !== 'other' && state.people.some(function (p) { return p.branch === k; });
    }).length;
    el.stats.innerHTML =
      '<div><b>' + state.people.length + '</b>человек</div>' +
      '<div><b>' + L.layers.length + '</b>поколений</div>' +
      '<div><b>' + branches + '</b>ветвей</div>';
  }

  function highlight() {
    var cards = el.cards.children;
    var chain = {};
    if (state.selected) {
      chain[state.selected] = true;
      ancestorIds(state.selected).forEach(function (id) { chain[id] = true; });
    }
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].dataset.id;
      var p = byId(id);
      var dim = state.filter && p && p.branch !== state.filter;
      cards[i].classList.toggle('dim', !!dim);
      cards[i].classList.toggle('selected', id === state.selected);
      cards[i].classList.toggle('anc', !!chain[id] && id !== state.selected);
    }
  }

  function renderLegend() {
    var used = [];
    state.people.forEach(function (p) {
      if (p.branch && used.indexOf(p.branch) === -1) used.push(p.branch);
    });
    var chips = used.map(function (key) {
      var b = state.branches[key] || { title: key, color: '#7a7466' };
      return '<button class="' + (state.filter === key ? 'on' : '') + '" data-branch="' + key +
        '" style="--branch:' + b.color + '"><i></i>' + escapeHtml(b.title) + '</button>';
    }).join('');

    el.legend.innerHTML = chips +
      '<button class="clear" data-branch="">Показать всех</button>' +
      '<button class="clear" data-view="all">Развернуть все ветви</button>';

    Array.prototype.forEach.call(el.legend.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (btn.dataset.view === 'all') {
          state.collapsed = [];
          el.legend.classList.remove('open');
          render();
          return;
        }
        var key = btn.dataset.branch || null;
        state.filter = state.filter === key ? null : key;
        renderLegend();
        highlight();
      });
    });
  }

  /* ==================== панель ==================== */

  function select(id, center) {
    if (hiddenIds().indexOf(id) !== -1) {
      expandAncestors(id);
      render();
    }
    state.selected = id;
    if (state.kin) state.kinRef = id;
    state.mode = 'view';
    state.form = null;
    renderPanel();
    el.panel.classList.add('open');
    if (state.kin) {
      render();
      var ref = state.kinRef ? byId(state.kinRef) : null;
      if (ref) toast('Подписи относительно: ' + (ref.first || '') + ' ' + (ref.last || ''));
    } else {
      highlight();
      drawLinks(state.layout, focusUnions());
    }
    if (center) centerOn(id);
  }

  function closePanel() {
    state.selected = null;
    state.mode = 'view';
    state.form = null;
    el.panel.classList.remove('open');
    el.panel.innerHTML = '';
    highlight();
    drawLinks(state.layout, null);
  }

  function renderPanel() {
    if (state.mode === 'new') {
      el.panel.innerHTML = '<button class="panel-close" id="panel-close" title="Закрыть">✕</button>' + formView(blankPerson());
      bindPanel({});
      return;
    }
    var p = state.selected ? byId(state.selected) : null;
    if (!p) { el.panel.innerHTML = ''; return; }
    el.panel.innerHTML = '<button class="panel-close" id="panel-close" title="Закрыть">✕</button>' +
      (state.mode === 'edit' ? formView(p) : personView(p));
    bindPanel(p);
  }

  function personView(p) {
    var b = branchOf(p);
    var life = [yearsOf(p), p.bornPlace].filter(Boolean).join(' · ');
    var facts = (p.facts || []).map(function (f) {
      return '<div><dt>' + escapeHtml(f[0] || '') + '</dt><dd>' + escapeHtml(f[1] || '') + '</dd></div>';
    }).join('');
    var bio = (p.bio || '').split('\n\n').filter(Boolean).map(function (par) {
      return '<p>' + escapeHtml(par) + '</p>';
    }).join('');

    return '' +
      '<div class="panel-head">' +
        '<div class="avatar">' + (p.photo ? '<img src="' + p.photo + '" alt="">' : escapeHtml(initials(p))) + '</div>' +
        '<div class="who">' +
          '<h2>' + escapeHtml(fullName(p)) + '</h2>' +
          (p.maiden ? '<div class="life">в девичестве ' + escapeHtml(p.maiden) + '</div>' : '') +
          (life ? '<div class="life">' + escapeHtml(life) + '</div>' : '') +
          '<span class="branch-tag" style="--branch:' + b.color + '"><i></i>' + escapeHtml(b.title) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="panel-body">' +
        (bio ? '<div class="section"><h3>История</h3>' + bio + '</div>' : '') +
        (facts ? '<div class="section"><h3>Факты</h3><dl class="facts">' + facts + '</dl></div>' : '') +
        (p.note ? '<div class="section"><h3>Примечание</h3><p class="note">' + escapeHtml(p.note) + '</p></div>' : '') +
        relationsView(p) +
        (p.sources && p.sources.length ? '<div class="section"><h3>Источники</h3><ul class="sources">' +
          p.sources.map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<div class="panel-actions">' +
          '<button class="btn primary" id="panel-edit">Изменить</button>' +
          '<button class="btn" id="panel-focus">Показать</button>' +
          '<button class="btn danger" id="panel-delete">Удалить</button>' +
        '</div>' +
      '</div>';
  }

  function relationsView(p) {
    function chips(ids, title) {
      if (!ids.length) return '';
      var items = ids.map(function (id) {
        var q = byId(id);
        if (!q) return '';
        return '<button data-goto="' + id + '">' + escapeHtml(fullName(q)) + '</button>';
      }).join('');
      return '<div class="section"><h3>' + title + '</h3><div class="rel">' + items + '</div></div>';
    }
    return chips(parentsOf(p.id), 'Родители') +
      chips(spousesOf(p.id), 'Супруги') +
      chips(childrenOf(p.id), 'Дети') +
      chips(siblingsOf(p.id), 'Братья и сёстры');
  }

  /* ---- форма ---- */

  function blankPerson() {
    return {
      id: '', first: '', middle: '', last: '', maiden: '', sex: 'm', branch: 'other',
      born: '', died: '', bornPlace: '', diedPlace: '', bio: '', note: '', facts: [], sources: [], photo: null
    };
  }

  function formView(p) {
    var isNew = state.mode === 'new';
    var f = state.form || p;
    var factsText = (f.facts || []).map(function (x) { return (x[0] ? x[0] + ': ' : '') + (x[1] || ''); }).join('\n');

    var branchOptions = Object.keys(state.branches).map(function (key) {
      var b = state.branches[key];
      return '<option value="' + key + '"' + (f.branch === key ? ' selected' : '') + '>' + escapeHtml(b.title) + '</option>';
    }).join('');

    return '' +
      '<div class="panel-head"><div class="who">' +
        '<h2>' + (isNew ? 'Новый человек' : 'Правка') + '</h2>' +
        '<div class="life">' + (isNew ? 'Заполните, что знаете — остальное можно позже' : 'Изменения сохранятся сразу') + '</div>' +
      '</div></div>' +
      '<div class="panel-body"><div class="editor">' +
        '<div class="photo-edit">' +
          '<div class="avatar">' + (f.photo ? '<img src="' + f.photo + '" alt="">' : escapeHtml(initials(f))) + '</div>' +
          '<div class="photo-buttons">' +
            '<button class="btn" id="photo-pick" type="button">Фото</button>' +
            (f.photo ? '<button class="btn ghost" id="photo-clear" type="button">Убрать</button>' : '') +
          '</div>' +
        '</div>' +
        '<p class="photo-hint">Фото уменьшается до 420 px и хранится вместе с описанием</p>' +

        '<div class="row">' +
          '<label>Имя<input data-field="first" value="' + attr(f.first) + '" placeholder="Иван"></label>' +
          '<label>Отчество<input data-field="middle" value="' + attr(f.middle) + '" placeholder="Петрович"></label>' +
        '</div>' +
        '<div class="row">' +
          '<label>Фамилия<input data-field="last" value="' + attr(f.last) + '" placeholder="Иванов"></label>' +
          '<label>Девичья<input data-field="maiden" value="' + attr(f.maiden) + '" placeholder="Петрова"></label>' +
        '</div>' +
        '<div class="row">' +
          '<label>Пол<select data-field="sex">' +
            '<option value="m"' + (f.sex !== 'f' ? ' selected' : '') + '>мужской</option>' +
            '<option value="f"' + (f.sex === 'f' ? ' selected' : '') + '>женский</option>' +
          '</select></label>' +
          '<label>Ветвь рода<select data-field="branch">' + branchOptions + '</select></label>' +
        '</div>' +
        '<div class="row">' +
          '<label>Рождение<input data-field="born" value="' + attr(f.born) + '" placeholder="31.05.2004"></label>' +
          '<label>Смерть<input data-field="died" value="' + attr(f.died) + '" placeholder="—"></label>' +
        '</div>' +
        '<div class="row">' +
          '<label>Место рождения<input data-field="bornPlace" value="' + attr(f.bornPlace) + '"></label>' +
          '<label>Место смерти<input data-field="diedPlace" value="' + attr(f.diedPlace) + '"></label>' +
        '</div>' +
        '<label>Описание<textarea data-field="bio" placeholder="История жизни, воспоминания, подробности">' + escapeHtml(f.bio || '') + '</textarea></label>' +
        '<label>Факты — по строке «что: значение»<textarea data-field="facts" placeholder="Награды: медаль «За отвагу»">' + escapeHtml(factsText) + '</textarea></label>' +
        '<label>Примечание<textarea data-field="note" placeholder="Расхождения в источниках, пометки" style="min-height:64px">' + escapeHtml(f.note || '') + '</textarea></label>' +
        '<label>Источники — по строке<textarea data-field="sources" placeholder="Родственники ВОВ.docx" style="min-height:56px">' + escapeHtml((f.sources || []).join('\n')) + '</textarea></label>' +

        (isNew ? '' : relationsEdit(p)) +

        '<div class="panel-actions">' +
          '<button class="btn primary" id="save">' + (isNew ? 'Создать' : 'Сохранить') + '</button>' +
          '<button class="btn" id="cancel">Отмена</button>' +
        '</div>' +
      '</div></div>';
  }

  function relationsEdit(p) {
    function row(title, ids, kind) {
      var items = ids.map(function (id) {
        var q = byId(id);
        if (!q) return '';
        return '<span class="rel-chip"><button data-goto="' + id + '">' + escapeHtml(fullName(q)) + '</button>' +
          '<button class="x" data-unlink="' + kind + '" data-person="' + id + '" title="Убрать связь">×</button></span>';
      }).join('');
      return '<div class="rel-edit"><span class="rel-title">' + title + '</span>' +
        '<div class="rel">' + items +
        '<button class="rel-add" data-link="' + kind + '">+ добавить</button></div></div>';
    }
    return '<div class="section"><h3>Связи</h3>' +
      row('Родители', parentsOf(p.id), 'parent') +
      row('Супруги', spousesOf(p.id), 'spouse') +
      row('Дети', childrenOf(p.id), 'child') +
      '</div>';
  }

  function attr(v) {
    return escapeHtml(v || '');
  }

  function readForm() {
    var f = {};
    Array.prototype.forEach.call(el.panel.querySelectorAll('[data-field]'), function (node) {
      var key = node.dataset.field;
      if (key === 'facts') f.facts = parseFacts(node.value);
      else if (key === 'sources') f.sources = node.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
      else f[key] = node.value.trim();
    });
    f.photo = (state.form && state.form.photo) || null;
    return f;
  }

  function parseFacts(text) {
    return text.split('\n').map(function (line) {
      var i = line.indexOf(':');
      if (i < 0) return line.trim() ? ['', line.trim()] : null;
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }).filter(Boolean);
  }

  function bindPanel(p) {
    var closeBtn = document.getElementById('panel-close');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    Array.prototype.forEach.call(el.panel.querySelectorAll('[data-goto]'), function (btn) {
      btn.addEventListener('click', function () { select(btn.dataset.goto, true); });
    });

    var editBtn = document.getElementById('panel-edit');
    if (editBtn) editBtn.addEventListener('click', function () {
      state.mode = 'edit';
      state.form = clone(p);
      renderPanel();
    });

    var focusBtn = document.getElementById('panel-focus');
    if (focusBtn) focusBtn.addEventListener('click', function () { centerOn(p.id); });

    var delBtn = document.getElementById('panel-delete');
    if (delBtn) delBtn.addEventListener('click', function () {
      confirmDialog({
        title: 'Удалить человека?',
        text: '«' + fullName(p) + '» исчезнет из древа, а связи с ним будут разорваны. Это можно отменить сразу после удаления.',
        confirm: 'Удалить',
        danger: true,
        onConfirm: function () {
          snapshot();
          deletePerson(p.id);
          save();
          closePanel();
          render();
          toast('Удалено', 'Вернуть', undoLast);
        }
      });
    });

    bindEditor(p);
  }

  function bindEditor(p) {
    var cancel = document.getElementById('cancel');
    if (cancel) cancel.addEventListener('click', function () {
      if (state.mode === 'new') { closePanel(); return; }
      state.mode = 'view';
      state.form = null;
      renderPanel();
    });

    var pick = document.getElementById('photo-pick');
    if (pick) pick.addEventListener('click', function () {
      state.form = Object.assign({}, state.form, readForm());   // не терять набранный текст
      el.photoInput.value = '';
      el.photoInput.click();
    });

    var clear = document.getElementById('photo-clear');
    if (clear) clear.addEventListener('click', function () {
      state.form = Object.assign({}, state.form, { photo: null });
      renderPanel();
    });

    var saveBtn = document.getElementById('save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var fields = readForm();
      if (!fields.first && !fields.last) {
        toast('Нужно хотя бы имя или фамилия');
        return;
      }
      snapshot();
      if (state.mode === 'new') {
        var created = createPerson(fields);
        save();
        render();
        select(created.id, true);
        toast('Человек добавлен — добавьте связи');
        return;
      }
      updatePerson(p.id, fields);
      save();
      state.mode = 'view';
      state.form = null;
      render();
      renderPanel();
      toast('Сохранено');
    });

    // связи: добавить
    Array.prototype.forEach.call(el.panel.querySelectorAll('[data-link]'), function (btn) {
      btn.addEventListener('click', function () {
        state.form = readForm();          // чтобы не потерять несохранённый текст
        openPicker(btn.dataset.link, (targetId) => {
          snapshot();
          var ok = false;
          if (btn.dataset.link === 'parent') ok = linkParent(p.id, targetId);
          if (btn.dataset.link === 'spouse') ok = linkSpouse(p.id, targetId);
          if (btn.dataset.link === 'child') ok = linkChild(p.id, targetId);
          if (!ok) toast('Такая связь уже есть');
          save();
          render();
          renderPanel();
        });
      });
    });

    // связи: убрать
    Array.prototype.forEach.call(el.panel.querySelectorAll('[data-unlink]'), function (btn) {
      btn.addEventListener('click', function () {
        snapshot();
        var kind = btn.dataset.unlink;
        var other = btn.dataset.person;
        if (kind === 'parent') unlinkParent(p.id, other);
        if (kind === 'spouse') unlinkSpouse(p.id, other);
        if (kind === 'child') unlinkChild(p.id, other);
        save();
        render();
        renderPanel();
        toast('Связь убрана', 'Вернуть', undoLast);
      });
    });
  }

  /* ==================== выбор человека ==================== */

  function openPicker(kind, onPick) {
    var titles = { parent: 'Кто родитель?', spouse: 'Кто супруг(а)?', child: 'Кто ребёнок?' };
    var exclude = [state.selected];
    if (kind === 'parent') parentsOf(state.selected).concat(childrenOf(state.selected)).forEach(function (id) { exclude.push(id); });

    el.modal.innerHTML =
      '<div class="modal-backdrop" data-close="1"></div>' +
      '<div class="modal">' +
        '<div class="modal-head"><h2>' + titles[kind] + '</h2>' +
          '<button class="panel-close" data-close="1">✕</button></div>' +
        '<div class="modal-body">' +
          '<input type="search" id="picker-search" placeholder="Найти в древе или впишите новое имя" autocomplete="off">' +
          '<div class="picker" id="picker-list"></div>' +
        '</div>' +
      '</div>';
    el.modal.classList.add('open');

    var input = document.getElementById('picker-search');
    var list = document.getElementById('picker-list');

    function draw() {
      var q = input.value.trim().toLowerCase();
      var found = state.people.filter(function (p) {
        if (exclude.indexOf(p.id) !== -1) return false;
        if (!q) return true;
        return fullName(p).toLowerCase().indexOf(q) !== -1;
      }).slice(0, 40);

      var items = found.map(function (p) {
        return '<button class="pick" data-id="' + p.id + '">' +
          '<span>' + escapeHtml(fullName(p)) + '</span><small>' + escapeHtml(yearsOf(p)) + '</small></button>';
      }).join('');

      var create = q && !found.some(function (p) { return fullName(p).toLowerCase() === q; })
        ? '<button class="pick create" data-new="' + escapeHtml(input.value.trim()) + '">Создать «' + escapeHtml(input.value.trim()) + '»</button>'
        : '';

      list.innerHTML = (create || '') + (items || '<div class="empty">Никого не нашлось</div>');

      Array.prototype.forEach.call(list.querySelectorAll('[data-id]'), function (btn) {
        btn.addEventListener('click', function () {
          closeModal();
          onPick(btn.dataset.id);
        });
      });

      var createBtn = list.querySelector('[data-new]');
      if (createBtn) createBtn.addEventListener('click', function () {
        var name = createBtn.dataset.new;
        snapshot();
        var parts = name.split(/\s+/);
        var person = createPerson({ last: parts.length > 1 ? parts[parts.length - 1] : '', first: parts[0] });
        save();
        closeModal();
        onPick(person.id);
      });
    }

    input.addEventListener('input', draw);
    draw();
    setTimeout(function () { input.focus(); }, 30);

    Array.prototype.forEach.call(el.modal.querySelectorAll('[data-close]'), function (node) {
      node.addEventListener('click', closeModal);
    });
  }

  function closeModal() {
    el.modal.classList.remove('open');
    el.modal.innerHTML = '';
  }

  function confirmDialog(opts) {
    el.modal.innerHTML =
      '<div class="modal-backdrop" data-close="1"></div>' +
      '<div class="modal small">' +
        '<div class="modal-head"><h2>' + escapeHtml(opts.title) + '</h2></div>' +
        '<div class="modal-body"><p class="modal-text">' + escapeHtml(opts.text) + '</p>' +
          '<div class="modal-actions">' +
            '<button class="btn ' + (opts.danger ? 'danger-solid' : 'primary') + '" id="confirm-yes">' + escapeHtml(opts.confirm || 'Да') + '</button>' +
            '<button class="btn" id="confirm-no">Отмена</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    el.modal.classList.add('open');

    document.getElementById('confirm-yes').addEventListener('click', function () {
      closeModal();
      opts.onConfirm();
    });
    document.getElementById('confirm-no').addEventListener('click', closeModal);
    Array.prototype.forEach.call(el.modal.querySelectorAll('[data-close]'), function (node) {
      node.addEventListener('click', closeModal);
    });
  }

  /* ==================== фото ==================== */

  el.photoInput.addEventListener('change', function () {
    var file = el.photoInput.files && el.photoInput.files[0];
    if (!file) return;
    if (!state.form) state.form = clone(byId(state.selected) || blankPerson());
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 420;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        state.form.photo = canvas.toDataURL('image/jpeg', 0.78);
        renderPanel();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  /* ==================== вид ==================== */

  var PAN_MARGIN = 120;   // сколько холста обязано остаться на экране

  /* Карта не уезжает за края: всегда видно часть холста. */
  function clampView() {
    var v = state.view;
    var L = state.layout;
    if (!L) return;

    var w = el.viewport.clientWidth;
    var h = el.viewport.clientHeight;
    var cw = L.width * v.s;
    var ch = L.height * v.s;

    var minX = PAN_MARGIN - cw;
    var maxX = w - PAN_MARGIN;
    var minY = PAN_MARGIN - ch;
    var maxY = h - PAN_MARGIN;

    v.x = minX > maxX ? (w - cw) / 2 : Math.min(maxX, Math.max(minX, v.x));
    v.y = minY > maxY ? (h - ch) / 2 : Math.min(maxY, Math.max(minY, v.y));
  }

  function applyView() {
    clampView();
    var v = state.view;
    // zoom пересобирает слой на каждом масштабе — текст остаётся резким.
    // transform только растягивает уже нарисованную картинку и мылит шрифт.
    if (CAN_ZOOM) {
      // при zoom собственные left/top тоже умножаются на масштаб
      el.canvas.style.left = (v.x / v.s) + 'px';
      el.canvas.style.top = (v.y / v.s) + 'px';
      el.canvas.style.zoom = v.s;
    } else {
      el.canvas.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.s + ')';
    }
    el.zoomValue.textContent = Math.round(v.s * 100) + '%';
  }

  function setScale(s, cx, cy) {
    var v = state.view;
    var next = Math.min(2.2, Math.max(0.12, s));
    if (cx === undefined) { cx = el.viewport.clientWidth / 2; cy = el.viewport.clientHeight / 2; }
    var wx = (cx - v.x) / v.s;
    var wy = (cy - v.y) / v.s;
    v.s = next;
    v.x = cx - wx * next;
    v.y = cy - wy * next;
    applyView();
  }

  function fit() {
    var L = state.layout;
    if (!L) return;
    var s = Math.min(el.viewport.clientWidth / L.width, el.viewport.clientHeight / L.height) * 0.94;
    state.view.s = Math.max(0.12, Math.min(1, s));
    state.view.x = (el.viewport.clientWidth - L.width * state.view.s) / 2;
    state.view.y = (el.viewport.clientHeight - L.height * state.view.s) / 2;
    applyView();
  }

  function centerOn(id, scale) {
    var L = state.layout;
    if (!L) return;
    var card = null;
    L.cards.forEach(function (c) { if (c.id === id) card = c; });
    if (!card) return;
    if (scale) state.view.s = Math.max(state.view.s, 0.8);
    var panelShift = el.panel.classList.contains('open') ? el.panel.offsetWidth / 2 : 0;
    state.view.x = el.viewport.clientWidth / 2 - panelShift - (card.x + card.w / 2) * state.view.s;
    state.view.y = el.viewport.clientHeight * 0.66 - (card.y + card.h / 2) * state.view.s;
    applyView();
  }

  // Стартовый вид: линия семьи крупно, левый край дерева у края экрана.
  // На телефоне — по центру карточки «это я», иначе половина дерева уезжает за экран.
  function startView() {
    var L = state.layout;
    if (!L) return;
    var self = state.people.filter(function (p) { return p.isSelf; })[0];
    var card = self ? L.cards.filter(function (c) { return c.id === self.id; })[0] : null;
    var cx = card ? card.x + card.w / 2 : L.width / 2;
    var cy = card ? card.y + card.h / 2 : L.height / 2;
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 720px)').matches : false;

    state.view.s = 0.78;

    if (narrow) {
      state.view.x = el.viewport.clientWidth / 2 - cx * state.view.s;
      state.view.y = el.viewport.clientHeight * 0.45 - cy * state.view.s;
    } else {
      state.view.x = Math.min(0, el.viewport.clientWidth / 2 - cx * state.view.s);
      state.view.y = Math.min(0, el.viewport.clientHeight * 0.78 - cy * state.view.s);
    }
    applyView();
  }

  /* ==================== мышь, палец и клавиатура ==================== */

  var drag = null;          // текущий перенос одним пальцем/мышью
  var pointers = {};        // активные касания: pointerId -> {x, y}
  var pinch = null;         // щипок: {dist, s}
  var moved = false;        // это перенос, а не нажатие

  function activePointers() {
    return Object.keys(pointers).map(function (id) { return pointers[id]; });
  }

  function stopEverything() {
    pointers = {};
    drag = null;
    pinch = null;
    el.viewport.classList.remove('dragging');
  }

  el.viewport.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { el.viewport.setPointerCapture(e.pointerId); } catch (err) { /* старый браузер */ }

    var count = Object.keys(pointers).length;

    if (count === 2) {
      /* второй палец: начинаем щипок, перенос отменяем */
      drag = null;
      var pair = activePointers();
      pinch = { dist: Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y), s: state.view.s };
      el.viewport.classList.add('dragging');
      return;
    }

    if (count > 2) return;

    moved = false;
    drag = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y };
    el.viewport.classList.add('dragging');

    if (e.pointerType === 'mouse') {
      /* гасим выделение текста, иначе оно перехватывает жест и перетаскивание «залипает» */
      e.preventDefault();
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.rangeCount) sel.removeAllRanges();
    }
  });

  el.viewport.addEventListener('pointermove', function (e) {
    if (pointers[e.pointerId]) {
      pointers[e.pointerId].x = e.clientX;
      pointers[e.pointerId].y = e.clientY;
    }

    if (pinch && Object.keys(pointers).length >= 2) {
      e.preventDefault();
      var pair = activePointers();
      var dist = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
      if (pinch.dist > 0) {
        var rect = el.viewport.getBoundingClientRect();
        var cx = (pair[0].x + pair[1].x) / 2 - rect.left;
        var cy = (pair[0].y + pair[1].y) / 2 - rect.top;
        setScale(pinch.s * (dist / pinch.dist), cx, cy);
        moved = true;
      }
      return;
    }

    if (!drag) return;

    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
    if (!moved) return;

    e.preventDefault();
    state.view.x = drag.vx + dx;
    state.view.y = drag.vy + dy;
    applyView();
  });

  function endPointer(e) {
    delete pointers[e.pointerId];

    var count = Object.keys(pointers).length;
    if (count < 2) pinch = null;

    if (count === 1) {
      /* после щипка остался палец — продолжаем перенос с него */
      var left = activePointers()[0];
      drag = { x: left.x, y: left.y, vx: state.view.x, vy: state.view.y };
      moved = true;
      return;
    }

    if (count === 0) {
      drag = null;
      el.viewport.classList.remove('dragging');
    }
  }

  el.viewport.addEventListener('pointerup', endPointer);
  el.viewport.addEventListener('pointercancel', endPointer);
  el.viewport.addEventListener('lostpointercapture', endPointer);
  window.addEventListener('blur', stopEverything);

  /* после переноса нажатие не должно открывать карточку человека */
  el.viewport.addEventListener('click', function (e) {
    if (!moved) return;
    moved = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  el.viewport.addEventListener('wheel', function (e) {
    e.preventDefault();
    var rect = el.viewport.getBoundingClientRect();
    setScale(state.view.s * Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  document.getElementById('zoom-in').addEventListener('click', function () { setScale(state.view.s * 1.2); });
  document.getElementById('zoom-out').addEventListener('click', function () { setScale(state.view.s / 1.2); });
  document.getElementById('zoom-fit').addEventListener('click', fit);
  document.getElementById('find-me').addEventListener('click', function () {
    var me = state.people.filter(function (p) { return p.isSelf; })[0];
    if (me) select(me.id, true); else toast('Себя в древе пока нет');
  });

  var kinBtn = document.getElementById('kin-toggle');
  if (kinBtn) {
    kinBtn.addEventListener('click', function () {
      state.kin = !state.kin;
      kinBtn.classList.toggle('on', state.kin);
      if (state.kin && !state.kinRef && state.selected) state.kinRef = state.selected;
      render();
      if (state.kin) {
        var ref = state.kinRef ? byId(state.kinRef) : null;
        toast(ref
          ? 'Подписи считаются относительно: ' + (ref.first || '') + ' ' + (ref.last || '') + '. Нажмите другого человека — пересчитаются'
          : 'Нажмите на человека — подписи родства посчитаются относительно него');
      }
    });
  }

  document.getElementById('legend-toggle').addEventListener('click', function (e) {
    e.stopPropagation();
    el.legend.classList.toggle('open');
  });

  document.getElementById('add-person').addEventListener('click', function () {
    state.mode = 'new';
    state.form = blankPerson();
    state.selected = null;
    el.panel.classList.add('open');
    renderPanel();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (el.modal.classList.contains('open')) closeModal();
    else closePanel();
  });

  /* ==================== поиск ==================== */

  function normalise(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е');
  }

  el.search.addEventListener('input', function () {
    var q = normalise(el.search.value).trim();
    if (!q) { el.results.classList.remove('open'); el.results.innerHTML = ''; return; }

    var found = state.people.filter(function (p) {
      return normalise([p.first, p.middle, p.last, p.maiden, p.born, p.died].join(' ')).indexOf(q) !== -1;
    }).slice(0, 9);

    if (!found.length) { el.results.classList.remove('open'); el.results.innerHTML = ''; return; }

    el.results.innerHTML = found.map(function (p) {
      return '<button data-id="' + p.id + '"><span>' + escapeHtml(fullName(p)) + '</span><small>' +
        escapeHtml(yearsOf(p)) + '</small></button>';
    }).join('');
    el.results.classList.add('open');

    Array.prototype.forEach.call(el.results.querySelectorAll('button'), function (btn) {
      btn.addEventListener('click', function () {
        select(btn.dataset.id, true);
        el.results.classList.remove('open');
        el.search.value = fullName(byId(btn.dataset.id));
      });
    });
  });

  el.search.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var first = el.results.querySelector('button');
      if (first) first.click();
    }
    if (e.key === 'Escape') { el.results.classList.remove('open'); el.search.blur(); }
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.search')) el.results.classList.remove('open');
    if (!e.target.closest('.drop-wrap')) el.legend.classList.remove('open');
  });

  /* ==================== файлы ==================== */

  document.getElementById('export').addEventListener('click', function () {
    var payload = { meta: DATA.meta, branches: state.branches, people: state.people, unions: state.unions };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'family-data.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Файл данных выгружен');
  });

  var importInput = document.getElementById('import');
  document.getElementById('import-label').addEventListener('click', function () { importInput.click(); });

  importInput.addEventListener('change', function () {
    var file = importInput.files && importInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed.people || !parsed.people.length) throw new Error('нет людей');
        snapshot();
        state.people = parsed.people;
        state.unions = parsed.unions || [];
        state.filter = null;
        save();
        render();
        closePanel();
        toast('Данные загружены', 'Вернуть', undoLast);
      } catch (err) {
        toast('Не удалось прочитать файл');
      }
    };
    reader.readAsText(file);
  });

  /* ==================== уведомление ==================== */

  var toastTimer = null;
  function toast(text, actionLabel, action) {
    el.toast.innerHTML = escapeHtml(text) + (actionLabel ? '<button id="toast-action">' + escapeHtml(actionLabel) + '</button>' : '');
    el.toast.classList.add('show');
    if (actionLabel) {
      document.getElementById('toast-action').addEventListener('click', function () {
        el.toast.classList.remove('show');
        action();
      });
    }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, actionLabel ? 6000 : 2400);
  }

  /* ==================== меню и «плюс» на телефоне ==================== */

  var topbar = document.querySelector('.topbar');
  var menuToggle = document.getElementById('menu-toggle');

  if (menuToggle) {
    menuToggle.addEventListener('click', function () {
      var open = topbar.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      menuToggle.textContent = open ? '✕' : '☰';
    });
  }

  var fabAdd = document.getElementById('fab-add');
  if (fabAdd) {
    fabAdd.addEventListener('click', function () {
      document.getElementById('add-person').click();
    });
  }

  /* ==================== старт ==================== */

  load();
  render();

  var hash = decodeURIComponent(location.hash.replace('#', ''));
  if (hash === 'fit') {
    fit();
  } else if (hash && byId(hash)) {
    select(hash, true);
  } else {
    startView();
  }

  window.addEventListener('resize', function () {
    applyView();
  });

  /* подсказка при первом заходе с телефона */
  if (window.matchMedia && window.matchMedia('(max-width: 720px)').matches) {
    try {
      if (!localStorage.getItem('family-tree-hint')) {
        localStorage.setItem('family-tree-hint', '1');
        setTimeout(function () {
          toast('Тяните карту пальцем · касание карточки — открыть · «+» — добавить человека');
        }, 1500);
      }
    } catch (e) { /* приватный режим — просто без подсказки */ }
  }

  pullRemote();
})();
