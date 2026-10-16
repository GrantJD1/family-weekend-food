(function () {
  /* ------------------------------------------------------------------
     SHARING
     Easiest: keep the shared list in a Google Sheet. Follow the steps at the
     top of google-sheet/Code.gs and paste the Web app URL here, e.g.
       const SHEET_URL = 'https://script.google.com/macros/s/XXXX/exec';
     ------------------------------------------------------------------ */
  // Leave empty to save the list in this browser only.
  const SHEET_URL = 'https://script.google.com/macros/s/AKfycbzJI0zK9Yj-GYXIoiVmXGW_6vsu44l2DRuuEcUodb7LLk2lh0PKaYJoxR4IgevU37vJOg/exec';

  const SLOTS = [['pool', 'Not planned'], ['fe', 'Fri evening'], ['sm', 'Sat morning'], ['sl', 'Sat lunch'], ['se', 'Sat evening'], ['sb', 'Sun breakfast'],
    ['dk', 'Drinks'], ['sk', 'Snacks'], ['mi', 'Miscellaneous']];

  /* Who's coming – keep in step with WHO_* in google-sheet/Code.gs */
  const DAYS = [['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
  const WHO_MEALS = ['Breakfast', 'Lunch', 'Dinner'];
  const WHO_PEOPLE = [['Dad', 'Rita', 'Rob', 'Faye', 'Emilia', 'Anwen', 'Benji'], ['Hannah', 'Mowgli', 'James', 'Sophie', 'Marie', 'Nick', 'Chris', 'Nicky']];
  const WHO_DEFAULT = { 'Breakfast|fri': 'No', 'Lunch|fri': 'No' }; // everything else starts as Yes
  const PASTRY = /puff pastry/i;
  const SLOT_NAME = Object.fromEntries(SLOTS);
  const CAT = Object.fromEntries(CATS.map(c => [c.k, c]));
  const CAT_SHAPE = { fv: 'leaf', ba: 'loaf', me: 'steak', fi: 'fish', da: 'tub', ch: 'tray', cu: 'jar', sp: 'shaker', sn: 'bag', dr: 'bottle', fr: 'bag', ho: 'box' };
  const GUESS = [
    ['fr', /frozen|ice ?cream|lolly|lollies|sorbet/],
    ['dr', /juice|wine|beer|lager|cider|\bgin\b|vodka|\brum\b|whisk|\btea\b|coffee|cola|lemonade|water|squash|drink|prosecco|champagne/],
    ['me', /chicken|beef|pork|lamb|steak|mince|bacon|sausage|\bham\b|turkey|duck|burger|ribs/],
    ['fi', /fish|salmon|\bcod\b|tuna|prawn|haddock|mackerel|crab|squid|shrimp/],
    ['da', /milk|cheese|yog|butter|cream|\beggs?\b/],
    ['ba', /bread|\brolls?\b|\bbuns?\b|bagel|croissant|cake|loaf|muffin|scone|wraps?\b|baguette/],
    ['sn', /crisp|chocolate|sweets|biscuit|cookie|snack|popcorn|\bnuts\b|sweet/],
    ['sp', /sauce|spice|herb|pepper|salt|ketchup|mayo|mustard|\boil\b|vinegar|seasoning|stock/],
    ['ho', /foil|soap|clean|\bbags?\b|wipe|paper|charcoal|batter(y|ies)|tissue|plates?|cups|napkin|matches/],
    ['fv', /apple|banana|berr|potato|onion|carrot|salad|tomato|lettuce|fruit|veg|pear|grape|lemon|lime|melon/],
    ['cu', /pasta|rice|\btins?\b|beans|flour|sugar|cereal|jam|soup|noodle/]
  ];

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = it => Icon.url({ n: it.n, s: it.s, c: Array.isArray(it.c) ? it.c : String(it.c || '').split(',') });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  let items = {};
  let meals = {}; // slot -> meal name, e.g. { fe: 'Chilli con carne' }
  let who = {};   // 'Row|day' -> 'Yes' | 'No' | '' ; missing cells fall back to WHO_DEFAULT
  const whoVal = k => (k in who ? who[k] : k in WHO_DEFAULT ? WHO_DEFAULT[k] : 'Yes');

  /* ---------------- storage ---------------- */
  function setStatus(kind, text) {
    $('#syncDot').className = 'dot ' + (kind || '');
    $('#syncText').textContent = text;
  }

  function localStore() {
    const KEY = 'weekend-food-v1', MKEY = 'weekend-food-meals-v1', WKEY = 'weekend-food-who-v1';
    const read = k => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } };
    const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
    items = read(KEY);
    meals = read(MKEY);
    who = read(WKEY);
    window.addEventListener('storage', e => {
      if (e.key === KEY) { items = read(KEY); render(); }
      if (e.key === MKEY) { meals = read(MKEY); render(); }
      if (e.key === WKEY) { who = read(WKEY); render(); }
    });
    setStatus('', 'Saved on this device');
    return {
      put(id, it) { items[id] = it; save(KEY, items); },
      patch(id, f) { if (items[id]) Object.assign(items[id], f); save(KEY, items); },
      del(id) { delete items[id]; save(KEY, items); },
      setMeal(slot, name) { if (name) meals[slot] = name; else delete meals[slot]; save(MKEY, meals); },
      setWho(k, v) { who[k] = v; save(WKEY, who); }
    };
  }

  /* Google Sheet: small changes are queued and posted to the sheet's script, and the
     whole list is re-read every few seconds so everyone sees each other's edits. */
  function applyOp(s, op) {
    if (op.t === 'put') s.items[op.id] = JSON.parse(JSON.stringify(op.it));
    else if (op.t === 'patch') { if (s.items[op.id]) Object.assign(s.items[op.id], op.f); }
    else if (op.t === 'del') delete s.items[op.id];
    else if (op.t === 'meal') { if (op.name) s.meals[op.slot] = op.name; else delete s.meals[op.slot]; }
    else if (op.t === 'who') s.who[op.k] = op.v;
  }

  function sheetStore() {
    const CACHE = 'weekend-food-sheet-cache';
    try { const c = JSON.parse(localStorage.getItem(CACHE)); if (c) { items = c.items || {}; meals = c.meals || {}; who = c.who || {}; } } catch (e) { /* ignore */ }
    const pending = [];
    let sending = false, last = '', flushTimer, synced = false;
    const cache = () => { try { localStorage.setItem(CACHE, JSON.stringify({ items, meals, who })); } catch (e) { /* ignore */ } };
    const ok = () => setStatus('live', 'Live · shared via Google Sheets');
    const fail = () => setStatus('err', 'Offline – will retry');
    setStatus('', 'Connecting…');

    // take the sheet's copy, then re-apply anything we've changed that it hasn't seen yet
    function accept(s) {
      const st = { items: (s && s.items) || {}, meals: (s && s.meals) || {}, who: (s && s.who) || {} };
      pending.forEach(op => applyOp(st, op));
      const j = JSON.stringify(st);
      if (j === last) return;
      last = j;
      // someone else just added puff pastry (our own adds are already in `items`)
      const party = synced && Object.keys(st.items).some(id => !items[id] && PASTRY.test(st.items[id].n || ''));
      synced = true;
      items = st.items;
      meals = st.meals;
      who = st.who;
      cache();
      render();
      if (party) pastryParty();
    }
    // background refreshes pause while the page is hidden; the first load always fetches
    async function pull(first) {
      if (sending || (document.hidden && first !== true)) return;
      try {
        const r = await fetch(SHEET_URL, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status);
        const s = await r.json();
        if (!sending) accept(s);
        ok();
      } catch (e) { fail(); }
    }
    async function flush() {
      clearTimeout(flushTimer);
      if (sending || !pending.length) return;
      sending = true;
      const batch = pending.slice();
      let sent = false;
      try {
        const r = await fetch(SHEET_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ops: batch }) });
        if (!r.ok) throw new Error(r.status);
        const s = await r.json();
        pending.splice(0, batch.length);
        sent = true;
        accept(s);
        ok();
      } catch (e) { fail(); }
      sending = false;
      if (pending.length) flushTimer = setTimeout(flush, sent ? 0 : 4000);
    }
    function queue(op) {
      applyOp({ items, meals, who }, op);
      pending.push(op);
      cache();
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 250);
    }
    pull(true);
    setInterval(pull, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
    return {
      put(id, it) { queue({ t: 'put', id, it }); },
      patch(id, f) { queue({ t: 'patch', id, f }); },
      del(id) { queue({ t: 'del', id }); },
      setMeal(slot, name) { queue({ t: 'meal', slot, name }); },
      setWho(k, v) { queue({ t: 'who', k, v }); }
    };
  }

  const store = SHEET_URL ? sheetStore() : localStore();

  /* ---------------- selector (left) ---------------- */
  const q = $('#q'), results = $('#results'), addBtn = $('#add'), qty = $('#qty'), per = $('#per'), picker = $('#picker'), hint = $('#hint');
  const FOODS_L = FOODS.map(f => ({ f, k: f.n.toLowerCase() }));
  let selected = null, hits = [], cursor = 0, mode = 'buy', unit = 'n';

  function guessCat(name) {
    const s = name.toLowerCase();
    const g = GUESS.find(([, rx]) => rx.test(s));
    return g ? g[0] : 'cu';
  }

  function search(text) {
    const t = text.trim().toLowerCase();
    if (!t) return [];
    const words = t.split(/\s+/);
    const out = [];
    for (const { f, k } of FOODS_L) {
      let score;
      if (k === t) score = 0;
      else if (k.startsWith(t)) score = 1;
      else if (k.includes(' ' + t)) score = 2;
      else if (k.includes(t)) score = 3;
      else if (words.length > 1 && words.every(w => k.includes(w))) score = 4;
      else continue;
      out.push([score, k.length, f]);
    }
    out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return out.slice(0, 8).map(x => x[2]);
  }

  function mark(name, t) {
    const i = name.toLowerCase().indexOf(t.toLowerCase());
    if (!t || i < 0) return esc(name);
    return esc(name.slice(0, i)) + '<mark>' + esc(name.slice(i, i + t.length)) + '</mark>' + esc(name.slice(i + t.length));
  }

  function showResults() {
    const t = q.value.trim();
    $('#clearQ').hidden = !q.value;
    if (!t || (selected && selected.n === q.value)) { results.hidden = true; return; }
    hits = search(t);
    const exact = hits.some(f => f.n.toLowerCase() === t.toLowerCase());
    let html = hits.map((f, i) =>
      `<div class="res${i === cursor ? ' on' : ''}" data-i="${i}"><img src="${icon(f)}" alt=""><div class="t"><div class="n">${mark(f.n, t)}</div><div class="c">${esc(CAT[f.cat].n)}</div></div></div>`).join('');
    if (!exact) {
      const custom = { n: t[0].toUpperCase() + t.slice(1), cat: guessCat(t) };
      custom.s = CAT_SHAPE[custom.cat]; custom.c = [];
      hits.push(custom);
      const i = hits.length - 1;
      html += `<div class="res custom${i === cursor ? ' on' : ''}" data-i="${i}"><img src="${icon(custom)}" alt=""><div class="t"><div class="n">Add “${esc(custom.n)}”</div><div class="c">${esc(CAT[custom.cat].n)}</div></div></div>`;
    }
    results.innerHTML = html;
    results.hidden = false;
  }

  // picking a food opens the card with quantity, buy/bring and the Add button
  function choose(f) {
    selected = f;
    q.value = f.n;
    results.hidden = true;
    $('#clearQ').hidden = false;
    $('#pvImg').src = icon(f);
    $('#pvName').textContent = f.n;
    $('#pvCat').textContent = CAT[f.cat].n;
    // fresh produce is usually counted, everything else comes in packets
    setUnit(f.cat === 'fv' ? 'n' : 'pk');
    setQty(1);
    per.value = '';
    hint.hidden = true;
    picker.hidden = false;
    picker.style.animation = 'none';
    void picker.offsetWidth;
    picker.style.animation = '';
    if (matchMedia('(max-width: 900px)').matches) picker.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function closePicker() {
    selected = null;
    picker.hidden = true;
    hint.hidden = false;
  }

  q.addEventListener('input', () => {
    if (selected && q.value !== selected.n) closePicker();
    cursor = 0;
    showResults();
  });
  q.addEventListener('focus', showResults);
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (results.hidden) return;
      e.preventDefault();
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
      results.querySelectorAll('.res').forEach((r, i) => r.classList.toggle('on', i === cursor));
      results.querySelector('.res.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!results.hidden && hits[cursor]) choose(hits[cursor]);
      else if (selected) add();
    } else if (e.key === 'Escape') {
      if (!results.hidden) results.hidden = true;
      else clearSearch();
    }
  });
  results.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the search box
  results.addEventListener('click', e => {
    const r = e.target.closest('.res');
    if (r) choose(hits[+r.dataset.i]);
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.search')) results.hidden = true; });
  function clearSearch() { q.value = ''; closePicker(); showResults(); q.focus(); }
  $('#clearQ').addEventListener('click', clearSearch);
  $('#pickClose').addEventListener('click', clearSearch);

  function segmented(el, cb) {
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      cb(b.dataset.v);
    });
  }
  segmented($('#mode'), v => { mode = v; });

  const clampQty = v => Math.max(1, Math.min(99, parseInt(v, 10) || 1));
  function setQty(v) { qty.value = clampQty(v); }
  function setUnit(v) {
    unit = v;
    $('#unitSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    $('#perRow').hidden = v !== 'pk';
  }
  segmented($('#unitSeg'), setUnit);
  picker.querySelector('.stepper').addEventListener('click', e => {
    const b = e.target.closest('button[data-d]');
    if (b) setQty(clampQty(qty.value) + +b.dataset.d);
  });
  qty.addEventListener('change', () => setQty(qty.value));
  [qty, per].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') { setQty(qty.value); add(); } }));

  function add() {
    if (!selected) return;
    const f = selected;
    const p = parseInt(per.value, 10);
    store.put(uid(), {
      n: f.n, cat: f.cat, s: f.s, c: (f.c || []).map(v => v || '').join(','),
      m: mode, q: clampQty(qty.value), u: unit, p: unit === 'pk' && p > 0 ? p : 0, slot: 'pool', done: false, t: Date.now()
    });
    toast(`${f.n} added`);
    if (PASTRY.test(f.n)) pastryParty();
    q.value = '';
    $('#clearQ').hidden = true;
    closePicker();
    render();
    if (!matchMedia('(pointer: coarse)').matches) q.focus();
  }
  addBtn.addEventListener('click', add);

  /* ---------------- schedule (middle) ---------------- */
  const board = $('#board');
  // items saved before the Number/Packets choice existed were always packets
  const isNum = it => it.u === 'n';
  const qtyText = it => (isNum(it) ? `×${it.q}` : it.p ? `${it.q} pk × ${it.p}` : `${it.q} pk`);

  function chipHTML(it) {
    const qt = qtyText(it);
    return `<img src="${icon(it)}" alt=""><span class="n">${esc(it.n)}</span>${qt ? `<span class="q">${qt}</span>` : ''}<span class="m ${it.m}" title="${it.m === 'bring' ? 'Bringing' : 'Buying'}"></span>`;
  }

  function renderBoard() {
    const existing = new Map([...board.querySelectorAll('.chip')].map(el => [el.dataset.id, el]));
    const byZone = {};
    Object.entries(items).sort((a, b) => (a[1].t || 0) - (b[1].t || 0)).forEach(([id, it]) => {
      (byZone[SLOT_NAME[it.slot] ? it.slot : 'pool'] ||= []).push([id, it]);
    });
    board.querySelectorAll('.zone').forEach(zone => {
      const wrap = zone.querySelector('.chips');
      (byZone[zone.dataset.slot] || []).forEach(([id, it], i) => {
        let el = existing.get(id);
        const html = chipHTML(it);
        if (!el) { el = document.createElement('div'); el.className = 'chip'; el.dataset.id = id; }
        if (el._html !== html) { el.innerHTML = html; el._html = html; }
        existing.delete(id);
        if (el.parentNode !== wrap || wrap.children[i] !== el) wrap.insertBefore(el, wrap.children[i] || null);
      });
    });
    existing.forEach(el => el.remove());
  }

  /* meal names above each slot, e.g. "Chilli con carne" for Friday evening */
  const MEAL_EG = { fe: 'Chilli con carne', sm: 'Full English', sl: 'Picnic lunch', se: 'BBQ', sb: 'Pancakes' };
  const measure = document.createElement('canvas').getContext('2d');
  // inputs don't grow with their text, so size each pill to fit what's in it
  function sizeMeal(input) {
    const cs = getComputedStyle(input);
    measure.font = `600 ${cs.fontSize} ${cs.fontFamily}`;
    input.style.width = Math.ceil(measure.measureText(input.value || input.placeholder).width) + 26 + 'px';
  }
  board.querySelectorAll('.zone:not(.tray):not(.extra)').forEach(zone => {
    const slot = zone.dataset.slot;
    const input = document.createElement('input');
    input.className = 'meal';
    input.maxLength = 40;
    input.spellcheck = true;
    input.placeholder = '+ Meal name';
    input.title = `Name this meal – e.g. ${MEAL_EG[slot]}`;
    input.setAttribute('aria-label', `Meal name for ${SLOT_NAME[slot]}`);
    zone.querySelector('.zone-h').append(input);
    sizeMeal(input);
    let timer;
    const commit = () => {
      clearTimeout(timer);
      delete input.dataset.dirty;
      const v = input.value.trim();
      if (v !== (meals[slot] || '')) { store.setMeal(slot, v); renderList(); }
    };
    input.addEventListener('input', () => { input.dataset.dirty = '1'; sizeMeal(input); clearTimeout(timer); timer = setTimeout(commit, 600); });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') input.blur(); });
  });
  function renderMeals() {
    board.querySelectorAll('.meal').forEach(input => {
      if (document.activeElement === input || input.dataset.dirty) return; // don't overwrite unsaved typing
      const v = meals[input.closest('.zone').dataset.slot] || '';
      if (input.value !== v) { input.value = v; sizeMeal(input); }
    });
  }
  document.fonts?.ready.then(() => board.querySelectorAll('.meal').forEach(sizeMeal));

  /* drag & drop that works for mouse and touch (touch: press and hold) */
  let dragging = false;
  document.addEventListener('touchmove', e => { if (dragging) e.preventDefault(); }, { passive: false });
  board.addEventListener('contextmenu', e => { if (e.target.closest('.chip')) e.preventDefault(); });
  board.addEventListener('pointerdown', e => {
    const chip = e.target.closest('.chip');
    if (!chip || e.button > 0) return;
    const id = chip.dataset.id, touch = e.pointerType === 'touch';
    const sx = e.clientX, sy = e.clientY;
    let lx = sx, ly = sy, ghost = null, hot = null, moved = false, ox = 0, oy = 0;
    const timer = touch ? setTimeout(begin, 260) : null;

    function begin() {
      dragging = true;
      const r = chip.getBoundingClientRect();
      ox = sx - r.left; oy = sy - r.top;
      ghost = chip.cloneNode(true);
      ghost.classList.add('ghost-chip');
      ghost.style.width = r.width + 'px';
      document.body.appendChild(ghost);
      chip.classList.add('lift');
      if (navigator.vibrate) navigator.vibrate(8);
      place();
    }
    function place() {
      ghost.style.left = lx - ox + 'px';
      ghost.style.top = ly - oy + 'px';
      const zone = document.elementFromPoint(lx, ly)?.closest('.zone');
      if (zone !== hot) { hot?.classList.remove('hot'); hot = zone; hot?.classList.add('hot'); }
    }
    function onMove(ev) {
      lx = ev.clientX; ly = ev.clientY;
      if (Math.hypot(lx - sx, ly - sy) > 6) moved = true;
      if (!ghost) {
        if (!moved) return;
        if (touch) return end(); // finger moved before the hold: it's a scroll
        begin();
      }
      ev.preventDefault();
      place();
    }
    function end(ev) {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', end);
      if (ghost) {
        ghost.remove();
        chip.classList.remove('lift');
        hot?.classList.remove('hot');
        if (ev && ev.type === 'pointerup' && hot && items[id] && hot.dataset.slot !== items[id].slot) {
          store.patch(id, { slot: hot.dataset.slot });
          render();
        }
      }
      dragging = false;
    }
    function onUp(ev) {
      const wasDrag = !!ghost;
      end(ev);
      if (!wasDrag && !moved) openPop(id, chip);
    }
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', end);
  });

  /* tap a chip: edit / move / remove */
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop.scrim.remove(); pop = null; } }
  function openPop(id, chip) {
    closePop();
    const it = items[id];
    if (!it) return;
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('pointerdown', closePop);
    pop = document.createElement('div');
    pop.className = 'pop';
    pop.scrim = scrim;
    pop.innerHTML = `
      <div class="pop-h"><img src="${icon(it)}" alt=""><div>${esc(it.n)}<div style="font-weight:400;font-size:12px;color:var(--ink2)">${esc(CAT[it.cat]?.n || '')}</div></div></div>
      <div class="seg pop-mode"><button data-v="buy" class="${it.m === 'buy' ? 'on' : ''}">Buying</button><button data-v="bring" class="${it.m === 'bring' ? 'on' : ''}">Bringing</button></div>
      <div class="qwidget">
        <div class="qty-row"><div class="stepper"><button data-d="-1">−</button><input type="number" min="1" max="99" value="${it.q}"><button data-d="1">+</button></div>
          <div class="seg small pop-unit"><button data-v="n" class="${isNum(it) ? 'on' : ''}">Number</button><button data-v="pk" class="${isNum(it) ? '' : 'on'}">Packets</button></div></div>
        <div class="per"${isNum(it) ? ' hidden' : ''}><input type="number" min="1" placeholder="–" value="${it.p || ''}"><span>in each packet · optional</span></div>
      </div>
      <div class="slots">${SLOTS.map(([k, n]) => `<button data-slot="${k}" class="${it.slot === k ? 'on' : ''}">${n}${meals[k] ? `<small>${esc(meals[k])}</small>` : ''}</button>`).join('')}</div>
      <button class="danger">Remove</button>`;
    document.body.append(scrim, pop);
    const r = chip.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = r.bottom + 8;
    if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 8);
    pop.style.top = top + 'px';
    pop.style.left = Math.max(8, Math.min(innerWidth - pw - 8, r.left)) + 'px';

    const [qIn, pIn] = pop.querySelectorAll('input');
    const save = f => { store.patch(id, f); render(); };
    segmented(pop.querySelector('.pop-mode'), v => save({ m: v }));
    segmented(pop.querySelector('.pop-unit'), v => {
      pop.querySelector('.per').hidden = v !== 'pk';
      save(v === 'pk' ? { u: v } : { u: v, p: 0 });
      if (v === 'n') pIn.value = '';
    });
    pop.querySelector('.stepper').addEventListener('click', e => {
      const b = e.target.closest('button[data-d]');
      if (!b) return;
      qIn.value = clampQty(qIn.value) + +b.dataset.d;
      qIn.value = clampQty(qIn.value);
      save({ q: +qIn.value });
    });
    qIn.addEventListener('change', () => { qIn.value = clampQty(qIn.value); save({ q: +qIn.value }); });
    pIn.addEventListener('change', () => { const p = parseInt(pIn.value, 10); save({ p: p > 0 ? p : 0 }); });
    pop.querySelector('.slots').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      save({ slot: b.dataset.slot });
      closePop();
    });
    pop.querySelector('.danger').addEventListener('click', () => {
      store.del(id);
      closePop();
      render();
      toast(`${it.n} removed`);
    });
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });

  /* ---------------- shopping list (right) ---------------- */
  let filter = 'all';
  segmented($('#filter'), v => { filter = v; renderList(); });

  function groups() {
    const rows = {};
    for (const [id, it] of Object.entries(items)) {
      if (filter !== 'all' && it.m !== filter) continue;
      const key = it.n.toLowerCase() + '|' + it.m;
      const r = rows[key] ||= { n: it.n, cat: CAT[it.cat] ? it.cat : 'cu', s: it.s, c: it.c, m: it.m, ids: [], num: 0, pk: 0, pers: new Set(), slots: [], done: true };
      r.ids.push(id);
      if (isNum(it)) r.num += +it.q || 1;
      else { r.pk += +it.q || 1; r.pers.add(it.p || 0); }
      if (it.slot !== 'pool' && SLOT_NAME[it.slot] && !r.slots.includes(it.slot)) r.slots.push(it.slot);
      r.done = r.done && !!it.done;
    }
    const out = CATS.map(c => ({ cat: c, rows: [] }));
    Object.values(rows).sort((a, b) => a.n.localeCompare(b.n)).forEach(r => out.find(g => g.cat.k === r.cat).rows.push(r));
    return out.filter(g => g.rows.length);
  }
  const rowQty = r => {
    const parts = [];
    if (r.num) parts.push(`× ${r.num}`);
    if (r.pk) {
      const p = r.pers.size === 1 ? [...r.pers][0] : 0;
      parts.push(`${r.pk} ${r.pk === 1 ? 'pack' : 'packs'}${p ? ` of ${p}` : ''}`);
    }
    return parts.join(' + ');
  };
  const rowWhen = r => (r.slots.length
    ? SLOTS.filter(([k]) => r.slots.includes(k)).map(([k, n]) => (meals[k] ? `${n} – ${meals[k]}` : n)).join(', ')
    : 'Not planned yet');

  let listRows = [];
  function renderList() {
    const gs = groups();
    listRows = [];
    if (!gs.length) {
      $('#list').innerHTML = `<div class="empty-list">${Object.keys(items).length ? 'Nothing here for this filter.' : 'Your list sorts itself into aisles<br>as food is added.'}</div>`;
      return;
    }
    $('#list').innerHTML = gs.map(g => `
      <div class="aisle"><div class="aisle-h"><i style="background:${g.cat.c}"></i>${esc(g.cat.n)}<em>${g.rows.length}</em></div>
      ${g.rows.map(r => {
        const i = listRows.push(r) - 1;
        return `<div class="row${r.done ? ' done' : ''}" data-r="${i}"><span class="tick"></span><img src="${icon(r)}" alt="">
          <div class="n">${esc(r.n)}<small>${esc(rowWhen(r))}</small></div>
          ${filter === 'all' && r.m === 'bring' ? '<span class="tag">Bring</span>' : ''}<span class="q">${rowQty(r)}</span></div>`;
      }).join('')}</div>`).join('');
  }
  $('#list').addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (!row) return;
    const r = listRows[+row.dataset.r];
    const done = !r.done;
    r.ids.forEach(id => store.patch(id, { done }));
    render();
  });

  $('#copy').addEventListener('click', () => {
    const gs = groups();
    if (!gs.length) return toast('Nothing to copy yet');
    const lines = [];
    const menu = SLOTS.filter(([k]) => meals[k]).map(([k, n]) => `${n}: ${meals[k]}`);
    if (menu.length) lines.push('MENU', ...menu, '');
    gs.forEach(g => {
      lines.push(g.cat.n.toUpperCase());
      g.rows.forEach(r => lines.push(`${r.done ? '✓' : '○'} ${r.n} — ${rowQty(r)}${filter === 'all' && r.m === 'bring' ? ' (bringing)' : ''}`));
      lines.push('');
    });
    const text = lines.join('\n').trim();
    const done = () => toast('List copied');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  });
  function fallbackCopy(text, cb) {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); cb(); } catch (e) { toast('Couldn’t copy'); }
    t.remove();
  }

  /* ---------------- who's coming (far right) ---------------- */
  const whoBody = $('#whoBody');
  // one tap flips Yes ⇄ No (quicker than a dropdown on a phone)
  const whoCells = row => DAYS.map(([d, day]) =>
    `<td><button type="button" class="yn" data-k="${esc(row)}|${d}" aria-label="${esc(row)}, ${day}"></button></td>`).join('');
  whoBody.innerHTML =
    '<tr class="grp"><th colspan="4">Meals happening</th></tr>' +
    WHO_MEALS.map(r => `<tr><th>${r}</th>${whoCells(r)}</tr>`).join('') +
    WHO_PEOPLE.map((group, i) => (i ? '<tr class="gap"><td colspan="4"></td></tr>' : '<tr class="grp"><th colspan="4">People</th></tr>') +
      group.map(p => `<tr><th>${esc(p)}</th>${whoCells(p)}</tr>`).join('')).join('');
  whoBody.addEventListener('click', e => {
    const b = e.target.closest('button.yn');
    if (!b) return;
    store.setWho(b.dataset.k, whoVal(b.dataset.k) === 'Yes' ? 'No' : 'Yes');
    renderWho();
  });
  function renderWho() {
    whoBody.querySelectorAll('button.yn').forEach(b => {
      const v = whoVal(b.dataset.k);
      b.textContent = v || '–';
      b.dataset.v = v;
      b.setAttribute('aria-pressed', v === 'Yes');
    });
    const people = WHO_PEOPLE.flat();
    const totals = DAYS.map(([d]) => people.filter(p => whoVal(`${p}|${d}`) === 'Yes').length);
    DAYS.forEach(([d], i) => { $('#tot-' + d).textContent = totals[i]; });
    $('#whoCount').textContent = `${Math.max(...totals)} of ${people.length} coming`;
  }

  /* ---------------- puff pastry alert ----------------
     Very over the top, but flashes stay at 2 a second (under the 3-a-second photosensitive
     safety limit), and devices set to "reduce motion" get a calm version. */
  function pastryParty() {
    if (document.querySelector('.party')) return;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pastry = icon(FOODS.find(f => f.n === 'Puff pastry') || { n: 'Puff pastry', s: 'roll', c: [] });
    const party = document.createElement('div');
    party.className = 'party' + (calm ? ' calm' : '');
    party.setAttribute('role', 'alert');
    party.innerHTML = '<div class="beams"></div><div class="strobe"></div>' +
      Array.from({ length: calm ? 0 : 26 }, () =>
        `<img class="rain" src="${pastry}" alt="" style="left:${(Math.random() * 96).toFixed(1)}%;width:${36 + Math.round(Math.random() * 44)}px;` +
        `animation-delay:${(Math.random() * 2).toFixed(2)}s;animation-duration:${(1.4 + Math.random() * 1.6).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg">`).join('') +
      `<div class="party-text">${["DON'T", 'FORGET', 'THE', 'PASTRY'].map((w, i) => `<span style="--i:${i}">${w}</span>`).join(' ')}</div>`;
    document.body.appendChild(party);
    if (!calm) document.body.classList.add('quake');
    setTimeout(() => party.classList.add('out'), 4800);
    setTimeout(() => { party.remove(); document.body.classList.remove('quake'); }, 5400);
  }

  /* ---------------- misc ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  function render() { renderBoard(); renderMeals(); renderList(); renderWho(); }

  // phone section bar: scroll in code so every tap works (even on the section you're already in)
  // and the section lands just below the sticky bar
  const jump = $('.jump');
  const jumpLinks = [...jump.querySelectorAll('a')];
  const markJump = hash => jumpLinks.forEach(a => a.classList.toggle('on', a.hash === hash));
  let jumpLock = 0;
  jump.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    const target = document.querySelector(a.hash);
    if (!target) return;
    markJump(a.hash);
    jumpLock = Date.now() + 1200; // don't let the scroll-spy flicker while we glide there
    const y = target.getBoundingClientRect().top + window.scrollY - jump.offsetHeight - 10;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  });
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting && Date.now() > jumpLock) markJump('#' + en.target.id);
    }), { rootMargin: '-30% 0px -65% 0px' });
    jumpLinks.forEach(a => { const t = document.querySelector(a.hash); if (t) seen.observe(t); });
  }
  markJump('#addSec');

  q.placeholder = `Search ${FOODS.length.toLocaleString()} foods`;
  $('#hintImg').src = icon(FOODS.find(f => f.n === 'Strawberries') || FOODS[0]);
  closePicker();
  setQty(1);
  render();
})();
