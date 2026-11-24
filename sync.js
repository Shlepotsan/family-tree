/* sync.js — общая база через Google Apps Script.
   Без адреса в sync-config.js ничего не делает: сайт остаётся офлайновым.
   Фотографии в таблицу не уходят (у ячейки лимит 50 000 знаков) — они остаются
   в браузере, а при загрузке правок из таблицы подставляются прежние. */

(function () {
  'use strict';

  var cfg = window.SYNC_CONFIG || {};
  var URL = cfg.url || '';
  var MARK = 'family-tree-remote-updated';

  var timer = null;
  var pending = null;
  var busy = false;

  function pack(data) {
    return {
      people: (data.people || []).map(function (p) {
        var copy = {};
        for (var k in p) {
          if (Object.prototype.hasOwnProperty.call(p, k) && k !== 'photo') copy[k] = p[k];
        }
        return copy;
      }),
      unions: data.unions || []
    };
  }

  function request(payload) {
    return fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (r) {
      return r.text();
    }).then(function (text) {
      var out;
      try {
        out = JSON.parse(text);
      } catch (e) {
        throw new Error('ответ сервера не разобран');
      }
      if (!out || !out.ok) throw new Error((out && out.error) || 'сервер вернул ошибку');
      return out;
    });
  }

  function pull() {
    if (!URL) return Promise.resolve(null);
    return request({ action: 'get' }).then(function (out) {
      var d = out.data || {};
      return { people: d.people || [], unions: d.unions || [], updated: d.updated || '' };
    });
  }

  function queue(data) {
    if (!URL) return;
    pending = pack(data);
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }

  function flush() {
    if (!URL || !pending || busy) return;
    busy = true;
    var data = pending;
    request({ action: 'save', key: cfg.key || '', data: data }).then(function (out) {
      pending = null;
      if (out.updated) setMark(out.updated);
      window.FamilySync.status = 'saved ' + new Date().toLocaleTimeString();
    }).catch(function (err) {
      window.FamilySync.status = 'ошибка: ' + (err && err.message ? err.message : err);
      console.warn('Не удалось сохранить в общую таблицу:', err);
      timer = setTimeout(flush, 5000);
    }).then(function () {
      busy = false;
      if (pending && timer === null) timer = setTimeout(flush, 3000);
    });
  }

  function mark() {
    try { return localStorage.getItem(MARK) || ''; } catch (e) { return ''; }
  }

  function setMark(value) {
    try { localStorage.setItem(MARK, value || ''); } catch (e) { /* приватный режим */ }
  }

  window.FamilySync = {
    enabled: !!URL,
    pull: pull,
    queue: queue,
    mark: mark,
    setMark: setMark,
    status: 'ожидание'
  };
})();
