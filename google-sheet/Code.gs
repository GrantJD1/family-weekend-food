/**
 * Shared storage for the Weekend Food site, kept in this Google Sheet.
 *
 * Set-up: in the Sheet choose Extensions → Apps Script, replace everything with this file, save,
 * then Deploy → New deployment → type "Web app", Execute as "Me", Who has access "Anyone" → Deploy.
 * Copy the Web app URL into SHEET_URL at the top of js/app.js.
 * After changing this file: Deploy → Manage deployments → Edit → Version "New version" → Deploy
 * (the web address stays the same).
 *
 * The site sends small changes ("add this", "tick that"); they are applied one at a time under a
 * lock, so two people editing at once never overwrite each other. The "Shopping list", "Meals" and
 * "Who's coming" tabs are rewritten after every change so you can read everything here too.
 */
const ITEMS_TAB = 'Shopping list';
const MEALS_TAB = 'Meals';
const WHO_TAB = "Who's coming";
const ITEM_HEAD = ['Food', 'Aisle', 'Get it by', 'Quantity', 'When', 'Ticked', 'id', 'data'];
const MEAL_HEAD = ['Meal time', 'Meal name', 'slot'];
const SLOTS = {
  pool: 'Not planned', fe: 'Friday evening', sm: 'Saturday morning', sl: 'Saturday lunch', se: 'Saturday evening', sb: 'Sunday breakfast',
  dk: 'Drinks', sk: 'Snacks', mi: 'Miscellaneous'
};
const MEAL_SLOTS = ['fe', 'sm', 'sl', 'se', 'sb'];
const AISLES = {
  fv: 'Fruit & Veg', ba: 'Bakery', me: 'Meat & Poultry', fi: 'Fish & Seafood', da: 'Dairy & Eggs', ch: 'Chilled & Deli',
  cu: 'Food Cupboard', sp: 'Herbs, Spices & Sauces', sn: 'Snacks & Sweets', dr: 'Drinks', fr: 'Frozen', ho: 'Household'
};

