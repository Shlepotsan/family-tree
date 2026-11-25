/* Собирает PEOPLE.md — полный справочник по людям из data.js.
   Запуск: node tools/people-md.js  (из корня проекта или из tools/) */
global.window = global;
global.localStorage = { getItem: function () { return null; }, setItem: function () {} };

var path = require('path');
var fs = require('fs');
var root = path.join(__dirname, '..');
require(path.join(root, 'data.js'));
require(path.join(root, 'layout.js'));

var fam = window.FAMILY;
var L = window.FamilyLayout.compute(fam);

var byId = {};
fam.people.forEach(function (p) { byId[p.id] = p; });

var layerOf = {};
L.cards.forEach(function (c) { layerOf[c.id] = c.layer; });

/* ---------- связи ---------- */
var parentsOf = {}, childrenOf = {}, spouseOf = {};
fam.unions.forEach(function (u) {
  var ps = (u.partners || []).filter(Boolean);
  u.children.forEach(function (cid) {
    (parentsOf[cid] = parentsOf[cid] || []).push({ union: u, partners: ps });
  });
  ps.forEach(function (id) {
    (childrenOf[id] = childrenOf[id] || []).push.apply(childrenOf[id], u.children);
  });
  if (ps.length === 2) {
    (spouseOf[ps[0]] = spouseOf[ps[0]] || []).push({ id: ps[1], union: u });
    (spouseOf[ps[1]] = spouseOf[ps[1]] || []).push({ id: ps[0], union: u });
  }
});

