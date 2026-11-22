'use strict';
/* =========================================================
   VO VRECKU – logika aplikácie (presunutá z index.html do samostatného súboru,
   aby bezpečnostné pravidlo CSP mohlo zakázať akýkoľvek vložený kód).
   ========================================================= */

// Ochrana: appka sa nesmie zobraziť vložená v cudzej stránke (tzv. clickjacking)
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  try { window.top.location = window.self.location.href; } catch (e) { /* cudzia stránka to zablokovala – appka ostane skrytá */ }
  throw new Error('Vo vrecku: zobrazenie vo vloženom okne je zablokované.');
}


/* =========================================================
   1. NASTAVENIA
   ========================================================= */

// Pod týmto názvom sa dáta ukladajú v prehliadači (localStorage)
const STORAGE_KEY = 'voVrecku.data.v1';

// Kategórie bežných výdavkov a ich farby v grafe
const CATEGORIES = [
  { name: 'Potraviny',   color: '#3ddc84' },
  { name: 'Jedlo vonku', color: '#ffa94d' },
  { name: 'Zábava',      color: '#c77dff' },
  { name: 'Oblečenie',   color: '#4d8dff' },
  { name: 'Doprava',     color: '#22d3ee' },
  { name: 'Ostatné',     color: '#8b93a7' }
];

// Prázdny plán (keď ešte nie je zadaný žiadny príjem ani fixný výdavok)
const EMPTY_PLAN = Object.freeze({ incomes: [], fixed: [], savings: 0 });


/* =========================================================
   2. POMOCNÉ FUNKCIE (malé nástroje, ktoré používame všade)
   ========================================================= */

// Skratka na nájdenie prvku na stránke podľa jeho id
const $ = (id) => document.getElementById(id);

// Zaokrúhli číslo na centy (2 desatinné miesta)
const r2 = (n) => Math.round(n * 100) / 100;

// Sčíta sumy v zozname položiek
const sum = (list) => r2(list.reduce((total, item) => total + item.amount, 0));

// Formát eura po slovensky: "1 234,56 €"
const euroFormat = new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' });
const money = (n) => euroFormat.format(n);

// Doplní nulu pred jednociferné číslo: 5 -> "05"
const pad = (n) => String(n).padStart(2, '0');

// Kľúč mesiaca v tvare "2026-11"
const monthKeyOf = (date) => date.getFullYear() + '-' + pad(date.getMonth() + 1);

// Dátum v tvare "2026-11-21" (podľa miestneho času, nie svetového)
const isoDate = (d) => monthKeyOf(d) + '-' + pad(d.getDate());

// Vytvorí jedinečné id pre novú položku
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Posunie mesiac o +1 alebo -1 (napr. "2026-12" + 1 = "2027-01")
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  return monthKeyOf(new Date(y, m - 1 + delta, 1));
}

// Pekný názov mesiaca: "November 2026"
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const text = new Date(y, m - 1, 1).toLocaleDateString('sk-SK', { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Dátum "2026-11-21" zobrazí ako "21. 11. 2026"
function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return d + '. ' + m + '. ' + y;
}

// Správny tvar slova: 1 deň, 2 dni, 5 dní
const dayWord = (n) => (n === 1 ? 'deň' : (n >= 2 && n <= 4 ? 'dni' : 'dní'));

// Vytvorí HTML prvok (napr. <li>) s triedou a textom
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;   // textContent = bezpečné vloženie textu
  return e;
}

/*
  Prečíta sumu z textu, ktorý napísal používateľ.
  - akceptuje čiarku aj bodku (12,50 aj 12.50) a medzery (1 234,50)
  - odmietne prázdnu, zápornú alebo nezmyselnú hodnotu
  Vracia { value: číslo } alebo { error: 'chybová hláška' }.
  allowZero = true dovolí aj 0 alebo prázdne pole (pre "Chcem ušetriť").
*/
function parseAmount(raw, allowZero = false) {
  const text = String(raw).replace(/[\s €]/g, '');   // odstráni medzery a znak €
  if (text === '') return allowZero ? { value: 0 } : { error: 'Zadaj sumu.' };
  if (text.startsWith('-')) return { error: 'Suma nemôže byť záporná.' };
  const normalized = text.replace(',', '.');                // čiarku zmení na bodku
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return { error: 'Zadaj platné číslo, napr. 12,50 alebo 12.50 (najviac 2 desatinné miesta).' };
  }
  const value = r2(parseFloat(normalized));
  if (value === 0 && !allowZero) return { error: 'Suma musí byť väčšia ako 0.' };
  if (value > 10000000) return { error: 'Táto suma je príliš veľká.' };
  return { value };
}

// Číslo do políčka na úpravu: 12.5 -> "12,50", 100 -> "100"
const toInputText = (n) => n.toFixed(2).replace('.', ',').replace(',00', '');

// Krátka správa dole na obrazovke.
// undo = záloha dát pred zmenou -> zobrazí sa tlačidlo "Vrátiť späť"
let toastTimer = null;
function toast(message, { bad = false, undo = null } = {}) {
  const t = $('toast');
  t.replaceChildren(el('span', null, message));
  if (undo) {
    const btn = el('button', 'toast-btn', 'Vrátiť späť');
    btn.onclick = () => {
      data = JSON.parse(undo);
      editing = null;
      saveData();
      render();
      toast('Vrátené späť.');
    };
    t.append(btn);
  }
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 6000 : 3000);
}


/* =========================================================
   3. DÁTA – ukladanie, načítanie a prenos medzi mesiacmi

   Tvar dát:
   {
     months: {
       "2026-11": {
         plan: {                                  // príjem a fixné výdavky
           incomes: [ { id, name, amount } ],
           fixed:   [ { id, name, amount } ],
           savings: 50                            // "Chcem ušetriť"
         },
         expenses: [ { id, amount, category, date, note, created } ]  // nákupy
       }
     }
   }

   PRENOS DO NOVÉHO MESIACA: mesiac, ktorý nemá vlastný "plan",
   automaticky používa plán z posledného skoršieho mesiaca.
   Vlastnú kópiu dostane až vtedy, keď v ňom niečo zmeníš –
   takže staršie mesiace ostanú tak, ako boli.
   ========================================================= */

