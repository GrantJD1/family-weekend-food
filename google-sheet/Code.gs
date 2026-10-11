/**
 * Shared storage for the Weekend Food site, kept in this Google Sheet.
 *
 * Set-up: in the Sheet choose Extensions → Apps Script, replace everything with this file, save,
 * then Deploy → New deployment → type "Web app", Execute as "Me", Who has access "Anyone" → Deploy.
 * Copy the Web app URL into SHEET_URL at the top of js/app.js.
 *
 * The site sends small changes ("add this", "tick that"); they are applied one at a time under a
 * lock, so two people editing at once never overwrite each other. The "Shopping list" and "Meals"
 * tabs are rewritten after every change so you can read the list here too.
 */
const ITEMS_TAB = 'Shopping list';
const MEALS_TAB = 'Meals';
const ITEM_HEAD = ['Food', 'Aisle', 'Get it by', 'Quantity', 'When', 'Ticked', 'id', 'data'];
const MEAL_HEAD = ['Meal time', 'Meal name', 'slot'];
const SLOTS = { pool: 'Not planned', fe: 'Friday evening', sm: 'Saturday morning', sl: 'Saturday lunch', se: 'Saturday evening', sb: 'Sunday breakfast' };
const AISLES = {
  fv: 'Fruit & Veg', ba: 'Bakery', me: 'Meat & Poultry', fi: 'Fish & Seafood', da: 'Dairy & Eggs', ch: 'Chilled & Deli',
  cu: 'Food Cupboard', sp: 'Herbs, Spices & Sauces', sn: 'Snacks & Sweets', dr: 'Drinks', fr: 'Frozen', ho: 'Household'
};

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

function load_() {
  const items = {}, meals = {};
  rows_(tab_(ITEMS_TAB, ITEM_HEAD), ITEM_HEAD.length).forEach(r => {
    if (r[6]) { try { items[r[6]] = JSON.parse(r[7]); } catch (err) { /* skip a damaged row */ } }
  });
  // meal names can also be typed straight into the Meals tab
  rows_(tab_(MEALS_TAB, MEAL_HEAD), MEAL_HEAD.length).forEach(r => { if (r[2] && r[1]) meals[r[2]] = String(r[1]); });
  return { items, meals };
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
  const mrows = Object.keys(SLOTS).filter(k => k !== 'pool').map(k => [SLOTS[k], safe_(s.meals[k] || ''), k]);
  ml.getRange(2, 1, mrows.length, MEAL_HEAD.length).setValues(mrows);
}

function out_(s) {
  return ContentService.createTextOutput(JSON.stringify(s)).setMimeType(ContentService.MimeType.JSON);
}