// Who's coming – keep in step with the WHO_* lists at the top of js/app.js
const WHO_DAYS = [['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const WHO_MEALS = ['Breakfast', 'Lunch', 'Dinner'];
const WHO_PEOPLE = [['Dad', 'Rita', 'Rob', 'Faye', 'Emilia', 'Anwen', 'Benji'], ['Hannah', 'Mowgli', 'James', 'Sophie', 'Marie', 'Nick', 'Chris', 'Nicky']];
const WHO_DEFAULT = { 'Breakfast|fri': 'No', 'Lunch|fri': 'No' }; // everything else starts as Yes
const WHO_ROWS = WHO_MEALS.concat(WHO_PEOPLE[0], WHO_PEOPLE[1]);

function doGet() {
  return out_(load_());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const state = load_();
    const ops = JSON.parse(e.postData.contents).ops || [];
    ops.forEach(op => apply_(state, op));
    save_(state);
    return out_(state);
  } finally {
    lock.releaseLock();
  }
}

function apply_(s, op) {
  if (op.t === 'put') s.items[op.id] = op.it;
  else if (op.t === 'patch') { if (s.items[op.id]) Object.assign(s.items[op.id], op.f); }
  else if (op.t === 'del') delete s.items[op.id];
  else if (op.t === 'meal') { if (op.name) s.meals[op.slot] = String(op.name).slice(0, 60); else delete s.meals[op.slot]; }
  else if (op.t === 'who') {
    const [row, day] = String(op.k).split('|');
    if (WHO_ROWS.indexOf(row) >= 0 && WHO_DAYS.some(d => d[0] === day) && ['Yes', 'No', ''].indexOf(op.v) >= 0) s.who[op.k] = op.v;
  }
}

function tab_(name, head) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(sh, width) {
  return sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
}

const yesNo_ = v => (/^y/i.test(String(v).trim()) ? 'Yes' : /^n/i.test(String(v).trim()) ? 'No' : '');

function load_() {
  const items = {}, meals = {}, who = {};
  rows_(tab_(ITEMS_TAB, ITEM_HEAD), ITEM_HEAD.length).forEach(r => {
    if (r[6]) { try { items[r[6]] = JSON.parse(r[7]); } catch (err) { /* skip a damaged row */ } }
  });
  // meal names can also be typed straight into the Meals tab
  rows_(tab_(MEALS_TAB, MEAL_HEAD), MEAL_HEAD.length).forEach(r => { if (r[2] && r[1]) meals[r[2]] = String(r[1]); });

  const wsh = SpreadsheetApp.getActive().getSheetByName(WHO_TAB);
  if (wsh) {
    // Yes/No can also be changed straight in the Who's coming tab
    rows_(wsh, 1 + WHO_DAYS.length).forEach(r => {
      if (WHO_ROWS.indexOf(r[0]) >= 0) WHO_DAYS.forEach(([d], i) => { who[r[0] + '|' + d] = yesNo_(r[i + 1]); });
    });
  } else {
    WHO_ROWS.forEach(row => WHO_DAYS.forEach(([d]) => { const k = row + '|' + d; who[k] = WHO_DEFAULT[k] || 'Yes'; }));
  }
  return { items, meals, who };
}

// stop text like "=SUM(...)" being treated as a formula
const safe_ = v => (/^[=+\-@]/.test(String(v)) ? "'" + v : v);

function qty_(x) {
  if (x.u === 'n') return '×' + x.q;
  return x.q + (x.q === 1 ? ' pack' : ' packs') + (x.p ? ' of ' + x.p : '');
}

function save_(s) {
  const it = tab_(ITEMS_TAB, ITEM_HEAD);
  const rows = Object.keys(s.items)
    .map(id => [id, s.items[id]])
    .sort((a, b) => (a[1].t || 0) - (b[1].t || 0))
    .map(([id, x]) => [safe_(x.n), AISLES[x.cat] || '', x.m === 'bring' ? 'Bringing' : 'Buying', qty_(x),
      (SLOTS[x.slot] || 'Not planned') + (s.meals[x.slot] ? ' – ' + s.meals[x.slot] : ''), x.done ? '✓' : '', id, JSON.stringify(x)]);
  if (it.getLastRow() > 1) it.getRange(2, 1, it.getLastRow() - 1, ITEM_HEAD.length).clearContent();
  if (rows.length) it.getRange(2, 1, rows.length, ITEM_HEAD.length).setValues(rows);

  const ml = tab_(MEALS_TAB, MEAL_HEAD);
  const mrows = MEAL_SLOTS.map(k => [SLOTS[k], safe_(s.meals[k] || ''), k]);
  if (ml.getLastRow() > 1) ml.getRange(2, 1, ml.getLastRow() - 1, MEAL_HEAD.length).clearContent();
  ml.getRange(2, 1, mrows.length, MEAL_HEAD.length).setValues(mrows);

  saveWho_(s.who);
}

// Who's coming tab, laid out like the family spreadsheet: meals, then the two groups of people, then totals
function saveWho_(who) {
  const isNew = !SpreadsheetApp.getActive().getSheetByName(WHO_TAB);
  const sh = tab_(WHO_TAB, [''].concat(WHO_DAYS.map(d => d[1])));
  const cells = row => WHO_DAYS.map(([d]) => who[row + '|' + d] || '');
  const blank = [''].concat(WHO_DAYS.map(() => ''));
  const values = [];
  WHO_MEALS.forEach(r => values.push([r].concat(cells(r))));
  values.push(blank);
  const first = values.length + 2; // sheet row of the first person
  WHO_PEOPLE.forEach((group, i) => {
    if (i) values.push(blank);
    group.forEach(p => values.push([p].concat(cells(p))));
  });
  const last = values.length + 1;
  values.push(blank);
  values.push(['Total people'].concat(WHO_DAYS.map((d, i) => {
    const col = String.fromCharCode(66 + i);
    return '=COUNTIF(' + col + first + ':' + col + last + ',"Yes")';
  })));
  sh.getRange(2, 1, values.length, values[0].length).setValues(values);
  if (isNew) {
    const yn = SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).setAllowInvalid(false).build();
    sh.getRange(2, 2, last - 1, WHO_DAYS.length).setDataValidation(yn);
    sh.getRange(values.length + 1, 1, 1, 1 + WHO_DAYS.length).setFontWeight('bold');
    sh.getRange(2, 1, values.length, 1).setFontWeight('bold');
  }
}

function out_(s) {
  return ContentService.createTextOutput(JSON.stringify(s)).setMimeType(ContentService.MimeType.JSON);
}
