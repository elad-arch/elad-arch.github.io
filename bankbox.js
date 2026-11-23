// bankbox.js - חיבור ל-BankBox (שרת הבנק הפרטי, דרך Tailscale). קריאה בלבד.
//
// עקרונות:
// - שום דבר לא משתנה בלי אישור: הסנכרון רק מציע עדכונים, והמשתמש בוחר מה להחיל.
// - רק החודש הנוכחי (של היום). חודשים שעברו וחודשים עתידיים לא מושפעים.
// - הכל נשאר ידני: אפשר לשנות כל ערך גם אחרי עדכון מהבנק.
//
// API: GET {baseUrl}/api/mazpen/v1/summary?since=YYYY-MM-DD, עם Authorization: Bearer <token>.
// ההגדרות (כתובת + מפתח) נשמרות ב-allData.settings.bankbox, מוצפנות יחד עם שאר הנתונים.

const BANKBOX_AUTO_SYNC_INTERVAL = 30 * 60 * 1000;

const bankbox = {
    summary: null,      // התשובה האחרונה מהשרת (בזיכרון בלבד)
    fetchedAt: 0,
    error: null,        // network | invalid_token | origin_not_allowed | version | http
    fetching: false,
    proposals: []
};

// זיהוי *שחיוב* בעו"ש הוא חיוב אשראי נעשה לפי isCardSettlement שמגיע מ-BankBox.
// מילות המפתח משמשות רק כדי לשייך את החיוב לחברת האשראי (אם BankBox לא שלח settlementProvider).
// הטקסט מנורמל קודם (בלי גרשיים), כך ש'ויזה כא"ל' נקרא 'ויזה כאל'. מילים באנגלית נבדקות כמילה שלמה.
const CARD_SETTLEMENT_KEYWORDS = {
    visaCal: ['כאל', 'כרטיסי אשראי לישראל', 'visa cal', 'cal'],
    isracard: ['ישראכרט', 'isracard'],
    max: ['מקס', 'לאומי קארד', 'max'],
    amex: ['אמריקן', 'אמקס', 'amex', 'american express'],
    diners: ['דיינרס', 'diners']
};
// מילים כלליות, נבדקות רק אם אף מילה ספציפית לא נמצאה
const CARD_SETTLEMENT_FALLBACK = { visaCal: ['ויזה', 'visa'] };
// "הרשאה" היא הוראת קבע לחברת האשראי (למשל החזר הלוואה), ולא בהכרח החיוב החודשי של הכרטיס
const STANDING_ORDER_WORDS = ['הרשאה', 'הוראת קבע'];

const BANK_PROVIDER_NAMES = {
    visaCal: 'כאל', isracard: 'ישראכרט', max: 'מקס', amex: 'אמריקן אקספרס', diners: 'דיינרס', mizrahi: 'מזרחי טפחות'
};

const BANKBOX_ERROR_TEXTS = {
    network: 'לא מצליח להגיע ל-BankBox בכתובת הזו. כדאי לבדוק ש-Tailscale מחובר, ולנסות לפתוח בדפדפן את הכתובת עם ‎/healthz בסוף – צריך להופיע ok.',
    cors: 'BankBox זמין, אבל הדפדפן חסם את התשובה (CORS). כנראה שכתובת המצפן שפתוחה עכשיו לא מופיעה בדיוק ב-MAZPEN_ORIGINS בשרת.',
    timeout: 'BankBox לא ענה בזמן. כדאי לנסות שוב בעוד רגע.',
    invalid_token: 'מפתח הגישה לא תקין או שבוטל. אפשר ליצור מפתח חדש ב-BankBox.',
    origin_not_allowed: 'BankBox לא מאשר את כתובת המצפן. צריך להוסיף אותה ל-MAZPEN_ORIGINS בשרת.',
    version: 'גרסת ה-API של BankBox לא נתמכת.',
    http: 'BankBox החזיר שגיאה. כדאי לנסות שוב מאוחר יותר.',
    bad_url: 'הכתובת צריכה להתחיל ב-https:// (למשל https://bankbox.xxxx.ts.net).',
    not_tsnet: 'הכתובת צריכה להיות כתובת ה-Tailscale של BankBox, שמסתיימת ב-ts.net (למשל https://bankbox.xxxx.ts.net). כתובת IP או שם קצר לא יעבדו.',
    port: 'הכתובת לא צריכה לכלול פורט (למשל :8080). משתמשים בכתובת של tailscale serve, בלי פורט: https://bankbox.xxxx.ts.net'
};