// Skontroluje a "vyčistí" dáta (pri načítaní aj pri importe zálohy).
// Ak dáta nemajú správny tvar, vráti null.
function cleanData(input) {
  if (!input || typeof input !== 'object' || !input.months || typeof input.months !== 'object') return null;
  const okAmount = (a) => typeof a === 'number' && Number.isFinite(a) && a > 0;
  const cleanItems = (list) => (Array.isArray(list) ? list : [])
    .filter((x) => x && typeof x.name === 'string' && okAmount(x.amount))
    .map((x) => ({ id: String(x.id || newId()), name: x.name.slice(0, 60), amount: r2(x.amount) }));

  const out = { months: {} };
  for (const [key, m] of Object.entries(input.months)) {
    if (!/^\d{4}-\d{2}$/.test(key) || !m || typeof m !== 'object') continue;
    const month = {
      expenses: (Array.isArray(m.expenses) ? m.expenses : [])
        .filter((x) => x && okAmount(x.amount) && /^\d{4}-\d{2}-\d{2}$/.test(x.date))
        .map((x) => ({
          id: String(x.id || newId()),
          amount: r2(x.amount),
          category: CATEGORIES.some((c) => c.name === x.category) ? x.category : 'Ostatné',
          date: x.date,
          note: typeof x.note === 'string' ? x.note.slice(0, 100) : '',
          created: Number(x.created) || 0
        }))
    };
    // Plán: nový tvar (m.plan) aj starší tvar (incomes/fixed priamo v mesiaci)
    const p = m.plan || (('incomes' in m || 'fixed' in m) ? m : null);
    if (p && typeof p === 'object') {
      month.plan = {
        incomes: cleanItems(p.incomes),
        fixed: cleanItems(p.fixed),
        savings: (typeof p.savings === 'number' && Number.isFinite(p.savings) && p.savings >= 0) ? r2(p.savings) : 0
      };
    }
    out.months[key] = month;
  }
  // Profil zo sprievodcu (ciele) – len známe hodnoty
  const pr = input.profile;
  if (pr && typeof pr === 'object') {
    const ids = ['minus', 'overview', 'save', 'reserve', 'invest', 'wealth'];
    const g = pr.goal;
    out.profile = {
      onboarded: !!pr.onboarded,
      goals: (Array.isArray(pr.goals) ? pr.goals : []).filter((x) => ids.includes(x)),
      goal: g && typeof g.name === 'string' && typeof g.target === 'number' && Number.isFinite(g.target) && g.target > 0
        ? { name: g.name.slice(0, 40), target: r2(g.target) } : null
    };
  }
  return out;
}

// Načíta dáta z prehliadača (ak ešte nie sú, začne s prázdnymi)
function loadData() {
  try {
    const parsed = cleanData(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    if (parsed) return parsed;
  } catch (e) { /* poškodené dáta alebo zablokované ukladanie */ }
  return { months: {} };
}

// Uloží dáta do prehliadača
function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    toast('Dáta sa nepodarilo uložiť. Prehliadač možno blokuje ukladanie – stiahni si zálohu.', { bad: true });
  }
}

// Záznam mesiaca (ak neexistuje, vytvorí prázdny)
function monthRecord(key) {
  if (!data.months[key]) data.months[key] = { expenses: [] };
  return data.months[key];
}

// Nákupy v mesiaci (len na čítanie)
const expensesFor = (key) => (data.months[key] ? data.months[key].expenses : []);

// Plán mesiaca na ČÍTANIE: vlastný, inak z posledného skoršieho mesiaca.
// Ak skorší neexistuje (prezeráš staršiu minulosť), použije najbližší neskorší.
function planFor(key) {
  if (data.months[key] && data.months[key].plan) return data.months[key].plan;
  const withPlan = Object.keys(data.months).filter((k) => data.months[k].plan).sort();
  const source = withPlan.filter((k) => k < key).pop() || withPlan[0];
  return source ? data.months[source].plan : EMPTY_PLAN;
}

// Plán mesiaca na ÚPRAVU: ak mesiac nemá vlastný, vytvorí si kópiu
function editablePlan(key) {
  const record = monthRecord(key);
  if (!record.plan) {
    const p = planFor(key);
    record.plan = {
      incomes: p.incomes.map((x) => ({ ...x })),
      fixed: p.fixed.map((x) => ({ ...x })),
      savings: p.savings
    };
  }
  return record.plan;
}

/*
  Každá zmena dát ide cez túto funkciu:
  urobí zmenu -> uloží -> prekreslí -> ukáže správu.
  canUndo = true -> v správe bude tlačidlo "Vrátiť späť".
*/
function change(doChange, message, canUndo = false) {
  const before = JSON.stringify(data);
  doChange();
  saveData();
  render();
  if (message) toast(message, { undo: canUndo ? before : null });
}


/* =========================================================
   4. STAV APLIKÁCIE
   ========================================================= */
let data = loadData();                  // všetky dáta
let today = isoDate(new Date());        // dnešný dátum "2026-11-21"
let currentKey = today.slice(0, 7);     // aktuálny mesiac "2026-11"
let viewKey = currentKey;               // mesiac, ktorý práve prezeráš
let editing = null;                     // ktorá položka sa práve upravuje { list, id }


/* =========================================================
   5. VÝPOČTY – koľko mám, koľko som minul, koľko môžem minúť
   ========================================================= */
function calculate(plan, expenses, key) {
  const income = sum(plan.incomes);
  const fixed = sum(plan.fixed);
  const savings = plan.savings || 0;
  const free = r2(income - fixed - savings);     // voľné peniaze na mesiac
  const spent = sum(expenses);                   // už minuté
  const remaining = r2(free - spent);            // ešte zostáva

  const [y, mo] = key.split('-').map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();

  let period, daysLeft, expected = null;
  if (key === currentKey) {
    period = 'current';
    const dayOfMonth = Number(today.slice(8));
    daysLeft = daysInMonth - dayOfMonth + 1;                           // vrátane dneška
    expected = r2(Math.max(free, 0) * dayOfMonth / daysInMonth);       // koľko by som mal mať minuté do dnes
  } else if (key < currentKey) {
    period = 'past';   daysLeft = 0;                                   // mesiac už skončil
  } else {
    period = 'future'; daysLeft = daysInMonth;                         // mesiac ešte nezačal
  }

  // Koľko môžem minúť denne (ak som v mínuse, tak 0)
  const daily = daysLeft > 0 ? r2(Math.max(remaining, 0) / daysLeft) : null;

  return { income, fixed, savings, free, spent, remaining, period, daysLeft, expected, daily };
}

// Rozhodne o farbe a texte stavu (zelená / oranžová / červená)
function getStatus(c) {
  if (c.income === 0 && c.fixed === 0 && c.spent === 0) {
    return { type: 'info', text: 'Začni tým, že nižšie zadáš svoj mesačný príjem a fixné výdavky.' };
  }
  if (c.remaining < 0) {
    const why = c.free < 0
      ? 'Fixné výdavky a sporenie sú vyššie ako tvoj príjem.'
      : 'Minul si viac, než si mal na tento mesiac k dispozícii.';
    return { type: 'bad', text: '⛔ Si v mínuse o ' + money(-c.remaining) + '. ' + why };
  }
  if (c.period === 'current' && c.spent > c.expected) {
    return {
      type: 'warn',
      text: '⚠ Pozor, míňaš rýchlejšie, než by si mal. Do dnes by si mal mať minuté najviac ' +
            money(c.expected) + ', ale minul si ' + money(c.spent) + '.'
    };
  }
  if (c.period === 'past') {
    return { type: 'ok', text: '✓ Mesiac skončil a ostalo ti ' + money(c.remaining) + '. Výborne!' };
  }
  return { type: 'ok', text: '✓ Všetko je v poriadku, si v rámci rozpočtu.' };
}


/* =========================================================
   6. VYKRESLENIE STRÁNKY
   render() prekreslí všetko podľa aktuálnych dát. Volá sa po každej zmene.
   ========================================================= */