/* ---------- форматирование ---------- */
function nm(p) {
  if (!p) return '?';
  var parts = [p.last, p.first, p.middle].filter(function (x) { return x && x.trim(); });
  var s = parts.join(' ').trim();
  if (!s) s = p.id;
  var years = [];
  if (p.born) years.push('р. ' + p.born);
  if (p.died) years.push('† ' + p.died);
  return years.length ? s + ' (' + years.join(', ') + ')' : s;
}
function nmShort(id) { return nm(byId[id]); }
function cell(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|'); }
function list(arr) { return arr.filter(Boolean).join(', '); }

var branchTitle = {};
Object.keys(fam.branches).forEach(function (k) { branchTitle[k] = fam.branches[k].title; });

/* ---------- статистика ---------- */
var stats = {
  total: fam.people.length,
  unions: fam.unions.length,
  withBorn: fam.people.filter(function (p) { return p.born; }).length,
  withDied: fam.people.filter(function (p) { return p.died; }).length,
  withParents: fam.people.filter(function (p) { return parentsOf[p.id]; }).length,
  noParents: fam.people.filter(function (p) { return !parentsOf[p.id]; }),
  placeholders: fam.people.filter(function (p) { return /Имя неизвестно|Ребёнок/.test((p.first || '') + (p.middle || '')); }),
  perBranch: {}
};
fam.people.forEach(function (p) { stats.perBranch[p.branch] = (stats.perBranch[p.branch] || 0) + 1; });

var sourceCount = {};
fam.people.forEach(function (p) {
  (p.sources || []).forEach(function (s) { sourceCount[s] = (sourceCount[s] || 0) + 1; });
});

var out = [];
function w(line) { out.push(line === undefined ? '' : line); }

var today = new Date().toISOString().slice(0, 10);

w('# Люди древа — полный справочник');
w();
w('Собрано из `data.js` автоматически: **' + stats.total + ' человек, ' + stats.unions +
  ' союзов, ' + Object.keys(fam.branches).length + ' ветвей**.');
w('Снимок на ' + today + '. Файл пересобирается командой `node tools/people-md.js` —');
w('руками не править, иначе разойдётся с древом.');
w();
w('| | |');
w('|---|---|');
w('| Людей | ' + stats.total + ' |');
w('| Союзов (браков и одиночных родителей) | ' + stats.unions + ' |');
w('| С годом рождения | ' + stats.withBorn + ' |');
w('| С датой смерти | ' + stats.withDied + ' |');
w('| С известными родителями | ' + stats.withParents + ' |');
w('| Карточек-заглушек («Имя неизвестно», «Ребёнок») | ' + stats.placeholders.length + ' |');
w();

w('## Как читать');
w();
w('- **Поколение 1** — самые старшие в записях, дальше по возрастанию.');
w('- Даты — как в источнике, вместе с его оговорками: «188…», «1903 ?», «февраль 1974».');
w('- **Родители / Супруг / Дети** — только те связи, что есть в древе (поле `unions` в `data.js`).');
w('- **Примечание** — расхождения источников, опечатки, догадки. Это не «мусор»:');
w('  по правилу проекта спорное не исправляется молча, а показывается.');
w('- **Источники** — откуда взялась карточка. Полный разбор источников — в конце файла.');
w();

w('## Ветви');
w();
w('| Ветвь | Людей | Цвет |');
w('|---|---|---|');
Object.keys(fam.branches).forEach(function (k) {
  w('| ' + cell(fam.branches[k].title) + ' | ' + (stats.perBranch[k] || 0) + ' | `' + fam.branches[k].color + '` |');
});
w('| **Всего** | **' + stats.total + '** | |');
w();

w('## Люди по ветвям');
w();

var inSomeUnion = {};
fam.unions.forEach(function (u) {
  (u.partners || []).forEach(function (id) { inSomeUnion[id] = true; });
  (u.children || []).forEach(function (id) { inSomeUnion[id] = true; });
});
function isLoose(p) { return !inSomeUnion[p.id]; }

Object.keys(fam.branches).forEach(function (br) {
  var people = fam.people.filter(function (p) { return p.branch === br; });
  if (!people.length) return;
  people.sort(function (a, b) {
    var la = isLoose(a) ? 1 : 0, lb = isLoose(b) ? 1 : 0;
    if (la !== lb) return la - lb;
    var ga = layerOf[a.id] || 0, gb = layerOf[b.id] || 0;
    if (ga !== gb) return ga - gb;
    return nm(a).localeCompare(nm(b), 'ru');
  });

  w('### ' + fam.branches[br].title + ' — ' + people.length);
  w();

  people.forEach(function (p) {
    var gen = (layerOf[p.id] || 0) + 1;
    w('#### ' + nm(p));
    w();
    w('- **id**: `' + p.id + '` · **пол**: ' + (p.sex === 'f' ? 'женский' : 'мужской') +
      ' · **ветвь**: ' + branchTitle[p.branch] +
      (isLoose(p) ? ' · **связь с древом не установлена**' : ' · **поколение**: ' + gen) +
      (p.isSelf ? ' · **это я, автор страницы**' : ''));
    if (p.maiden) w('- **Девичья фамилия**: ' + p.maiden);
    if (p.born) w('- **Рождение**: ' + p.born + (p.bornPlace ? ', ' + p.bornPlace : ''));
    if (p.died) w('- **Смерть**: ' + p.died + (p.diedPlace ? ', ' + p.diedPlace : ''));
    if (!p.born && !p.died) w('- **Даты**: в записях нет');

    var par = parentsOf[p.id];
    if (par && par.length) {
      var ps = par[0].partners.map(nmShort);
      w('- **Родители**: ' + list(ps) + (par.length > 1 ? ' (в записях больше одного родительского союза)' : ''));
    } else {
      w('- **Родители**: в записях не установлены');
    }

    var sp = spouseOf[p.id] || [];
    if (sp.length) {
      w('- **Супруг(а)**: ' + sp.map(function (s) {
        return nmShort(s.id) + (s.union.note ? ' — ' + s.union.note : '') +
          (s.union.type === 'childless' ? ' (детей нет)' : '');
      }).join('; '));
    } else if (!childrenOf[p.id] || !childrenOf[p.id].length) {
      w('- **Супруг(а)**: нет данных');
    }

    var ch = childrenOf[p.id] || [];
    if (ch.length) w('- **Дети**: ' + ch.map(nmShort).join(', '));

    if (p.bio) w('- **Биография**: ' + p.bio);
    if (p.facts && p.facts.length) {
      w('- **Факты**:');
      p.facts.forEach(function (f) { w('  - ' + (f[0] ? '**' + f[0] + '**: ' : '') + f[1]); });
    }
    if (p.note) w('- **Примечание**: ' + p.note);
    if (p.siblingOf && p.siblingOf.length) w('- **Указан братом/сестрой**: ' + p.siblingOf.map(nmShort).join(', '));
    if (p.sources && p.sources.length) w('- **Источники**: ' + p.sources.join('; '));
    w();
  });
});

/* ---------- роспись ---------- */
w('## Роспись по поколениям');
w();
w('Та же информация, но деревом — удобно проверять, кто чей. Отступ — поколение.');
w();

var roots = fam.people.filter(function (p) { return !parentsOf[p.id]; })
  .sort(function (a, b) {
    var la = layerOf[a.id] || 0, lb = layerOf[b.id] || 0;
    if (la !== lb) return la - lb;
    return nm(a).localeCompare(nm(b), 'ru');
  });

var seen = {};
function walk(id, depth) {
  if (seen[id]) return;
  seen[id] = true;
  var p = byId[id];
  var sp = (spouseOf[id] || []).map(function (s) { return s.id; });
  sp.forEach(function (sid) { seen[sid] = true; });
  var line = nm(p);
  if (sp.length) line += '  +  ' + sp.map(nmShort).join(' + ');
  w(new Array(depth + 1).join('  ') + '- ' + line);
  var kids = [];
  fam.unions.forEach(function (u) {
    if (u.partners.indexOf(id) === -1) return;
    u.children.forEach(function (cid) { if (kids.indexOf(cid) === -1) kids.push(cid); });
  });
  kids.forEach(function (cid) { walk(cid, depth + 1); });
}
roots.forEach(function (p) { walk(p.id, 0); });

w();
fam.people.forEach(function (p) {
  if (!seen[p.id]) {
    w('- ' + nm(p) + '  *(связь с деревом не установлена)*');
    seen[p.id] = true;
  }
});
w();

/* ---------- источники ---------- */
w('## Источники');
w();
w('### Документы Word, добавленные в репозиторий (ноябрь 2026)');
w();
w('Файлы лежат в `sources/` как есть, без правок:');
w();
w('| Файл | Формат | Знаков текста | Что внутри |');
w('|---|---|---|---|');
w('| `sources/Дмитриевы.doc` | Word 97-2003 (.doc) | 2098 | Никанор Афонасьевич Дмитриев, два брака, его потомки |');
w('| `sources/Романовы.doc` | Word 97-2003 (.doc) | 3568 | Ломовы, Романовы, Мочаловы, Киселёвы, Дорофеевы, Дитятьевы, Никитины |');
w();
w('Как читались: это старый бинарный формат, поэтому текст извлечён напрямую из');
w('OLE-контейнера с разбором таблицы фрагментов (piece table), а не конвертером.');
w('Полнота проверена по внутреннему счётчику знаков Word: 2098 и 3568 — ровно');
w('столько, сколько хранит документ. Сносок, колонтитулов и надписей в них нет,');
w('то есть терять было нечего.');
w();
w('### Прочие источники');
w();
var SOURCE_DESC = {
  'Дмитриевы.doc': 'ветвь Дмитриевых: Никанор Афонасьевич и потомки',
  'Романовы.doc': 'Ломовы, Романовы и их потомки до 2010-х',
  'Генеалогическое древо семьи (2).docx': 'прежний основной документ древа',
  'Генеалогическое древо семьи.docx': 'прежний документ древа',
  'Генеалогическое древо V1.docx': 'прежний документ, первая версия',
  'Генеалогическое древо.docx': 'прежний документ древа',
  'Про родственников со слов Надежды Деяновой.docx': 'воспоминания Надежды Деяновой',
  'Родственники ВОВ.docx': 'участники Великой Отечественной войны',
  'Список гостей на свадьбу (2026)': 'родня невесты, без дат и отчеств',
  'Рассказ Екатерины Усачёвой (2026)': 'устно: дед и бабушка по отцу, брат Олег',
  'ВК: slava_shlepov': 'профиль ВКонтакте',
  'ВК: id759645145': 'профиль ВКонтакте'
};

w('| Источник | Что дал | Людей |');
w('|---|---|---|');
Object.keys(sourceCount).sort(function (a, b) { return sourceCount[b] - sourceCount[a]; })
  .forEach(function (s) {
    w('| ' + cell(s) + ' | ' + cell(SOURCE_DESC[s] || '—') + ' | ' + sourceCount[s] + ' |');
  });
w();
w('Пояснения к неочевидным:');
w();
w('- **Список гостей на свадьбу (2026)** — перечень родни на свадьбу Леонида и Екатерины;');
w('  оттуда пришли Усачёвы, Киселёвы, Головановы, Стрижеусы, Демидовы, но без дат.');
w('- **Рассказ Екатерины Усачёвой (2026)** — устные сведения: родители её отца');
w('  (Алексей Михайлович и Любовь Николаевна) и то, что Олег — родной брат Алексея.');
w('  В документах этого нет, поэтому помечено отдельным источником.');
w('- **Генеалогическое древо семьи (2).docx** и другие `.docx` — прежняя основа древа:');
w('  Шлёповы, Лысовы, Мурзины, Володины, Морозовы, Деяновы, Ратниковы, Пушкины.');
w('- **Родственники ВОВ.docx** — участники Великой Отечественной войны.');
w('- **Книга памяти Владимирской обл., ЕГРИП/ЕГРЮЛ, ВК** — только для раздела «не доказано».');
w();

/* ---------- расхождения ---------- */
w('## Расхождения, опечатки и открытые вопросы');
w();
w('Сначала главное — то, что реально требовало решения. Потом полный список');
w('примечаний по карточкам (там же пометки у заглушек).');
w();
w('### Главное');
w();
w('1. **Фекола / Фёкла** — в документе «Фекола», в древе так и оставлено.');
w('2. **Никонорович / Никанорович** — отец Никанор, дети записаны по-разному;');
w('   принято «Никанорович», расхождение описано у отца.');
w('3. **«!905 г.р.»** у Софьи Лебедевой — опечатка, прочитано как 1905.');
w('4. **«Леодор»** — имя сына Анны Никаноровны, оставлено как в документе.');
w('5. **«Кёнинскберг»** — так в документе; в тексте карточки Кёнигсберг, опечатка отмечена.');
w('6. **Две Александры Алексеевны Ломовы** — от первого брака (умерла) и от второго');
w('   (20.11.1912). Разные карточки, в примечаниях предупреждение.');
w('7. **Валентина Алексеевна (02.11.1945)** — её нет в перечне детей Алексея Ивановича,');
w('   но она описана в том же разделе с отчеством Алексеевна; показана дочерью с оговоркой.');
w('8. **Отчество Алексея Алексеевича Усачёва** — вопрос закрыт: деда зовут Алексей');
w('   Михайлович, поэтому «Алексеевич» верно и документ править не нужно.');
w('9. **Любовь Николаевна Усачёва** — в списке гостей линия родства не была указана;');
w('   теперь известно, что она мать Алексея и Олега (со слов Екатерины).');
w('10. **Олег Усачёв** — брат Алексея по рассказу, а не по документу; поэтому в карточке');
w('    это помечено, хотя в древе он показан сыном той же пары.');
w();
w('### Все примечания по карточкам');
w();
w('Включая заглушки: у них примечание объясняет, что именно неизвестно.');
w();
var noted = fam.people.filter(function (p) { return p.note; });
noted.sort(function (a, b) { return nm(a).localeCompare(nm(b), 'ru'); });
noted.forEach(function (p) {
  w('- **' + nm(p) + '** — ' + p.note);
});
w();

/* ---------- недоказанное ---------- */
if (fam.candidates && fam.candidates.length) {
  w('## Найдено в исследовании, но родство не доказано');
  w();
  w('В древо эти люди **не включены** — лежат отдельным списком `candidates` в `data.js`.');
  w();
  w('| Кто | Год / место | Факт | Почему не в древе |');
  w('|---|---|---|---|');
  fam.candidates.forEach(function (c) {
    w('| ' + cell(c.name) + ' | ' + cell((c.born || '') + (c.place ? ', ' + c.place : '')) +
      ' | ' + cell(c.fact) + ' | ' + cell(c.why) + ' |');
  });
  w();
}

/* ---------- пробелы ---------- */
function byBranch(people) {
  var map = {};
  people.forEach(function (p) { (map[p.branch] = map[p.branch] || []).push(p); });
  var keys = Object.keys(map).sort(function (a, b) {
    return (branchTitle[a] || a).localeCompare(branchTitle[b] || b, 'ru');
  });
  keys.forEach(function (k) {
    w('- **' + (branchTitle[k] || k) + '**: ' + map[k].map(function (p) {
      return nm(p) + ' (`' + p.id + '`)';
    }).join(', '));
  });
}

var noBorn = fam.people.filter(function (p) { return !p.born; });

w('## Чего не хватает в записях');
w();
w('### Без года рождения — ' + noBorn.length);
w();
byBranch(noBorn);
w();
w('### Без установленных родителей — ' + stats.noParents.length);
w();
byBranch(stats.noParents);
w();
w('### Карточки-заглушки — ' + stats.placeholders.length);
w();
byBranch(stats.placeholders);
w();

fs.writeFileSync(path.join(root, 'PEOPLE.md'), out.join('\n') + '\n', 'utf8');
console.log('PEOPLE.md: людей', stats.total, '| строк', out.length,
  '| без года рождения', noBorn.length, '| без родителей', stats.noParents.length,
  '| заглушек', stats.placeholders.length);
