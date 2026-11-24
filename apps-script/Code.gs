/**
 * «Древо семьи Шлёповых и Володиных» — общая база в Google-таблице.
 *
 * Как это работает:
 *   сайт на GitHub Pages при открытии забирает данные из этой таблицы,
 *   а каждое сохранение отправляет обратно.
 *
 * Листы:
 *   «Люди»   — по строке на человека;
 *   «Союзы»  — по строке на брак или одиночного родителя;
 *   «_meta»  — служебное: updated (когда менялось) и key (ключ редактора).
 *
 * Родня может править «Люди» и «Союзы» прямо в таблице — сайт это подхватит.
 */

var PEOPLE_SHEET = 'Люди';
var UNIONS_SHEET = 'Союзы';
var META_SHEET = '_meta';

var PEOPLE_HEAD = ['id', 'Имя', 'Отчество', 'Фамилия', 'Девичья', 'Пол', 'Ветвь', 'Рождение',
  'Смерть', 'Место рождения', 'Место смерти', 'Биография', 'Примечание',
  'Факты (JSON)', 'Источники (JSON)', 'Это я'];

var PEOPLE_KEYS = ['id', 'first', 'middle', 'last', 'maiden', 'sex', 'branch', 'born',
  'died', 'bornPlace', 'diedPlace', 'bio', 'note', 'facts', 'sources', 'isSelf'];

var UNION_HEAD = ['id', 'Партнёр 1', 'Партнёр 2', 'Дети', 'Тип', 'Примечание'];
var UNION_KEYS = ['id', 'partner1', 'partner2', 'children', 'type', 'note'];

/* ==================== точки входа ==================== */

function doGet(e) {
  try {
    return json({ ok: true, data: readAll() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = {};
    if (e && e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    var action = body.action || 'get';

    if (action === 'get') {
      return json({ ok: true, data: readAll() });
    }

    if (action === 'save') {
      if (String(body.key || '') !== editorKey()) {
        return json({ ok: false, error: 'неверный ключ редактора' });
      }
      writeAll(body.data || {});
      return json({ ok: true, updated: readAll().updated });
    }

    return json({ ok: false, error: 'неизвестное действие: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ==================== чтение ==================== */

function readAll() {
  var ss = SpreadsheetApp.getActive();
  ensureSheets(ss);
  return {
    people: readPeople(ss),
    unions: readUnions(ss),
    updated: metaGet(ss, 'updated') || ''
  };
}

function readPeople(ss) {
  var sh = ss.getSheetByName(PEOPLE_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return [];

  var values = sh.getRange(2, 1, last - 1, PEOPLE_HEAD.length).getValues();
  var out = [];

  values.forEach(function (row) {
    var id = cell(row[0]);
    if (!id) return;

    var person = { id: id };
    for (var i = 1; i < PEOPLE_KEYS.length; i++) {
      var key = PEOPLE_KEYS[i];
      var value = row[i];
      if (value === '' || value === null || value === undefined) continue;

      if (key === 'facts' || key === 'sources') {
        person[key] = parseJson(value, []);
      } else if (key === 'isSelf') {
        person[key] = isTrue(value);
      } else {
        person[key] = cell(value);
      }
    }
    out.push(person);
  });

  return out;
}

function readUnions(ss) {
  var sh = ss.getSheetByName(UNIONS_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return [];

  var values = sh.getRange(2, 1, last - 1, UNION_HEAD.length).getValues();
  var out = [];

  values.forEach(function (row) {
    var id = cell(row[0]);
    if (!id) return;

    var union = { id: id, partners: [], children: [] };

    if (cell(row[1])) union.partners.push(cell(row[1]));
    if (cell(row[2])) union.partners.push(cell(row[2]));

    cell(row[3]).split(',').forEach(function (raw) {
      var child = raw.trim();
      if (child) union.children.push(child);
    });

    if (cell(row[4])) union.type = cell(row[4]);
    if (cell(row[5])) union.note = cell(row[5]);

    out.push(union);
  });

  return out;
}

/* ==================== запись ==================== */

function writeAll(data) {
  var ss = SpreadsheetApp.getActive();
  ensureSheets(ss);

  writePeople(ss, data.people || []);
  writeUnions(ss, data.unions || []);
  metaSet(ss, 'updated', new Date().toISOString());
}

function writePeople(ss, people) {
  var sh = ss.getSheetByName(PEOPLE_SHEET);
  var rows = people.map(function (person) {
    return PEOPLE_KEYS.map(function (key) {
      var value = person[key];
      if (key === 'facts' || key === 'sources') return JSON.stringify(value || []);
      if (key === 'isSelf') return value ? 'да' : '';
      return value === null || value === undefined ? '' : String(value);
    });
  });

  clearBody(sh);
  if (!rows.length) return;

  var range = sh.getRange(2, 1, rows.length, PEOPLE_HEAD.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

function writeUnions(ss, unions) {
  var sh = ss.getSheetByName(UNIONS_SHEET);
  var rows = unions.map(function (union) {
    var partners = union.partners || [];
    return [
      union.id || '',
      partners[0] || '',
      partners[1] || '',
      (union.children || []).join(', '),
      union.type || '',
      union.note || ''
    ];
  });

  clearBody(sh);
  if (!rows.length) return;

  var range = sh.getRange(2, 1, rows.length, UNION_HEAD.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

function clearBody(sh) {
  var rows = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, 1, rows, sh.getMaxColumns()).clearContent();
}

/* ==================== служебное ==================== */

function ensureSheets(ss) {
  ensureSheet(ss, PEOPLE_SHEET, PEOPLE_HEAD);
  ensureSheet(ss, UNIONS_SHEET, UNION_HEAD);
  ensureSheet(ss, META_SHEET, ['ключ', 'значение']);

  if (!metaGet(ss, 'key')) metaSet(ss, 'key', Utilities.getUuid().slice(0, 8));
}

function ensureSheet(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;

  sh = ss.insertSheet(name);
  var range = sh.getRange(1, 1, 1, head.length);
  range.setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function metaGet(ss, key) {
  var sh = ss.getSheetByName(META_SHEET);
  if (!sh || sh.getLastRow() < 2) return '';
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === key) return String(values[i][1]);
  }
  return '';
}

function metaSet(ss, key, value) {
  var sh = ss.getSheetByName(META_SHEET);
  var last = sh.getLastRow();
  var values = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === key) {
      sh.getRange(i + 2, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

function editorKey() {
  return metaGet(SpreadsheetApp.getActive(), 'key');
}

function cell(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function parseJson(text, fallback) {
  try {
    var parsed = JSON.parse(String(text));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function isTrue(value) {
  var text = String(value).toLowerCase().trim();
  return text === 'да' || text === 'true' || text === 'истина' || text === '1';
}

/* ==================== разовая настройка ==================== */

/**
 * Запустите эту функцию один раз вручную (Run → setup).
 * Она создаст листы, шапки и ключ редактора, а в журнале покажет этот ключ.
 */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ensureSheets(ss);
  metaSet(ss, 'updated', new Date().toISOString());
  Logger.log('Ключ редактора: ' + editorKey());
  Logger.log('Листы готовы: ' + PEOPLE_SHEET + ', ' + UNIONS_SHEET + ', ' + META_SHEET);
}