function render() {
  const plan = planFor(viewKey);
  const expenses = expensesFor(viewKey);
  const c = calculate(plan, expenses, viewKey);

  $('monthLabel').textContent = monthLabel(viewKey);
  $('todayBtn').hidden = viewKey === currentKey;   // tlačidlo len pri inom mesiaci

  renderSummary(c);
  renderItemList('incomes', plan);
  renderItemList('fixed', plan);
  renderFreeMoney(c);
  renderExpenses(expenses);
  renderCharts(c, expenses);
  renderBackupInfo();
  renderGoalCard(c);
}

// Súhrn hore: veľké čísla + farebný stav
function renderSummary(c) {
  const status = getStatus(c);
  const color = { ok: 'pos', warn: 'warn-text', bad: 'neg', info: '' }[status.type];

  $('sumFree').textContent = money(c.free);
  $('sumFree').className = 'value' + (c.free < 0 ? ' neg' : '');
  $('sumSpent').textContent = money(c.spent);
  $('sumRemaining').textContent = money(c.remaining);
  $('sumRemaining').className = 'value ' + color;

  if (c.daily === null) {
    $('sumDaily').textContent = '—';
    $('sumDaily').className = 'value';
    $('sumDailySub').textContent = 'mesiac už skončil';
  } else {
    $('sumDaily').textContent = money(c.daily);
    $('sumDaily').className = 'value ' + color;
    $('sumDailySub').textContent = c.period === 'current'
      ? 'ešte ' + c.daysLeft + ' ' + dayWord(c.daysLeft) + ' (aj s dneškom)'
      : 'na ' + c.daysLeft + ' ' + dayWord(c.daysLeft);
  }

  $('status').textContent = status.text;
  $('status').className = 'status ' + status.type;
}

// Zoznam príjmov alebo fixných výdavkov (s úpravou a mazaním)
function renderItemList(listName, plan) {
  const ul = $(listName + 'List');
  ul.replaceChildren();

  if (plan[listName].length === 0) {
    ul.append(el('li', 'empty', listName === 'incomes' ? 'Zatiaľ žiadny príjem.' : 'Zatiaľ žiadne fixné výdavky.'));
  }

  for (const item of plan[listName]) {
    const li = el('li');

    if (editing && editing.list === listName && editing.id === item.id) {
      // --- Režim úpravy: políčka + Uložiť / Zrušiť ---
      li.className = 'editing';
      // Rozpísaný text sa pamätá v "editing", aby ho prekreslenie stránky nezmazalo
      const nameInput = el('input');
      nameInput.value = editing.name != null ? editing.name : item.name;
      nameInput.maxLength = 60;
      nameInput.setAttribute('aria-label', 'Názov');
      const amountInput = el('input');
      amountInput.value = editing.amount != null ? editing.amount : toInputText(item.amount);
      nameInput.addEventListener('input', () => { editing.name = nameInput.value; });
      amountInput.addEventListener('input', () => { editing.amount = amountInput.value; });
      amountInput.inputMode = 'decimal';
      amountInput.setAttribute('aria-label', 'Suma');
      const saveBtn = el('button', 'btn small', 'Uložiť');
      const cancelBtn = el('button', 'btn small ghost', 'Zrušiť');
      const err = el('div', 'error');

      const cancel = () => { editing = null; render(); };
      const save = () => {
        const name = nameInput.value.trim();
        const parsed = parseAmount(amountInput.value);
        nameInput.classList.toggle('invalid', !name);
        amountInput.classList.toggle('invalid', !!parsed.error);
        if (!name) { err.textContent = 'Zadaj názov.'; return; }
        if (parsed.error) { err.textContent = parsed.error; return; }
        change(() => {
          const target = editablePlan(viewKey)[listName].find((x) => x.id === item.id);
          target.name = name;
          target.amount = parsed.value;
          editing = null;
        }, 'Zmena uložená.');
      };
      saveBtn.onclick = save;
      cancelBtn.onclick = cancel;
      for (const input of [nameInput, amountInput]) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') cancel();
        });
      }

      li.append(nameInput, amountInput, saveBtn, cancelBtn, err);
      ul.append(li);
      nameInput.focus();
    } else {
      // --- Normálny riadok: názov, suma, Upraviť, Zmazať ---
      const editBtn = el('button', 'mini-btn', '✎ Upraviť');
      editBtn.onclick = () => { editing = { list: listName, id: item.id }; render(); };

      const delBtn = el('button', 'mini-btn del', '✕');
      delBtn.title = 'Zmazať';
      delBtn.setAttribute('aria-label', 'Zmazať ' + item.name);
      delBtn.onclick = () => change(() => {
        const p = editablePlan(viewKey);
        p[listName] = p[listName].filter((x) => x.id !== item.id);
      }, '„' + item.name + '“ zmazané.', true);

      li.append(el('span', 'item-name', item.name), el('span', 'item-amount', money(item.amount)), editBtn, delBtn);
      ul.append(li);
    }
  }

  $(listName + 'Total').textContent = money(sum(plan[listName]));
}

// Karta "Voľné peniaze na mesiac"
function renderFreeMoney(c) {
  $('calcIncome').textContent = money(c.income);
  $('calcFixed').textContent = '− ' + money(c.fixed);
  $('calcFree').textContent = money(c.free);
  $('calcFree').className = 'free-big ' + (c.free < 0 ? 'neg' : 'pos');
  // Políčko sporenia prepíšeme, len keď doň práve nepíšeš
  const input = $('savingsInput');
  if (document.activeElement !== input) {
    input.value = c.savings ? toInputText(c.savings) : '';
    input.classList.remove('invalid');
    $('savingsError').textContent = '';
  }
}

// Zoznam nákupov za mesiac (najnovšie hore)
function renderExpenses(expenses) {
  const ul = $('expenseList');
  ul.replaceChildren();

  // Zoradenie: najnovší dátum hore, pri rovnakom dátume naposledy pridaný hore
  const sorted = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

  if (sorted.length === 0) {
    ul.append(el('li', 'empty', 'V tomto mesiaci zatiaľ žiadne výdavky.'));
  }

  for (const exp of sorted) {
    const cat = CATEGORIES.find((x) => x.name === exp.category);
    const chip = el('span', 'chip', exp.category);
    chip.style.background = cat.color;

    const top = el('div', 'exp-top');
    top.append(chip, el('span', 'exp-date', formatDate(exp.date)));
    const main = el('div', 'exp-main');
    main.append(top);
    if (exp.note) main.append(el('div', 'exp-note', exp.note));

    const delBtn = el('button', 'mini-btn del', '✕');
    delBtn.title = 'Zmazať výdavok';
    delBtn.setAttribute('aria-label', 'Zmazať výdavok ' + money(exp.amount));
    delBtn.onclick = () => change(() => {
      const record = monthRecord(viewKey);
      record.expenses = record.expenses.filter((x) => x.id !== exp.id);
    }, 'Výdavok ' + money(exp.amount) + ' zmazaný.', true);

    const li = el('li');
    li.append(main, el('span', 'item-amount', money(exp.amount)), delBtn);
    ul.append(li);
  }

  $('expCount').textContent = sorted.length ? '(' + sorted.length + ')' : '';
  $('expTotal').textContent = money(sum(expenses));
}


/* =========================================================
   7. GRAFY (Chart.js)
   Knižnica sa načítava na pozadí, takže stránka sa zobrazí hneď
   a grafy sa doplnia, keď je knižnica stiahnutá.
   ========================================================= */