function getBankboxSettings() {
    return (allData.settings && allData.settings.bankbox) || null;
}

function isBankboxConfigured() {
    const cfg = getBankboxSettings();
    return !!(cfg && cfg.baseUrl && cfg.token);
}

// מחזיר { url } או { error }. מקבל גם כתובת שהודבקה עם נתיב (למשל ‎/settings) ומשאיר רק את הבסיס.
function parseBankboxUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch (e) { return { error: 'bad_url' }; }
    if (url.protocol !== 'https:') return { error: 'bad_url' };
    if (url.port) return { error: 'port' };
    if (!/\.ts\.net$/i.test(url.hostname)) return { error: 'not_tsnet' };
    return { url: url.origin };
}

function normalizeBankboxUrl(value) {
    return parseBankboxUrl(value).url || null;
}

function timeoutSignal(ms) {
    return (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(ms) : undefined;
}

// כשהבקשה נכשלה בלי תשובה: בודקים אם השרת בכלל זמין, כדי להבדיל בין "אין חיבור" לבין חסימת CORS
async function diagnoseBankboxFailure(baseUrl) {
    try {
        await fetch(`${baseUrl}/healthz`, { mode: 'no-cors', cache: 'no-store', signal: timeoutSignal(8000) });
        return 'cors';
    } catch (e) {
        return 'network';
    }
}

function shiftDateKey(dateKey, days) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
}

// טקסט השגיאה, עם הכתובת שאליה ניסינו לפנות ופרטים טכניים - כדי שאפשר יהיה לזהות טעות הקלדה או חסימה
function bankboxErrorText(result, baseUrl) {
    const lines = [BANKBOX_ERROR_TEXTS[result.error] || BANKBOX_ERROR_TEXTS.http];
    if (['network', 'cors', 'timeout'].includes(result.error) && baseUrl) lines.push(`כתובת: ${baseUrl}`);
    if (result.detail) lines.push(`פרטים: ${result.detail}`);
    return lines.join('\n');
}

async function fetchBankboxSummary(cfg) {
    const since = shiftDateKey(`${getCurrentMonthKey()}-01`, -10);
    let response;
    try {
        response = await fetch(`${cfg.baseUrl}/api/mazpen/v1/summary?since=${since}`, {
            headers: { Authorization: `Bearer ${cfg.token}` },
            cache: 'no-store',
            signal: timeoutSignal(20000)
        });
    } catch (e) {
        if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return { ok: false, error: 'timeout' };
        const detail = e ? `${e.name || 'Error'}: ${e.message || ''}`.trim() : '';
        return { ok: false, error: await diagnoseBankboxFailure(cfg.baseUrl), detail };
    }
    if (response.status === 401) return { ok: false, error: 'invalid_token' };
    if (response.status === 403) return { ok: false, error: 'origin_not_allowed' };
    if (!response.ok) return { ok: false, error: 'http' };
    let data;
    try { data = await response.json(); } catch (e) { return { ok: false, error: 'http' }; }
    if (!data || data.apiVersion !== 1) return { ok: false, error: 'version' };
    return { ok: true, data };
}

// סנכרון: מושך נתונים ומחשב הצעות. לא משנה שום נתון.
async function syncBankbox({ manual = false } = {}) {
    if (!isBankboxConfigured() || bankbox.fetching) return;
    bankbox.fetching = true;
    renderBankStatus();
    const result = await fetchBankboxSummary(getBankboxSettings());
    bankbox.fetching = false;
    if (result.ok) {
        bankbox.summary = result.data;
        bankbox.fetchedAt = Date.now();
        bankbox.error = null;
    } else {
        bankbox.error = result.error;
    }
    refreshBankProposals();
    renderBankStatus();

    if (manual) {
        if (!result.ok) {
            openConfirmModal('שגיאה', sanitizeHTML(bankboxErrorText(result, getBankboxSettings().baseUrl)).replace(/\n/g, '<br>'), closeConfirmModal);
        } else if (bankbox.proposals.length > 0) {
            openBankReview();
        } else {
            openConfirmModal('מידע', `הכל מעודכן. אין שינויים מהבנק לחודש הנוכחי.${bankbox.note ? '<br>' + sanitizeHTML(bankbox.note) : ''}`, closeConfirmModal);
        }
    }
}