let chartLib = 'loading';      // 'loading' | 'ready' | 'failed'
let budgetChart = null;
let catChart = null;

// Volá sa, keď sa Chart.js stiahne (alebo nestiahne)
function chartLoaded(ok) {
  chartLib = ok ? 'ready' : 'failed';
  if (ok) {   // texty grafov v štýle appky (tmavý dizajn)
    Chart.defaults.color = '#aab1c5';
    Chart.defaults.font.family = "'JetBrains Mono', monospace";
    Chart.defaults.font.size = 11;
  }
  render();
}

// Vytvorí graf, alebo ak už existuje, len mu zmení údaje
function drawDoughnut(existing, canvasId, labels, values, colors) {
  if (existing) {
    existing.data.labels = labels;
    existing.data.datasets[0].data = values;
    existing.data.datasets[0].backgroundColor = colors;
    existing.update();
    return existing;
  }
  return new Chart($(canvasId), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: '#141824', borderWidth: 4 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, padding: 14 } },
        tooltip: { callbacks: { label: (ctx) => ' ' + ctx.label + ': ' + money(ctx.parsed) } }
      }
    }
  });
}

// Zobrazí text namiesto grafu (alebo ho skryje, ak message je prázdne)
function setChartMessage(boxId, emptyId, message) {
  $(boxId).classList.toggle('is-empty', !!message);
  $(emptyId).textContent = message;
}

function renderCharts(c, expenses) {
  if (chartLib !== 'ready') {
    const msg = chartLib === 'loading'
      ? 'Načítavam graf…'
      : 'Grafy sa nenačítali – na grafy treba pripojenie na internet. Všetko ostatné funguje.';
    setChartMessage('budgetBox', 'budgetEmpty', msg);
    setChartMessage('catBox', 'catEmpty', msg);
    return;
  }

  // --- Graf 1: Minuté vs. Zostáva ---
  const used = Math.min(c.spent, Math.max(c.free, 0));  // minuté (najviac do výšky voľných peňazí)
  const left = Math.max(c.remaining, 0);                 // čo ešte zostáva
  const over = Math.max(-c.remaining, 0);                // o koľko som v mínuse
  const labels = ['Minuté', 'Zostáva'];
  const values = [used, left];
  const colors = ['#4d8dff', '#3ddc84'];
  if (over > 0) { labels.push('V mínuse'); values.push(over); colors.push('#ff5c5c'); }
  budgetChart = drawDoughnut(budgetChart, 'budgetChart', labels, values, colors);
  setChartMessage('budgetBox', 'budgetEmpty',
    used + left + over === 0 ? 'Zatiaľ nie je čo zobraziť. Zadaj príjem a výdavky.' : '');

  // --- Graf 2: Minuté podľa kategórií (len kategórie, v ktorých niečo je) ---
  const cats = CATEGORIES
    .map((cat) => ({ ...cat, total: sum(expenses.filter((e) => e.category === cat.name)) }))
    .filter((cat) => cat.total > 0);
  catChart = drawDoughnut(catChart, 'catChart',
    cats.map((x) => x.name), cats.map((x) => x.total), cats.map((x) => x.color));
  setChartMessage('catBox', 'catEmpty', cats.length === 0 ? 'V tomto mesiaci zatiaľ žiadne výdavky.' : '');
}


/* =========================================================
   8. OVLÁDANIE – čo sa stane po kliknutí / odoslaní formulára
   ========================================================= */

// Naplní výber kategórií
for (const cat of CATEGORIES) $('expCategory').append(new Option(cat.name, cat.name));

// Predvolený dátum výdavku: dnes (alebo 1. deň, ak prezeráš iný mesiac)
function setDefaultDate() {
  $('expDate').value = viewKey === currentKey ? today : viewKey + '-01';
}

// --- Prepínanie mesiacov ---
function goToMonth(key) {
  viewKey = key;
  editing = null;
  setDefaultDate();
  render();
}
$('prevMonth').onclick = () => goToMonth(shiftMonth(viewKey, -1));
$('nextMonth').onclick = () => goToMonth(shiftMonth(viewKey, +1));
$('todayBtn').onclick = () => goToMonth(currentKey);

// --- Pridanie príjmu alebo fixného výdavku (rovnaký formulár pre oba) ---
function setupItemForm(listName) {
  const form = $(listName + 'Form');
  const err = $(listName + 'Error');
  form.addEventListener('submit', (e) => {
    e.preventDefault();                     // stránka sa nemá znova načítať
    const { name: nameInput, amount: amountInput } = form.elements;
    const name = nameInput.value.trim();
    const parsed = parseAmount(amountInput.value);

    nameInput.classList.toggle('invalid', !name);
    amountInput.classList.toggle('invalid', !!parsed.error);
    if (!name) {
      err.textContent = 'Zadaj názov (napr. ' + (listName === 'incomes' ? 'Výplata' : 'Nájom') + ').';
      nameInput.focus();
      return;
    }
    if (parsed.error) { err.textContent = parsed.error; amountInput.focus(); return; }

    err.textContent = '';
    form.reset();
    clearDraft(listName + 'Form');
    change(() => editablePlan(viewKey)[listName].push({ id: newId(), name, amount: parsed.value }),
      '„' + name + '“ pridané.');
    nameInput.focus();
  });
}
setupItemForm('incomes');
setupItemForm('fixed');

/*
  ROZPÍSANÝ TEXT (koncept): čo napíšeš do formulára a ešte neuložíš, sa priebežne
  pamätá. Keď iPhone stránku na pozadí zatvorí a znovu načíta (napr. keď odbehneš
  do inej appky), text sa obnoví. Po pridaní položky sa koncept zmaže.
  Ostáva len v tomto zariadení, nikam sa neposiela.
*/
const DRAFT_KEY = 'voVrecku.draft';
const DRAFT_FIELDS = {
  incomesForm: () => [$('incomesForm').elements.name, $('incomesForm').elements.amount],
  fixedForm: () => [$('fixedForm').elements.name, $('fixedForm').elements.amount],
  expenseForm: () => [$('expAmount'), $('expNote'), $('expCategory')]
};
function readDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch (e) { return {}; }
}
function writeDrafts(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch (e) { /* nevadí */ }
}
function saveDraft(formId) {
  const d = readDrafts();
  const values = DRAFT_FIELDS[formId]().map((f) => f.value);
  if (values.some((v, i) => v && !(formId === 'expenseForm' && i === 2))) d[formId] = values; else delete d[formId];
  writeDrafts(d);
}
function clearDraft(formId) { const d = readDrafts(); delete d[formId]; writeDrafts(d); }
for (const formId of Object.keys(DRAFT_FIELDS)) {
  const saved = readDrafts()[formId];
  DRAFT_FIELDS[formId]().forEach((f, i) => {
    if (saved && saved[i] != null && saved[i] !== '') f.value = saved[i];
    f.addEventListener('input', () => saveDraft(formId));
    f.addEventListener('change', () => saveDraft(formId));
  });
}

// --- Chcem ušetriť (uloží sa po opustení políčka alebo Enter) ---
$('savingsInput').addEventListener('change', (e) => {
  const parsed = parseAmount(e.target.value, true);
  e.target.classList.toggle('invalid', !!parsed.error);
  $('savingsError').textContent = parsed.error || '';
  if (parsed.error || parsed.value === planFor(viewKey).savings) return;
  change(() => { editablePlan(viewKey).savings = parsed.value; }, 'Sporenie uložené.');
});
$('savingsInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();   // opustenie políčka spustí uloženie
});

// --- Pridanie bežného výdavku (nákupu) ---
$('expenseForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('expError');
  const amountInput = $('expAmount');
  const dateInput = $('expDate');
  const parsed = parseAmount(amountInput.value);
  const date = dateInput.value;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);

  amountInput.classList.toggle('invalid', !!parsed.error);
  dateInput.classList.toggle('invalid', !dateOk);
  if (parsed.error) { err.textContent = parsed.error; amountInput.focus(); return; }
  if (!dateOk) { err.textContent = 'Vyber dátum.'; dateInput.focus(); return; }
  err.textContent = '';

  const expense = {
    id: newId(),
    amount: parsed.value,
    category: $('expCategory').value,
    date,
    note: $('expNote').value.trim(),
    created: Date.now()
  };
  amountInput.value = '';
  $('expNote').value = '';
  clearDraft('expenseForm');

  // Výdavok sa uloží do mesiaca podľa svojho dátumu
  const targetKey = date.slice(0, 7);
  const where = targetKey === viewKey ? '' : ' do mesiaca ' + monthLabel(targetKey);
  change(() => monthRecord(targetKey).expenses.push(expense),
    'Výdavok ' + money(expense.amount) + ' pridaný' + where + '.', true);
  amountInput.focus();
});

// --- Export: stiahne zálohu ako súbor .json ---
$('exportBtn').onclick = () => {
  const backup = { app: 'Vo vrecku', exported: new Date().toISOString(), ...data };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const link = el('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'vo-vrecku-zaloha-' + today + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  try { localStorage.setItem(BACKUP_KEY, today); } catch (e) { /* nevadí */ }
  renderBackupInfo();
  toast('Záloha stiahnutá. Obsahuje tvoje údaje – nikomu ju neposielaj.');
};

// --- Import: načíta zálohu zo súboru .json ---
$('importBtn').onclick = () => $('importFile').click();
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';                      // aby šlo ten istý súbor vybrať znova
  if (!file) return;
  let imported = null;
  try { imported = cleanData(JSON.parse(await file.text())); } catch (err) { /* zlý súbor */ }
  if (!imported) {
    toast('Tento súbor sa nedá načítať. Vyber zálohu z aplikácie Vo vrecku (.json).', { bad: true });
    return;
  }
  if (!confirm('Import nahradí všetky súčasné dáta údajmi zo zálohy. Pokračovať?')) return;
  const before = JSON.stringify(data);
  data = imported;
  saveData();
  goToMonth(currentKey);
  toast('Dáta zo zálohy boli načítané.', { undo: before });
});

// --- Ak je aplikácia otvorená v dvoch kartách, zmena v jednej sa prejaví aj v druhej ---
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return;
  data = loadData();
  editing = null;
  render();
});

// --- Ak necháš stránku otvorenú cez polnoc, dátum a mesiac sa aktualizujú ---
function refreshToday() {
  const now = isoDate(new Date());
  if (now === today) return;
  const wasOnCurrent = viewKey === currentKey;
  today = now;
  currentKey = now.slice(0, 7);
  goToMonth(wasOnCurrent ? currentKey : viewKey);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });
setInterval(refreshToday, 60 * 1000);


/* =========================================================
   9. TRVALÉ ULOŽENIE, INŠTALÁCIA A PRIPOMIENKA ZÁLOHY
   ========================================================= */

// Kedy bola stiahnutá posledná záloha (ukladá sa zvlášť od dát)
const BACKUP_KEY = 'voVrecku.lastBackup';

// Zobrazí dátum poslednej zálohy; po 30 dňoch pripomenie novú
function renderBackupInfo() {
  let last = null;
  try { last = localStorage.getItem(BACKUP_KEY); } catch (e) { /* nevadí */ }
  const hasData = Object.keys(data.months).length > 0;
  const info = $('backupInfo');
  const daysAgo = last ? Math.round((new Date(today) - new Date(last)) / 86400000) : null;
  const old = hasData && (daysAgo === null || daysAgo >= 30);
  info.textContent = (last ? 'Posledná záloha: ' + formatDate(last) + '.' : 'Zálohu si ešte nestiahol.') +
    (old ? ' Odporúčam stiahnuť si ' + (last ? 'novú' : 'ju') + ' – pre prípad straty mobilu alebo vymazania prehliadača.' : '');
  info.className = 'muted' + (old ? ' old' : '');
}

/*
  Požiada prehliadač o TRVALÉ uloženie dát.
  Bez neho môže prehliadač dáta zmazať, keď mu dochádza miesto,
  a Safari na iPhone maže dáta stránok, ktoré 7 dní neotvoríš.
  Nainštalovaná aplikácia (na ploche) je pred tým chránená.
*/
async function requestPersistentStorage() {
  let persisted = false;
  try {
    if (navigator.storage && navigator.storage.persist) {
      persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    }
  } catch (e) { /* prehliadač to nepodporuje */ }

  const box = $('storageInfo');
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (persisted || installed) {
    box.textContent = '✓ Dáta sú uložené natrvalo – ostanú, aj keď stránku dlho neotvoríš.';
    box.className = 'storage-info ok';
  } else {
    box.textContent = 'Všetko sa ukladá automaticky v tomto prehliadači a ostane aj po zatvorení. ' +
      'Pre najväčšiu istotu si aplikáciu pridaj na plochu (v menu prehliadača „Pridať na plochu“ ' +
      'alebo „Inštalovať aplikáciu“) – potom ju prehliadač nikdy sám nezmaže.';
    box.className = 'storage-info';
  }
}

// Tlačidlo "Nainštalovať" (Chrome/Edge/Android ho ponúknu, keď to ide)
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('installBtn').hidden = false;
});
$('installBtn').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('installBtn').hidden = true;
};
window.addEventListener('appinstalled', () => {
  $('installBtn').hidden = true;
  requestPersistentStorage();
  toast('Aplikácia je nainštalovaná. Nájdeš ju na ploche.');
});

// Pomocník v pozadí (sw.js) – inštalácia a fungovanie bez internetu.
// Funguje len na webovej adrese (https), nie pri otvorení súboru dvojklikom.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* bez neho appka funguje tiež */ });
}


/* =========================================================
   10. ÚVODNÝ SPRIEVODCA – pár otázok, podľa ktorých sa appka nastaví
   Odpovede sa ukladajú len do tohto zariadenia (data.profile).
   ========================================================= */