function maybeAutoSyncBankbox() {
    if (!sync.ready || !isBankboxConfigured()) return;
    if (Date.now() - bankbox.fetchedAt < BANKBOX_AUTO_SYNC_INTERVAL) return;
    syncBankbox();
}

// ---------- חישוב ההצעות (לחודש הנוכחי בלבד) ----------

function normalizeBankText(text) {
    return String(text || '').toLowerCase()
        .replace(/["'׳״`]/g, '')
        .replace(/[.,\-_/\\()]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function textHasWord(text, word) {
    const w = normalizeBankText(word);
    if (/^[a-z0-9 ]+$/.test(w)) return new RegExp(`(^|[^a-z0-9])${w}($|[^a-z0-9])`).test(text);
    return text.includes(w);
}

function findProvider(text, table) {
    return Object.keys(table).find(provider => table[provider].some(word => textHasWord(text, word))) || null;
}

// לאיזו חברת אשראי שייך חיוב בעו"ש
function settlementProviderOf(tx) {
    if (tx.settlementProvider) return tx.settlementProvider;
    const text = normalizeBankText(tx.description);
    return findProvider(text, CARD_SETTLEMENT_KEYWORDS) || findProvider(text, CARD_SETTLEMENT_FALLBACK);
}

function isStandingOrder(tx) {
    const text = normalizeBankText(tx.description);
    return STANDING_ORDER_WORDS.some(word => textHasWord(text, word));
}

function amountsClose(a, b) {
    return Math.abs(Math.abs(a) - Math.abs(b)) <= Math.max(1, Math.abs(b) * 0.03);
}

function bankDay(dateKey) {
    return parseInt(String(dateKey).slice(8, 10), 10);
}

function plannedDay(item) {
    if (item.type === 'loan') return item.loanBillingDay || null;
    return item.recurrence && item.recurrence.isRecurring ? item.recurrence.dayOfMonth : null;
}

function buildBankProposals(summary) {
    const monthKey = getCurrentMonthKey();
    const month = allData[monthKey];
    if (!summary) return { proposals: [], note: '' };
    if (!month) return { proposals: [], note: 'החודש הנוכחי עוד לא נוצר במצפן.' };

    const inMonth = dateKey => typeof dateKey === 'string' && dateKey.slice(0, 7) === monthKey;
    const proposals = [];
    const transactions = summary.transactions || [];
    const cards = summary.cards || [];

    // 1. עו"ש
    const accounts = (summary.accounts || []).filter(a => typeof a.balance === 'number');
    if (accounts.length > 0) {
        const total = safeCalc(accounts.reduce((sum, a) => sum + a.balance, 0));
        const current = safeCalc(month.balance || 0);
        if (total !== current) {
            const at = accounts.map(a => a.balanceAt).filter(Boolean).sort().pop() || null;
            proposals.push({ key: 'balance', kind: 'balance', from: current, to: total, at });
        }
    }

    // 2. כרטיסי אשראי (שורות שמשויכות לכרטיס ב-BankBox)
    const settlements = transactions.filter(t => t.kind === 'bank' && t.isCardSettlement && t.status === 'completed' && inMonth(t.date) && t.amount);
    const usedSettlements = new Set();
    (month.expenses || []).filter(row => row.type === 'variable' && Array.isArray(row.bankCardIds) && row.bankCardIds.length > 0).forEach(row => {
        const linked = cards.filter(card => row.bankCardIds.includes(card.id));
        if (linked.length === 0) return;
        const charges = [];
        linked.forEach(card => (card.upcomingCharges || []).forEach(c => { if (inMonth(c.date)) charges.push(c); }));
        const providers = [...new Set(linked.map(card => card.provider))];
        const chargeDates = charges.map(c => c.date);
        const chargesOn = date => charges.filter(c => c.date === date).reduce((sum, c) => sum + c.amount, 0);

        // מועמדים: חיובי אשראי של אותה חברה, באותו תאריך כמו החיוב הצפוי (אם יש החודש)
        const candidates = settlements.filter(s => !usedSettlements.has(s.id)
            && providers.includes(settlementProviderOf(s))
            && (chargeDates.length === 0 || chargeDates.includes(s.date)))
            .map(s => ({ s, expected: chargeDates.length ? chargesOn(s.date) : row.amount }))
            // הוראת קבע ("הרשאה") נחשבת חיוב של הכרטיס רק אם הסכום שלה כמעט זהה לצפוי
            .filter(c => !isStandingOrder(c.s) || (c.expected && amountsClose(c.s.amount, c.expected)))
            .sort((a, b) => Math.abs(Math.abs(a.s.amount) - (a.expected || 0)) - Math.abs(Math.abs(b.s.amount) - (b.expected || 0)));
        const settlement = candidates.length ? candidates[0].s : null;

        if (settlement) {
            usedSettlements.add(settlement.id);
            // החיוב כבר ירד מהעו"ש החודש: להפסיק לספור את השורה, כדי שלא תיספר פעמיים
            if (row.checked) proposals.push({ key: `pass:${row.id}`, kind: 'pass', list: 'expenses', rowId: row.id, tx: settlement, card: true, standing: isStandingOrder(settlement) });
        } else if (charges.length > 0) {
            const amount = safeCalc(charges.reduce((sum, c) => sum + c.amount, 0));
            if (amount !== safeCalc(row.amount)) {
                proposals.push({
                    key: `card:${row.id}`, kind: 'card-amount', rowId: row.id, from: row.amount, to: amount,
                    date: chargeDates.sort()[0], estimated: linked.some(card => card.estimated)
                });
            }
        }
    });

    // 3. תנועות מתוכננות שכבר עברו בבנק
    const bankTx = transactions
        // הוראות קבע לחברת אשראי ("הרשאה") שלא שויכו לכרטיס מותאמות כמו כל תנועה אחרת (למשל להחזר הלוואה)
        .filter(t => t.kind === 'bank' && t.status === 'completed' && inMonth(t.date) && t.amount
            && (!t.isCardSettlement || (isStandingOrder(t) && !usedSettlements.has(t.id))))
        .sort((a, b) => a.date.localeCompare(b.date));
    const usedItems = new Set();
    bankTx.forEach(tx => {
        const listKey = tx.amount > 0 ? 'income' : 'expenses';
        const amount = Math.abs(tx.amount);
        const text = normalizeBankText(tx.description);
        let best = null;
        (month[listKey] || []).forEach(item => {
            if (!item.checked || item.bankPassed || item.type === 'variable' || usedItems.has(item.id)) return;
            const learned = !!item.bankMatchPattern && text.includes(item.bankMatchPattern);
            const diff = Math.abs(amount - item.amount);
            const closeAmount = diff <= Math.max(1, item.amount * 0.03);
            if (!learned && !closeAmount) return;
            let score = learned ? 100 : 0;
            score += diff <= 1 ? 60 : (closeAmount ? 40 : 0);
            const day = plannedDay(item);
            if (day && Math.abs(day - bankDay(tx.date)) <= 3) score += 20;
            if (!best || score > best.score) best = { item, score, learned };
        });
        if (best) {
            usedItems.add(best.item.id);
            proposals.push({ key: `pass:${best.item.id}`, kind: 'pass', list: listKey, rowId: best.item.id, tx, learned: best.learned });
        }
    });

    return { proposals, note: '' };
}

function refreshBankProposals() {
    const result = buildBankProposals(bankbox.summary);
    bankbox.proposals = result.proposals;
    bankbox.note = result.note;
}

// ---------- החלת ההצעות שנבחרו ----------

function applyBankProposals(keys) {
    const monthKey = getCurrentMonthKey();
    const month = allData[monthKey];
    const chosen = bankbox.proposals.filter(p => keys.includes(p.key));
    if (!month || chosen.length === 0) return;
    saveStateForUndo();
    const find = (listKey, id) => (month[listKey] || []).find(t => t.id === id);

    chosen.forEach(p => {
        if (p.kind === 'balance') {
            month.balance = p.to;
            if (currentMonth === monthKey) document.getElementById('currentBalanceInput').value = p.to;
            allData.settings.bankbox.appliedBalance = { month: monthKey, value: p.to, at: p.at };
        } else if (p.kind === 'card-amount') {
            const row = find('expenses', p.rowId);
            if (row) {
                row.amount = p.to;
                row.bankEstimate = { date: p.date, at: bankbox.summary.generatedAt };
            }
        } else if (p.kind === 'pass') {
            const row = find(p.list, p.rowId);
            if (row) {
                row.checked = false;
                row.bankPassed = { txId: p.tx.id, date: p.tx.date, amount: p.tx.amount, description: p.tx.description };
                // לומדים את התיאור בבנק, כדי להציע את אותה התאמה גם בחודשים הבאים (עדיין באישור)
                if (!p.card) row.bankMatchPattern = normalizeBankText(p.tx.description);
            }
        }
    });

    saveData();
    render();
}

// ---------- תצוגה ----------

function formatBankTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const sameDay = date.toDateString() === new Date().toDateString();
    return date.toLocaleString('he-IL', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatBankDate(dateKey) {
    if (!dateKey) return '';
    const [, m, d] = dateKey.split('-').map(Number);
    return `${d}/${m}`;
}

function renderBankStatus() {
    const line = document.getElementById('bankStatusLine');
    const banner = document.getElementById('bankUpdatesBanner');
    const menuValue = document.getElementById('menuBankValue');
    const syncRow = document.getElementById('menuBankSync');
    if (!line) return;
    const configured = sync.ready && isBankboxConfigured();
    syncRow.disabled = !configured;
    line.classList.toggle('hidden', !configured);
    banner.classList.toggle('hidden', !configured || bankbox.proposals.length === 0 || currentMonth !== getCurrentMonthKey());

    if (!configured) {
        menuValue.textContent = 'לא מחובר';
        return;
    }
    let text;
    if (bankbox.fetching) text = 'BankBox · מסנכרן…';
    else if (bankbox.error) text = `BankBox · ${bankbox.error === 'network' ? 'אין חיבור' : 'שגיאה'}`;
    else if (bankbox.summary) text = `BankBox · נתוני בנק מ-${formatBankTime(bankbox.summary.lastScrapeAt)}${bankbox.summary.lastScrapeStatus === 'ok' ? '' : ' (חלקי)'}`;
    else text = 'BankBox · עוד לא סונכרן';
    line.textContent = text;
    line.dataset.state = bankbox.error ? 'error' : 'ok';
    menuValue.textContent = bankbox.error ? 'אין חיבור' : 'מחובר';
    const count = bankbox.proposals.length;
    document.getElementById('bankUpdatesText').textContent = count === 1 ? 'עדכון אחד מהבנק' : `${count} עדכונים מהבנק`;

    // תגית "מהבנק" ליד העו"ש, כל עוד הוא שווה לערך שאושר מהבנק
    const applied = allData.settings.bankbox.appliedBalance;
    const chip = document.getElementById('balanceBankChip');
    const fromBank = applied && currentMonth === applied.month && allData[currentMonth] && safeCalc(allData[currentMonth].balance || 0) === applied.value;
    chip.classList.toggle('hidden', !fromBank);
    if (fromBank) chip.textContent = `מהבנק · ${formatBankTime(applied.at)}`;
}

function describeProposal(p) {
    const month = allData[getCurrentMonthKey()];
    if (p.kind === 'balance') {
        return { title: 'עו״ש עכשיו', detail: `${formatMoney(p.from)} ← ${formatMoney(p.to)}`, note: p.at ? `לפי הבנק, ${formatBankTime(p.at)}` : '' };
    }
    const row = (month[p.list || 'expenses'] || []).find(t => t.id === p.rowId);
    const name = row ? row.description : '';
    if (p.kind === 'card-amount') {
        return { title: name, detail: `${formatMoney(p.from)} ← ${formatMoney(p.to)}`, note: `חיוב צפוי ב-${formatBankDate(p.date)}${p.estimated ? ' · הערכה לפי התנועות בכרטיס' : ''}` };
    }
    const verb = p.tx.amount > 0 ? 'נכנס' : 'ירד';
    return {
        title: name,
        detail: `${verb} בבנק ${formatMoney(Math.abs(p.tx.amount))} ב-${formatBankDate(p.tx.date)}`,
        note: `"${p.tx.description}"${p.card ? ' · חיוב כרטיס אשראי' : ''}${p.standing ? ' (הוראת קבע – כדאי לוודא)' : ''} · יסומן כ"עבר בבנק" ולא ייספר שוב`
    };
}

function openBankReview() {
    // העדכונים הם תמיד לחודש של היום - עוברים אליו אם מוצג חודש אחר
    if (currentMonth !== getCurrentMonthKey() && allData[getCurrentMonthKey()]) {
        currentMonth = getCurrentMonthKey();
        showCurrentMonth();
    }
    const container = document.getElementById('bankReviewList');
    const groups = [
        { title: 'עו״ש', kinds: ['balance'] },
        { title: 'כרטיסי אשראי', kinds: ['card-amount'] },
        { title: 'עבר בבנק', kinds: ['pass'] }
    ];
    container.innerHTML = '';
    groups.forEach(group => {
        const items = bankbox.proposals.filter(p => group.kinds.includes(p.kind));
        if (items.length === 0) return;
        const section = document.createElement('div');
        section.className = 'bank-review-group';
        section.innerHTML = `<div class="sheet-group-title">${group.title}</div>`;
        const list = document.createElement('div');
        list.className = 'sheet-list';
        items.forEach(p => {
            const d = describeProposal(p);
            const label = document.createElement('label');
            label.className = 'bank-review-row';
            label.innerHTML = `
                <input type="checkbox" checked data-key="${sanitizeHTML(p.key)}">
                <span class="bank-review-text">
                    <span class="bank-review-title">${sanitizeHTML(d.title)}</span>
                    <span class="bank-review-detail" dir="auto">${sanitizeHTML(d.detail)}</span>
                    ${d.note ? `<span class="bank-review-note">${sanitizeHTML(d.note)}</span>` : ''}
                </span>`;
            list.appendChild(label);
        });
        section.appendChild(list);
        container.appendChild(section);
    });
    updateBankReviewButton();
    document.getElementById('bankReviewModal').classList.add('active');
}

function updateBankReviewButton() {
    const count = document.querySelectorAll('#bankReviewList input[type="checkbox"]:checked').length;
    const btn = document.getElementById('bankReviewApplyBtn');
    btn.disabled = count === 0;
    btn.textContent = count === 0 ? 'לא נבחרו שינויים' : `החלת ${count === 1 ? 'שינוי אחד' : `${count} שינויים`}`;
}

function closeBankReview() {
    document.getElementById('bankReviewModal').classList.remove('active');
}

function confirmBankReview() {
    const keys = [...document.querySelectorAll('#bankReviewList input[type="checkbox"]:checked')].map(el => el.dataset.key);
    closeBankReview();
    applyBankProposals(keys);
    refreshBankProposals();
    renderBankStatus();
}

// ---------- הגדרות החיבור ----------

function openBankSettings() {
    const cfg = getBankboxSettings() || {};
    document.getElementById('bankUrlInput').value = cfg.baseUrl || '';
    document.getElementById('bankTokenInput').value = '';
    document.getElementById('bankTokenInput').placeholder = cfg.token ? '•••••••• (שמור. להחלפה: להדביק מפתח חדש)' : 'bbx_...';
    document.getElementById('bankSettingsError').textContent = '';
    document.getElementById('bankDisconnectBtn').classList.toggle('hidden', !isBankboxConfigured());
    renderBankCardLinks();
    document.getElementById('bankSettingsModal').classList.add('active');
}

function closeBankSettings() {
    document.getElementById('bankSettingsModal').classList.remove('active');
}

async function saveBankSettings() {
    const errorEl = document.getElementById('bankSettingsError');
    const btn = document.getElementById('bankSaveBtn');
    const parsed = parseBankboxUrl(document.getElementById('bankUrlInput').value);
    const baseUrl = parsed.url;
    const existing = getBankboxSettings() || {};
    const token = document.getElementById('bankTokenInput').value.trim() || existing.token;
    if (!baseUrl) { errorEl.textContent = BANKBOX_ERROR_TEXTS[parsed.error]; return; }
    if (!token) { errorEl.textContent = 'צריך להדביק את מפתח הגישה שנוצר ב-BankBox.'; return; }

    btn.disabled = true;
    errorEl.textContent = 'בודק חיבור…';
    const result = await fetchBankboxSummary({ baseUrl, token });
    btn.disabled = false;
    if (!result.ok) {
        errorEl.textContent = bankboxErrorText(result, baseUrl);
        return;
    }
    saveStateForUndo();
    allData.settings.bankbox = { ...existing, baseUrl, token };
    bankbox.summary = result.data;
    bankbox.fetchedAt = Date.now();
    bankbox.error = null;
    saveData();
    refreshBankProposals();
    renderBankStatus();
    document.getElementById('bankTokenInput').value = '';
    document.getElementById('bankDisconnectBtn').classList.remove('hidden');
    errorEl.textContent = '';
    renderBankCardLinks();
    document.getElementById('bankSettingsStatus').textContent = `מחובר ✓ · ${(result.data.accounts || []).length} חשבונות, ${(result.data.cards || []).length} כרטיסים`;
}

async function disconnectBankbox() {
    const confirmed = await showAsyncConfirm('ניתוק BankBox', 'לנתק את המצפן מ-BankBox? הכתובת ומפתח הגישה יימחקו מהמצפן. שום נתון אחר לא ישתנה.');
    if (!confirmed) return;
    saveStateForUndo();
    delete allData.settings.bankbox;
    bankbox.summary = null;
    bankbox.proposals = [];
    bankbox.error = null;
    bankbox.fetchedAt = 0;
    saveData();
    closeBankSettings();
    render();
}

// שיוך שורות אשראי במצפן (בחודש הנוכחי) לכרטיסים ב-BankBox
function renderBankCardLinks() {
    const container = document.getElementById('bankCardLinks');
    const cards = (bankbox.summary && bankbox.summary.cards) || [];
    const month = allData[getCurrentMonthKey()];
    const rows = month ? (month.expenses || []).filter(t => t.type === 'variable') : [];
    container.innerHTML = '';
    document.getElementById('bankCardLinksSection').classList.toggle('hidden', cards.length === 0);
    if (cards.length === 0) return;

    cards.forEach(card => {
        const linkedRow = rows.find(r => (r.bankCardIds || []).includes(card.id));
        const suggested = !linkedRow && card.last4 ? rows.find(r => !(r.bankCardIds || []).length && String(r.description).includes(card.last4)) : null;
        const wrapper = document.createElement('div');
        wrapper.className = 'bank-card-link';
        const options = ['<option value="">— בלי שיוך —</option>']
            .concat(rows.map(r => `<option value="${sanitizeHTML(r.id)}" ${(linkedRow || suggested) && (linkedRow || suggested).id === r.id ? 'selected' : ''}>${sanitizeHTML(r.description)}</option>`));
        wrapper.innerHTML = `
            <div class="bank-card-name">${sanitizeHTML(card.name || BANK_PROVIDER_NAMES[card.provider] || card.provider)}
                <span class="bank-card-meta" dir="ltr">${card.last4 ? '••' + sanitizeHTML(card.last4) : ''}</span>
                ${!card.nextChargeDate && !(card.upcomingCharges || []).length ? '<span class="bank-card-meta">· אין חיוב קרוב</span>' : ''}
                ${suggested ? '<span class="auto-chip">הצעה</span>' : ''}
            </div>
            <select class="form-input bank-card-select" data-card-id="${sanitizeHTML(card.id)}" aria-label="שורת אשראי במצפן">${options.join('')}</select>`;
        container.appendChild(wrapper);
    });
    if (rows.length === 0) {
        container.insertAdjacentHTML('beforeend', '<p class="bank-hint">אין בחודש הנוכחי שורות מסוג "כרטיס אשראי" לשייך.</p>');
    }
}

function saveBankCardLinks() {
    const month = allData[getCurrentMonthKey()];
    if (!month) return;
    saveStateForUndo();
    const rows = (month.expenses || []).filter(t => t.type === 'variable');
    rows.forEach(r => { r.bankCardIds = []; });
    document.querySelectorAll('#bankCardLinks .bank-card-select').forEach(select => {
        const row = rows.find(r => r.id === select.value);
        if (row) row.bankCardIds.push(select.dataset.cardId);
    });
    rows.forEach(r => { if (r.bankCardIds.length === 0) delete r.bankCardIds; });
    saveData();
    refreshBankProposals();
    render();
    renderBankCardLinks();
    document.getElementById('bankSettingsStatus').textContent = 'השיוך נשמר ✓';
}

function setupBankbox() {
    document.getElementById('bankReviewList').addEventListener('change', updateBankReviewButton);
    document.getElementById('bankUpdatesBanner').addEventListener('click', openBankReview);
    document.getElementById('bankStatusLine').addEventListener('click', () => syncBankbox({ manual: true }));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') maybeAutoSyncBankbox();
    });
}