const GOALS = [
  { id: 'minus',    icon: '🧯', label: 'Nebyť na konci mesiaca v mínuse' },
  { id: 'overview', icon: '🔍', label: 'Mať prehľad, kam idú peniaze' },
  { id: 'save',     icon: '🎯', label: 'Ušetriť na niečo konkrétne' },
  { id: 'reserve',  icon: '🛟', label: 'Vytvoriť si finančnú rezervu' },
  { id: 'invest',   icon: '📈', label: 'Začať investovať' },
  { id: 'wealth',   icon: '🏠', label: 'Dlhodobo budovať majetok' }
];
const INCOME_TYPES = ['Výplata', 'Brigáda', 'Štipendium', 'Podnikanie', 'Vreckové', 'Iné'];
const FIXED_PRESETS = ['Nájom', 'Internát', 'Energie', 'Telefón', 'Internet', 'Predplatné', 'MHD / doprava', 'Splátka', 'Poistenie'];

let ob = null;   // stav sprievodcu počas vypĺňania

function obSteps() {
  return ['welcome', 'goals', 'income', 'fixed', 'savings', 'summary'];
}

function openOnboarding() {
  const p = data.profile || {}, cur = planFor(currentKey).savings;
  // ak už sporenie máš nastavené, ponúkne sa tvoja suma (nič sa neprepíše bez tvojho vedomia)
  ob = { i: 0, goals: [...(p.goals || [])], incomeType: 'Výplata', incomeAmount: '', fixed: {},
         savingsMode: cur > 0 ? 'custom' : 'p10', savingsCustom: cur > 0 ? toInputText(cur) : '', goalName: p.goal ? p.goal.name : '', goalTarget: p.goal ? toInputText(p.goal.target) : '', error: '' };
  $('onboarding').hidden = false;
  document.body.style.overflow = 'hidden';
  renderOnboarding();
}
function closeOnboarding() {
  $('onboarding').hidden = true;
  document.body.style.overflow = '';
  ob = null;
}

// pomocník: tlačidlo-voľba
function optBtn(label, on, onClick, icon) {
  const b = el('button', 'ob-opt' + (on ? ' on' : ''));
  b.type = 'button';
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (icon) b.append(el('span', 'ob-ic', icon));
  b.append(el('span', null, label));
  b.onclick = onClick;
  return b;
}

function obIncomeTotal() { const p = parseAmount(ob.incomeAmount); return p.error ? 0 : p.value; }
function obSavingsValue() {
  const inc = obIncomeTotal() || sum(planFor(currentKey).incomes);
  if (ob.savingsMode === 'p10') return r2(inc * .1);
  if (ob.savingsMode === 'p20') return r2(inc * .2);
  if (ob.savingsMode === 'custom') { const p = parseAmount(ob.savingsCustom, true); return p.error ? 0 : p.value; }
  return 0;
}

function renderOnboarding() {
  const steps = obSteps(), step = steps[ob.i], body = $('obBody');
  body.replaceChildren();
  $('obStep').textContent = String(ob.i + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0');
  $('obBarFill').style.width = ((ob.i + 1) / steps.length * 100) + '%';
  $('obBack').style.visibility = ob.i === 0 ? 'hidden' : 'visible';
  $('obNext').textContent = step === 'welcome' ? 'Poďme na to →' : step === 'summary' ? 'Začať používať →' : 'Ďalej →';
  const lead = (t) => body.append(el('p', 'ob-lead', t));
  const title = (t) => body.append(el('h2', 'ob-title', t));
  const note = (t) => body.append(el('p', 'ob-note', t));

  if (step === 'welcome') {
    lead('Ahoj! 👋');
    title('Nastavme appku na mieru');
    note('Pár krátkych otázok, do jednej minúty. Odpovede ostanú len v tvojom mobile. Hocičo môžeš neskôr zmeniť.');
  }
  if (step === 'goals') {
    lead('Čo chceš dosiahnuť');
    title('vo svojom finančnom živote?');
    note('Vyber jedno alebo viac.');
    const wrap = el('div', 'ob-grid');
    for (const g of GOALS) {
      wrap.append(optBtn(g.label, ob.goals.includes(g.id), () => {
        ob.goals = ob.goals.includes(g.id) ? ob.goals.filter((x) => x !== g.id) : [...ob.goals, g.id];
        renderOnboarding();
      }, g.icon));
    }
    body.append(wrap);
  }
  if (step === 'income') {
    lead('Odkiaľ máš');
    title('hlavný príjem?');
    const wrap = el('div', 'ob-chips');
    for (const t of INCOME_TYPES) wrap.append(optBtn(t, ob.incomeType === t, () => { ob.incomeType = t; renderOnboarding(); }));
    body.append(wrap);
    const lab = el('label', null, 'Koľko to je mesačne (€)'); lab.htmlFor = 'obIncome';
    const inp = el('input'); inp.id = 'obIncome'; inp.inputMode = 'decimal'; inp.placeholder = 'napr. 900'; inp.value = ob.incomeAmount;
    inp.oninput = () => { ob.incomeAmount = inp.value; };
    body.append(lab, inp);
    note('Môžeš nechať prázdne a doplniť neskôr. Ďalšie príjmy pridáš v appke.');
  }
  if (step === 'fixed') {
    lead('Ktoré výdavky');
    title('platíš každý mesiac?');
    note('Klikni na tie, ktoré máš, a dopíš sumu. Omyl zrušíš krížikom ✕.');
    const wrap = el('div', 'ob-chips');
    const removeFixed = (f) => { delete ob.fixed[f]; renderOnboarding(); };
    for (const f of FIXED_PRESETS) {
      // vybraný štítok má ✕ – ďalšie kliknutie ho odoberie
      wrap.append(optBtn(f + (f in ob.fixed ? '  ✕' : ''), f in ob.fixed, () => {
        if (f in ob.fixed) { removeFixed(f); return; }
        ob.fixed[f] = '';
        renderOnboarding();
        const inp = document.querySelector('[data-fixed="' + f + '"]'); if (inp) inp.focus();
      }));
    }
    body.append(wrap);
    const list = el('div', 'ob-fixed');
    for (const f of Object.keys(ob.fixed)) {
      const row = el('div', 'ob-row'); row.append(el('span', null, f));
      const inp = el('input'); inp.inputMode = 'decimal'; inp.placeholder = '€'; inp.value = ob.fixed[f]; inp.dataset.fixed = f;
      inp.setAttribute('aria-label', 'Suma – ' + f);
      inp.oninput = () => { ob.fixed[f] = inp.value; };
      // tlačidlo na odstránenie omylom vybraného výdavku
      const del = el('button', 'ob-del', '✕'); del.type = 'button';
      del.title = 'Odstrániť'; del.setAttribute('aria-label', 'Odstrániť ' + f);
      del.onclick = () => removeFixed(f);
      row.append(inp, del); list.append(row);
    }
    body.append(list);
  }
  if (step === 'savings') {
    const inc = obIncomeTotal() || sum(planFor(currentKey).incomes);
    lead('Koľko chceš');
    title('každý mesiac odložiť?');
    note('Táto suma sa odpočíta hneď na začiatku mesiaca, aby si ju neminul.');
    const wrap = el('div', 'ob-grid');
    const opt = (mode, label) => wrap.append(optBtn(label, ob.savingsMode === mode, () => { ob.savingsMode = mode; renderOnboarding(); }));
    opt('p10', '10 % príjmu' + (inc ? ' · ' + money(r2(inc * .1)) : ''));
    opt('p20', '20 % príjmu' + (inc ? ' · ' + money(r2(inc * .2)) : ''));
    opt('custom', 'Vlastná suma');
    opt('none', 'Zatiaľ nie');
    body.append(wrap);
    if (ob.savingsMode === 'custom') {
      const inp = el('input'); inp.inputMode = 'decimal'; inp.placeholder = 'Suma € mesačne'; inp.value = ob.savingsCustom; inp.setAttribute('aria-label', 'Vlastná suma na sporenie');
      inp.oninput = () => { ob.savingsCustom = inp.value; };
      body.append(inp);
    }
    if (ob.goals.includes('save')) {
      body.append(el('p', 'ob-sub', 'Na čo šetríš?'));
      const row = el('div', 'ob-two');
      const n = el('input'); n.placeholder = 'napr. Dovolenka'; n.maxLength = 40; n.value = ob.goalName; n.setAttribute('aria-label', 'Názov cieľa');
      n.oninput = () => { ob.goalName = n.value; };
      const t = el('input'); t.inputMode = 'decimal'; t.placeholder = 'Koľko €'; t.value = ob.goalTarget; t.setAttribute('aria-label', 'Cieľová suma');
      t.oninput = () => { ob.goalTarget = t.value; };
      row.append(n, t); body.append(row);
    }
  }
  if (step === 'summary') {
    const pv = previewPlan();
    lead('Hotovo,');
    title('tvoj plán je pripravený');
    const box = el('div', 'ob-summary');
    const line = (k, v, cls) => { const r = el('div', 'ob-sum-row'); r.append(el('span', null, k), el('strong', cls || null, v)); box.append(r); };
    line('Príjem', money(pv.income));
    line('Pravidelné výdavky', '− ' + money(pv.fixed));
    if (pv.savings) line('Odkladáš', '− ' + money(pv.savings));
    line('Voľné na mesiac', money(pv.free), pv.free < 0 ? 'neg' : 'acc');
    if (pv.free > 0) line('To je približne denne', money(r2(pv.free / 30)), 'acc');
    body.append(box);
    if (pv.eta) note(pv.eta);
    if (pv.free < 0) note('Výdavky sú vyššie ako príjem. V appke uvidíš, kde sa dá ušetriť.');
    note('Všetko si môžeš kedykoľvek upraviť priamo v appke.');
  }
  if (ob.error) body.append(el('p', 'error', ob.error));
}

// výpočet plánu z odpovedí (pred uložením)
function previewPlan() {
  const base = planFor(currentKey);
  const has = (list, name) => list.some((x) => x.name.toLowerCase() === name.toLowerCase());
  // položky s rovnakým názvom, ktoré už v appke sú, sa znova nepridajú (rovnako ako pri uložení)
  const income = r2(sum(base.incomes) + (has(base.incomes, ob.incomeType) ? 0 : obIncomeTotal()));
  let fixed = sum(base.fixed);
  for (const [name, v] of Object.entries(ob.fixed)) { const p = parseAmount(v); if (!p.error && !has(base.fixed, name)) fixed = r2(fixed + p.value); }
  const savings = obSavingsValue();
  const free = r2(income - fixed - savings);
  let eta = '';
  const tg = parseAmount(ob.goalTarget);
  if (ob.goals.includes('save') && !tg.error && savings > 0) {
    const n = Math.ceil(tg.value / savings);
    eta = 'Na „' + (ob.goalName.trim() || 'cieľ') + '“ (' + money(tg.value) + ') budeš mať pri ' + money(savings) + ' mesačne približne za ' + n + ' ' + monthWord(n) + ' – v mesiaci ' + monthLabel(shiftMonth(currentKey, n - 1)).toLowerCase() + '.';
  }
  return { income, fixed, savings, free, eta };
}
const monthWord = (n) => (n === 1 ? 'mesiac' : (n >= 2 && n <= 4 ? 'mesiace' : 'mesiacov'));

// kontrola súm pred posunom ďalej
function obValidate(step) {
  if (step === 'income' && ob.incomeAmount.trim()) { const p = parseAmount(ob.incomeAmount); if (p.error) return 'Príjem: ' + p.error; }
  if (step === 'fixed') for (const [k, v] of Object.entries(ob.fixed)) { if (v.trim()) { const p = parseAmount(v); if (p.error) return k + ': ' + p.error; } }
  if (step === 'savings') {
    if (ob.savingsMode === 'custom') { const p = parseAmount(ob.savingsCustom, true); if (p.error) return 'Sporenie: ' + p.error; }
    if (ob.goals.includes('save') && ob.goalTarget.trim()) { const p = parseAmount(ob.goalTarget); if (p.error) return 'Cieľ: ' + p.error; }
  }
  return '';
}

// uloženie odpovedí do appky
function finishOnboarding() {
  const pv = previewPlan();
  change(() => {
    const plan = editablePlan(currentKey);
    const has = (list, name) => list.some((x) => x.name.toLowerCase() === name.toLowerCase());
    const inc = obIncomeTotal();
    if (inc > 0 && !has(plan.incomes, ob.incomeType)) plan.incomes.push({ id: newId(), name: ob.incomeType, amount: inc });
    for (const [name, v] of Object.entries(ob.fixed)) {
      const p = parseAmount(v);
      if (!p.error && !has(plan.fixed, name)) plan.fixed.push({ id: newId(), name, amount: p.value });
    }
    plan.savings = pv.savings;
    const tg = parseAmount(ob.goalTarget);
    data.profile = {
      onboarded: true,
      goals: [...ob.goals],
      goal: ob.goals.includes('save') && !tg.error ? { name: ob.goalName.trim().slice(0, 40) || 'Môj cieľ', target: tg.value } : null
    };
  }, 'Appka je nastavená podľa teba. 🎉');
  closeOnboarding();
  goToMonth(currentKey);
}

/*
  Plynulý prechod medzi krokmi: starý krok odíde do strany,
  nový priletí z druhej strany (s rozostrením → zaostrením ako vo videu).
  dir = 1 (Ďalej) alebo -1 (Späť).
*/
let obBusy = false;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function goStep(dir) {
  if (obBusy) return;
  const target = Math.max(0, Math.min(ob.i + dir, obSteps().length - 1));
  if (target === ob.i) return;
  const body = $('obBody');
  if (reduceMotion) { ob.i = target; renderOnboarding(); $('onboarding').scrollTop = 0; return; }
  obBusy = true;
  body.className = 'ob-body ' + (dir > 0 ? 'ob-leave-next' : 'ob-leave-back');
  setTimeout(() => {
    ob.i = target;
    renderOnboarding();
    $('onboarding').scrollTop = 0;
    body.className = 'ob-body ' + (dir > 0 ? 'ob-enter-next' : 'ob-enter-back');
    setTimeout(() => { body.className = 'ob-body'; obBusy = false; }, 420);
  }, 170);
}

$('obNext').onclick = () => {
  if (obBusy) return;
  const steps = obSteps(), step = steps[ob.i];
  ob.error = obValidate(step);
  if (ob.error) { renderOnboarding(); return; }
  if (step === 'summary') { finishOnboarding(); return; }
  goStep(1);
};
// pri písaní zmizne stará chybová hláška
$('obBody').addEventListener('input', () => { ob.error = ''; const e = $('obBody').querySelector('.error'); if (e) e.remove(); });
$('obBack').onclick = () => { ob.error = ''; goStep(-1); };
$('obSkip').onclick = () => {
  // preskočenie si zapamätáme, aby sa sprievodca neotváral stále dookola
  change(() => { data.profile = Object.assign({ goals: [], goal: null }, data.profile, { onboarded: true }); });
  closeOnboarding();
};
$('openOnboarding').onclick = openOnboarding;

// Karta "Tvoj plán" – ciele a tipy podľa odpovedí
function renderGoalCard(c) {
  const card = $('goalCard'), p = data.profile;
  const body = $('goalBody'), tipsEl = $('tipList');
  body.replaceChildren(); tipsEl.replaceChildren();
  if (!p || !p.goals || p.goals.length === 0) {
    body.append(el('p', 'muted', 'Odpovedz na pár otázok a appka ti ukáže plán a tipy presne pre teba.'));
    $('openOnboarding').textContent = '✨ Nastaviť moje ciele';
    $('tipNote').hidden = true;
    return;
  }
  $('openOnboarding').textContent = 'Upraviť moje ciele';
  $('tipNote').hidden = false;
  const chips = el('div', 'goal-chips');
  for (const id of p.goals) { const g = GOALS.find((x) => x.id === id); if (g) chips.append(el('span', 'goal-chip', g.icon + ' ' + g.label)); }
  body.append(chips);
  if (p.goal) {
    const s = c.savings;
    const txt = s > 0
      ? 'Cieľ „' + p.goal.name + '“ · ' + money(p.goal.target) + ' – pri ' + money(s) + ' mesačne ho dosiahneš približne za ' + Math.ceil(p.goal.target / s) + ' ' + monthWord(Math.ceil(p.goal.target / s)) + '.'
      : 'Cieľ „' + p.goal.name + '“ · ' + money(p.goal.target) + ' – nastav si sumu v „Chcem ušetriť“ a appka ti vypočíta, kedy ho dosiahneš.';
    body.append(el('p', 'goal-eta', txt));
  }
  for (const t of buildTips(c, p).slice(0, 5)) tipsEl.append(el('li', null, t));
}

// všeobecné tipy podľa cieľov (nie investičné poradenstvo)
function buildTips(c, p) {
  const t = [], g = (id) => p.goals.includes(id);
  if (g('minus')) {
    t.push('Drž sa čísla „Dnes môžeš minúť“ hore. Keď ho dnes prekročíš, zajtra si urob lacnejší deň.');
    if (c.free <= 0 && c.income > 0) t.push('Fixné výdavky ti zjedia celý príjem. Prejdi si predplatné a paušály, či všetky naozaj potrebuješ.');
  }
  if (g('overview')) {
    t.push('Zapíš nákup hneď pri pokladni, zaberie to 5 sekúnd. Spätne si ho už nespomenieš.');
    t.push('Raz za týždeň pozri graf „Minuté podľa kategórií“. Tam sa schovávajú najväčšie úniky.');
  }
  if (g('save')) t.push('Odkladaj hneď po výplate, nie to, čo ostane na konci mesiaca. Na konci väčšinou neostane nič.');
  if (g('save') && c.savings <= 0) t.push('Nastav si sumu v „Chcem ušetriť“. Appka ju odpočíta hneď na začiatku mesiaca, takže ju neminieš.');
  if (g('reserve')) {
    if (c.fixed > 0) t.push('Bežne sa odporúča rezerva na 3 až 6 mesiacov výdavkov. Pri tvojich fixných výdavkoch je to ' + money(r2(c.fixed * 3)) + ' až ' + money(r2(c.fixed * 6)) + '.');
    t.push('Rezervu drž oddelene od bežného účtu, aby si ju neminul omylom.');
  }
  if (g('invest')) {
    t.push('Pred investovaním si najprv vytvor rezervu a splať drahé dlhy (napr. kreditku).');
    t.push('Investuj len peniaze, ktoré nebudeš potrebovať aspoň niekoľko rokov. Investícia môže aj klesnúť.');
    t.push('Over si, že firma, cez ktorú investuješ, je pod dohľadom Národnej banky Slovenska.');
  }
  if (g('wealth')) {
    t.push('Keď ti stúpne príjem, zvýš aj sumu, ktorú odkladáš, nielen míňanie.');
    t.push('Pomôcka 50/30/20: polovica na potreby, 30 % na zábavu a priania, 20 % na budúcnosť.');
  }
  return t;
}


/* =========================================================
   11. ŠTART APLIKÁCIE
   ========================================================= */
setDefaultDate();
render();
requestPersistentStorage();
// nový používateľ (žiadne dáta) → najprv sprievodca
if (!data.profile && Object.keys(data.months).length === 0) openOnboarding();


/* =========================================================
   12. PRESŤAHOVANIE ZO STAREJ ADRESY
   Stará adresa (richardlechman234-eng.github.io/vo-vrecku) otvorí túto
   stránku s ?presun=1 a pošle dáta priamo v prehliadači (postMessage).
   Nič neprechádza internetom. Prijímame LEN od starej adresy a LEN
   od okna, ktoré túto stránku otvorilo – a vždy sa najprv opýtame.
   ========================================================= */
const OLD_ORIGIN = 'https://richardlechman234-eng.github.io';
if (new URLSearchParams(location.search).get('presun') === '1' && window.opener) {
  window.addEventListener('message', (e) => {
    if (e.origin !== OLD_ORIGIN || e.source !== window.opener || !e.data || e.data.type !== 'vv-presun') return;
    const reply = (type) => { try { e.source.postMessage({ type }, OLD_ORIGIN); } catch (err) { /* staré okno už je zavreté */ } };
    const imported = cleanData(e.data.data);
    if (!imported) { reply('vv-chyba'); return; }
    const n = Object.keys(imported.months).length;
    const hasData = Object.keys(data.months).length > 0;
    const question = hasData
      ? 'Na novej adrese už máš nejaké dáta. Nahradiť ich dátami zo starej adresy (' + n + ' ' + monthWord(n) + ')?'
      : 'Preniesť tvoje dáta zo starej adresy (' + n + ' ' + monthWord(n) + ')?';
    if (!confirm(question)) { reply('vv-zrusene'); return; }
    data = imported;
    saveData();
    try {   // rozpísané koncepty a dátum poslednej zálohy
      if (typeof e.data.draft === 'string' && JSON.parse(e.data.draft)) localStorage.setItem(DRAFT_KEY, e.data.draft);
      if (typeof e.data.lastBackup === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.data.lastBackup)) localStorage.setItem(BACKUP_KEY, e.data.lastBackup);
    } catch (err) { /* nevadí */ }
    reply('vv-hotovo');
    if (ob) closeOnboarding();
    goToMonth(currentKey);
    toast('Tvoje dáta sú presunuté na novú adresu. 🎉');
    history.replaceState(null, '', location.pathname);
  });
  window.opener.postMessage({ type: 'vv-pripraveny' }, OLD_ORIGIN);
}

// Knižnica grafov (vendor/chart.umd.min.js) sa načítava pred týmto súborom.
// Ak sa nenačítala, appka funguje ďalej, len bez grafov.
chartLoaded(typeof Chart !== 'undefined');

