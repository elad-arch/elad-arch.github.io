// ================================================
// =========== הגדרות כלליות ===========
// ================================================
let allData = {};
let currentMonth;
let currentType = 'income';
let editingId = null;
let chartInstance = null;
let filterIncome = 'all';
let filterExpense = 'all';
let previousState = null;
let selectedTransactionType = 'onetime';
let currentTransactionTags = []; // State for tags in the modal
let sortSettings = {
    income: { mode: 'manual', direction: 'asc' },
    expense: { mode: 'manual', direction: 'asc' }
};
let manualSortActive = { income: false, expense: false };

// פונקציית עזר לחישוב מדויק (מונעת שגיאות עשרוניות)
function safeCalc(amount) {
    return Math.round(amount * 100) / 100;
}

// ₪4,250 / ₪4,250.50 / -₪3,600 (אגורות רק כשיש)
function formatMoney(value) {
    const abs = Math.abs(safeCalc(value || 0));
    const digits = Number.isInteger(abs) ? 0 : 2;
    return `${value < 0 ? '-' : ''}₪${abs.toLocaleString('he-IL', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

function getMonthName(monthKey) {
    const [year, month] = monthKey.split('-');
    return new Date(year, month - 1).toLocaleString('he-IL', { month: 'long' });
}

// ================================================
// =========== פונקציית אבטחה (Sanitization) ===========
// ================================================
function sanitizeHTML(str) {
    if (!str) return "";
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

// ================================================
// =========== אחסון: במכשיר (מוצפן) + גיבוי ידני לענן ===========
// ================================================
// הנתונים נשמרים במכשיר, מוצפנים בסיסמה שלך. לכן האפליקציה נפתחת מיד ועובדת גם בלי אינטרנט.
// הענן משמש לגיבוי ולהעברה בין מכשירים, רק כשלוחצים "גבה לענן" או "טען מהענן".

const LOCAL_DATA_KEY = 'budgetDataEnc';
const SYNC_META_KEY = 'syncMeta';
const LOCAL_SAVE_DELAY = 300;
const PBKDF2_ITERATIONS = 310000;
const AUTH_SALT = 'mazpen-auth-v1';

const sync = {
    ready: false,          // האם הנתונים נפתחו (לפני זה אסור לשמור!)
    password: null,
    token: null,           // טוקן גישה לשרת, נגזר מהסיסמה רק כשצריך את הענן
    key: null,             // מפתח ההצפנה (AES-GCM), נגזר מהסיסמה
    salt: null,
    meta: { cloudVersion: null, backedUpHash: null, lastBackupAt: null, dirtySince: null },
    currentHash: null,     // טביעת אצבע של הנתונים כפי שנשמרו במכשיר
    lastLocalJson: null,
    localTimer: null,
    localSaving: Promise.resolve(),
    busy: false
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function base64ToBytes(base64) {
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(text));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function importPasswordKey(password) {
    return crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}

async function deriveAuthToken(password) {
    const baseKey = await importPasswordKey(password);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: textEncoder.encode(AUTH_SALT), iterations: PBKDF2_ITERATIONS },
        baseKey, 256
    );
    return bytesToBase64(new Uint8Array(bits)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function deriveEncryptionKey(password, salt) {
    const baseKey = await importPasswordKey(password);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
        baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
}

async function encryptJson(json) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sync.key, textEncoder.encode(json));
    return JSON.stringify({
        v: 2,
        salt: bytesToBase64(sync.salt),
        iv: bytesToBase64(iv),
        ct: bytesToBase64(new Uint8Array(cipher))
    });
}

/**
 * מפענח מידע מוצפן (מהמכשיר או מהענן). תומך גם בפורמט הישן של הענן (CryptoJS).
 * מחזיר { data, key, salt } או null אם הסיסמה שגויה. בפורמט הישן key ו-salt הם null.
 */
async function decryptPayload(payload, password) {
    let envelope = null;
    try { envelope = JSON.parse(payload); } catch (e) { /* פורמט ישן */ }

    if (envelope && envelope.v === 2) {
        try {
            const salt = base64ToBytes(envelope.salt);
            const key = await deriveEncryptionKey(password, salt);
            const plain = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: base64ToBytes(envelope.iv) }, key, base64ToBytes(envelope.ct)
            );
            return { data: JSON.parse(textDecoder.decode(plain)), key, salt };
        } catch (e) {
            return null;
        }
    }

    try {
        const decryptedString = CryptoJS.AES.decrypt(payload, password).toString(CryptoJS.enc.Utf8);
        return decryptedString ? { data: JSON.parse(decryptedString), key: null, salt: null } : null;
    } catch (e) {
        return null;
    }
}

function loadSyncMeta() {
    try {
        const saved = JSON.parse(localStorage.getItem(SYNC_META_KEY));
        if (saved && typeof saved === 'object') sync.meta = { ...sync.meta, ...saved };
    } catch (e) { /* ברירת מחדל */ }
}

function saveSyncMeta() {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(sync.meta));
}

// ---------- שמירה במכשיר ----------

// מעתיק את העו"ש מהשדה במסך אל הנתונים של החודש הנוכחי
function syncBalanceFromInput() {
    if (sync.ready && allData[currentMonth] && !isForecastMonth(currentMonth)) {
        allData[currentMonth].balance = parseFloat(document.getElementById('currentBalanceInput').value) || 0;
    }
}

// שומר את השינויים במכשיר (מוצפן). נקרא אחרי כל שינוי.
function saveData() {
    if (!sync.ready) return;
    syncBalanceFromInput();
    recomputeForecastBalances();
    localStorage.setItem('currentMonth', currentMonth);
    clearTimeout(sync.localTimer);
    sync.localTimer = setTimeout(flushLocalSave, LOCAL_SAVE_DELAY);
}

function flushLocalSave() {
    clearTimeout(sync.localTimer);
    sync.localTimer = null;
    if (!sync.ready) return sync.localSaving;

    const json = JSON.stringify(allData);
    if (json === sync.lastLocalJson) return sync.localSaving;
    sync.lastLocalJson = json;

    // השמירות רצות אחת אחרי השנייה, כדי שגרסה ישנה לא תדרוס חדשה
    const run = async () => {
        const payload = await encryptJson(json);
        try {
            localStorage.setItem(LOCAL_DATA_KEY, payload);
        } catch (e) {
            console.error('Local save failed:', e);
            openConfirmModal('שגיאה', 'לא ניתן לשמור את הנתונים במכשיר (ייתכן שהאחסון מלא). מומלץ לגבות לענן או לייצא קובץ.', closeConfirmModal);
        }
        sync.currentHash = await sha256Hex(json);
        trackDirtySince();
        updateBackupStatus();
    };
    sync.localSaving = sync.localSaving.then(run, run);
    return sync.localSaving;
}

// ---------- ענן ----------

async function getAuthToken() {
    if (!sync.token) sync.token = await deriveAuthToken(sync.password);
    return sync.token;
}

async function cloudFetch(method, body) {
    const token = await getAuthToken();
    const headers = { 'Authorization': `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch('/api/data', { method, headers, body, cache: 'no-store' });
}

/**
 * טוען מהענן ומפענח. מחזיר { status: 'ok' | 'wrong_password' | 'error', data, version }
 */
async function fetchCloudData() {
    let response;
    try {
        response = await cloudFetch('GET');
    } catch (e) {
        return { status: 'error' };
    }
    if (response.status === 401) return { status: 'wrong_password' };
    if (!response.ok) return { status: 'error' };

    const { data, version } = await response.json();
    if (!data) return { status: 'ok', data: null, version };
    const decrypted = await decryptPayload(data, sync.password);
    if (!decrypted) return { status: 'wrong_password' };
    return { status: 'ok', data: decrypted.data, version };
}

function isBackedUp() {
    return !!sync.currentHash && sync.currentHash === sync.meta.backedUpHash;
}

const BACKUP_REMINDER_DAYS = 3;

// זוכר ממתי יש במכשיר שינויים שלא גובו (בשביל תזכורת הגיבוי)
function trackDirtySince() {
    const dirtySince = isBackedUp() ? null : (sync.meta.dirtySince || Date.now());
    if (dirtySince !== sync.meta.dirtySince) {
        sync.meta.dirtySince = dirtySince;
        saveSyncMeta();
    }
}

function getUnbackedDays() {
    if (isBackedUp() || !sync.meta.dirtySince) return 0;
    return Math.floor((Date.now() - sync.meta.dirtySince) / (24 * 60 * 60 * 1000));
}

function formatDateTime(timestamp) {
    if (!timestamp) return 'אף פעם';
    return new Date(timestamp).toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function updateBackupStatus() {
    const btn = document.getElementById('backupBtn');
    if (!btn) return;
    const unbackedDays = getUnbackedDays();
    const state = sync.busy ? 'busy' : (isBackedUp() ? 'saved' : (unbackedDays >= BACKUP_REMINDER_DAYS ? 'overdue' : 'dirty'));
    btn.dataset.state = state;
    document.getElementById('backupBtnText').textContent = { saved: 'מגובה', dirty: 'גבה לענן', overdue: 'גבה לענן!', busy: 'רגע…' }[state];
    const last = `גיבוי אחרון: ${formatDateTime(sync.meta.lastBackupAt)}`;
    const titles = {
        dirty: `יש שינויים שעוד לא גובו לענן. לחץ לגיבוי. (${last})`,
        overdue: `יש שינויים שלא גובו כבר ${unbackedDays} ימים, והם קיימים רק במכשיר הזה. לחץ לגיבוי. (${last})`
    };
    btn.title = titles[state] || last;
    const menuLastBackup = document.getElementById('menuLastBackup');
    if (menuLastBackup) menuLastBackup.textContent = `גיבוי אחרון: ${formatDateTime(sync.meta.lastBackupAt)}`;
}

// מציב נתונים שנטענו מהענן, שומר אותם במכשיר ומסמן אותם כמגובים
async function applyCloudData(data, version) {
    previousState = null;
    document.getElementById('undoBtn').disabled = true;
    applyLoadedData(data);
    await flushLocalSave();
    sync.meta.cloudVersion = version;
    sync.meta.backedUpHash = sync.currentHash;
    sync.meta.dirtySince = null;
    saveSyncMeta();
    updateBackupStatus();
}

async function backupToCloud() {
    if (!sync.ready || sync.busy) return;
    syncBalanceFromInput();
    await flushLocalSave();

    sync.busy = true;
    updateBackupStatus();
    try {
        const json = JSON.stringify(allData);
        const body = JSON.stringify({ data: await encryptJson(json), baseVersion: sync.meta.cloudVersion });
        const response = await cloudFetch('POST', body);

        if (response.status === 409) {
            const { version } = await response.json();
            sync.busy = false;
            updateBackupStatus();
            const choice = await showChoiceDialog(
                'בענן יש גרסה אחרת',
                'מאז הטעינה או הגיבוי האחרון במכשיר הזה, נשמרה בענן גרסה אחרת (כנראה ממכשיר אחר).<br>מה לעשות?',
                [
                    { label: 'גבה ודרוס את הענן', value: 'overwrite', style: 'modal-btn-save' },
                    { label: 'טען את הגרסה מהענן', value: 'load' },
                    { label: 'ביטול', value: 'cancel' }
                ]
            );
            if (choice === 'overwrite') {
                sync.meta.cloudVersion = version;
                saveSyncMeta();
                return backupToCloud();
            }
            if (choice === 'load') return loadFromCloud();
            return;
        }
        if (response.status === 401) {
            openConfirmModal('שגיאה', 'הסיסמה לא תואמת את המאגר בענן. הגיבוי לא בוצע.', closeConfirmModal);
            return;
        }
        if (!response.ok) throw new Error(`Backup failed: ${response.status}`);

        const { version } = await response.json();
        sync.meta.cloudVersion = version;
        sync.meta.backedUpHash = await sha256Hex(json);
        sync.meta.lastBackupAt = Date.now();
        sync.meta.dirtySince = null;
        saveSyncMeta();
    } catch (error) {
        console.error('Error backing up to cloud:', error);
        openConfirmModal('שגיאה', 'הגיבוי לענן נכשל. בדוק את החיבור לאינטרנט ונסה שוב.', closeConfirmModal);
    } finally {
        sync.busy = false;
        updateBackupStatus();
    }
}

async function loadFromCloud() {
    if (!sync.ready || sync.busy) return;
    syncBalanceFromInput();
    await flushLocalSave();

    if (!isBackedUp()) {
        const confirmed = await showAsyncConfirm(
            'טעינה מהענן',
            'במכשיר יש שינויים שעוד <b>לא גובו</b> לענן. הטעינה תחליף אותם בגרסה מהענן. להמשיך?'
        );
        if (!confirmed) return;
    }

    sync.busy = true;
    updateBackupStatus();
    try {
        const result = await fetchCloudData();
        if (result.status === 'wrong_password') {
            openConfirmModal('שגיאה', 'הסיסמה לא תואמת את המאגר בענן.', closeConfirmModal);
            return;
        }
        if (result.status === 'error') {
            openConfirmModal('שגיאה', 'הטעינה מהענן נכשלה. בדוק את החיבור לאינטרנט ונסה שוב.', closeConfirmModal);
            return;
        }
        if (!result.data) {
            openConfirmModal('מידע', 'אין עדיין גיבוי בענן.', closeConfirmModal);
            return;
        }
        await applyCloudData(result.data, result.version);
        openConfirmModal('הצלחה', 'הנתונים נטענו מהענן.', closeConfirmModal);
    } finally {
        sync.busy = false;
        updateBackupStatus();
    }
}

// ---------- חלון בחירה חוסם ----------

/**
 * חלון חוסם עם כפתורי בחירה (לא נסגר ב-Escape או בלחיצה בחוץ).
 * מחזיר Promise עם ה-value של הכפתור שנבחר.
 */
function showChoiceDialog(title, html, buttons) {
    return new Promise(resolve => {
        const screen = document.getElementById('choiceScreen');
        document.getElementById('choiceTitle').textContent = title;
        document.getElementById('choiceText').innerHTML = html;
        const actions = document.getElementById('choiceActions');
        actions.innerHTML = '';
        buttons.forEach(({ label, value, style }) => {
            const btn = document.createElement('button');
            btn.className = `modal-btn ${style || 'modal-btn-cancel'}`;
            btn.textContent = label;
            btn.addEventListener('click', () => {
                screen.classList.remove('active');
                resolve(value);
            });
            actions.appendChild(btn);
        });
        screen.classList.add('active');
    });
}

// ---------- כניסה ----------

function getRememberedPassword() {
    try {
        return localStorage.getItem('syncPassword') || sessionStorage.getItem('syncPassword');
    } catch (e) {
        return null;
    }
}

function rememberPassword(password, onThisDevice) {
    try {
        sessionStorage.setItem('syncPassword', password);
        if (onThisDevice) localStorage.setItem('syncPassword', password);
        else localStorage.removeItem('syncPassword');
    } catch (e) { /* לא קריטי */ }
}

function forgetPassword() {
    try {
        localStorage.removeItem('syncPassword');
        sessionStorage.removeItem('syncPassword');
    } catch (e) { /* לא קריטי */ }
}

function showLockScreen(errorText = '') {
    document.getElementById('lockScreen').classList.add('active');
    document.getElementById('lockError').textContent = errorText;
    document.getElementById('lockSubmitBtn').disabled = false;
    document.getElementById('lockResetBtn').hidden = !localStorage.getItem(LOCAL_DATA_KEY);
    document.getElementById('lockPasswordInput').focus();
}

/**
 * כניסה: אם יש נתונים במכשיר - פותח אותם (בלי אינטרנט).
 * אם אין (מכשיר חדש) - טוען פעם אחת מהגיבוי בענן.
 */
async function unlock(password, rememberOnDevice) {
    document.getElementById('lockSubmitBtn').disabled = true;
    document.getElementById('lockError').textContent = 'פותח…';

    if (!window.crypto || !crypto.subtle) {
        showLockScreen('הדפדפן לא תומך בהצפנה (האתר חייב לרוץ ב-https).');
        return;
    }

    sync.password = password;
    sync.token = null;

    const localPayload = localStorage.getItem(LOCAL_DATA_KEY);
    if (localPayload) {
        const decrypted = await decryptPayload(localPayload, password);
        if (!decrypted || !decrypted.key) {
            forgetPassword();
            showLockScreen('הסיסמה שגויה.');
            return;
        }
        sync.key = decrypted.key;
        sync.salt = decrypted.salt;
        loadSyncMeta();
        await finishUnlock(decrypted.data, rememberOnDevice);
        return;
    }

    // --- אין נתונים במכשיר: טעינה ראשונה מהענן ---
    document.getElementById('lockError').textContent = 'טוען מהגיבוי בענן…';
    const result = await fetchCloudData();
    if (result.status === 'wrong_password') {
        forgetPassword();
        showLockScreen('הסיסמה שגויה.');
        return;
    }
    if (result.status === 'error') {
        showLockScreen('אין חיבור לשרת. בפעם הראשונה במכשיר הזה צריך אינטרנט כדי לטעון את הגיבוי.');
        return;
    }

    sync.salt = crypto.getRandomValues(new Uint8Array(16));
    sync.key = await deriveEncryptionKey(password, sync.salt);
    sync.meta = { cloudVersion: result.version, backedUpHash: null, lastBackupAt: null, dirtySince: null };

    // נתונים לא מוצפנים מגרסה ישנה של האפליקציה
    let legacyData = null;
    try {
        const legacyJson = localStorage.getItem('budgetData');
        legacyData = legacyJson ? JSON.parse(legacyJson) : null;
    } catch (e) { /* התעלם מנתונים פגומים */ }

    let dataToUse = result.data;
    let fromCloud = !!result.data;

    if (legacyData && result.data) {
        const choice = await showChoiceDialog(
            'נמצאו נתונים ישנים במכשיר',
            'במכשיר הזה שמורים נתונים מגרסה קודמת של האפליקציה, וגם בענן יש גיבוי.<br>באיזו גרסה להשתמש?',
            [
                { label: 'הגיבוי מהענן', value: 'cloud', style: 'modal-btn-save' },
                { label: 'הנתונים מהמכשיר', value: 'local' }
            ]
        );
        if (choice === 'local') {
            dataToUse = legacyData;
            fromCloud = false;
        }
    } else if (legacyData) {
        dataToUse = legacyData;
        fromCloud = false;
    } else if (!result.data) {
        const choice = await showChoiceDialog(
            'מתחילים מחדש',
            'אין נתונים במכשיר ואין גיבוי בענן.<br>הסיסמה שהזנת תצפין את הנתונים, והגיבוי הראשון ינעל את המאגר בענן. <b>בלי הסיסמה אי אפשר לשחזר את הנתונים.</b>',
            [
                { label: 'המשך עם הסיסמה הזו', value: 'ok', style: 'modal-btn-save' },
                { label: 'חזור', value: 'back' }
            ]
        );
        if (choice !== 'ok') {
            showLockScreen('');
            return;
        }
    }

    await finishUnlock(dataToUse, rememberOnDevice);
    if (fromCloud) {
        sync.meta.backedUpHash = sync.currentHash;
        sync.meta.dirtySince = null;
        saveSyncMeta();
        updateBackupStatus();
    }
}

async function finishUnlock(data, rememberOnDevice) {
    rememberPassword(sync.password, rememberOnDevice);
    sync.ready = true;
    applyLoadedData(data);
    await flushLocalSave();
    saveSyncMeta();
    localStorage.removeItem('budgetData'); // הגרסה הלא מוצפנת כבר לא נחוצה
    document.getElementById('lockScreen').classList.remove('active');
    document.getElementById('lockPasswordInput').value = '';
    updateBackupStatus();

    // מבקש מהדפדפן לא למחוק את הנתונים כשחסר מקום
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
    }
}

async function lockApp() {
    syncBalanceFromInput();
    await flushLocalSave();
    forgetPassword();
    location.reload();
}

async function resetLocalData() {
    const choice = await showChoiceDialog(
        'מחיקת הנתונים מהמכשיר',
        'הנתונים יימחקו <b>מהמכשיר הזה בלבד</b>. אחרי זה תוכל להיכנס ולטעון את הגיבוי מהענן.<br>שינויים שלא גובו לענן יאבדו לתמיד.',
        [
            { label: 'מחק מהמכשיר', value: 'delete', style: 'modal-btn-danger' },
            { label: 'ביטול', value: 'cancel' }
        ]
    );
    if (choice !== 'delete') return;
    localStorage.removeItem(LOCAL_DATA_KEY);
    localStorage.removeItem(SYNC_META_KEY);
    forgetPassword();
    location.reload();
}

function initStorage() {
    document.getElementById('lockForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const password = document.getElementById('lockPasswordInput').value;
        if (!password) {
            document.getElementById('lockError').textContent = 'יש להזין סיסמה.';
            return;
        }
        unlock(password, document.getElementById('lockRememberCheckbox').checked);
    });
    document.getElementById('lockResetBtn').addEventListener('click', resetLocalData);
    document.getElementById('backupBtn').addEventListener('click', backupToCloud);
    document.getElementById('loadFromCloudBtn').addEventListener('click', () => { closeSheets(); loadFromCloud(); });
    document.getElementById('lockBtn').addEventListener('click', () => { closeSheets(); lockApp(); });

    // שמירה אחרונה במכשיר כשיוצאים מהאפליקציה
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            syncBalanceFromInput();
            flushLocalSave();
        } else {
            updateBackupStatus(); // הזמן עבר - אולי צריך להציג תזכורת גיבוי
        }
    });
    window.addEventListener('beforeunload', (e) => {
        if (sync.localTimer) {
            flushLocalSave();
            e.preventDefault();
            e.returnValue = '';
        }
    });

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('/sw.js').catch(err => console.error('Service worker registration failed:', err));
    }

    const remembered = getRememberedPassword();
    if (remembered) {
        const onDevice = !!localStorage.getItem('syncPassword');
        document.getElementById('lockRememberCheckbox').checked = onDevice;
        unlock(remembered, onDevice);
    } else {
        showLockScreen();
    }
}

// ================================================
// =========== פונקציות ניהול תגים (חדש) ===========
// ================================================
function initializeTags() {
    if (!allData.tags) {
        allData.tags = {};
    }
}

function generateTagColor(tagName) {
    let hash = 0;
    for (let i = 0; i < tagName.length; i++) {
        hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
        let value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
}

function createTag(name) {
    const tagName = name.trim();
    if (!tagName) return null;

    // Check if tag with this name already exists
    const existingTag = Object.values(allData.tags).find(t => t.name.toLowerCase() === tagName.toLowerCase());
    if (existingTag) {
        return existingTag;
    }

    const id = `tag-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newTag = {
        id: id,
        name: tagName,
        color: generateTagColor(tagName)
    };
    allData.tags[id] = newTag;
    return newTag;
}

function getTagById(id) {
    return allData.tags[id];
}

function getAllTags() {
    return Object.values(allData.tags || {}).sort((a, b) => a.name.localeCompare(b.name, 'he'));
}


// ================================================
// =========== פונקציות ניהול חודשים ===========
// ================================================
function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

function getExistingMonths() {
    return Object.keys(allData)
        .filter(key => key !== 'tags' && key !== 'settings') // 💡 התיקון: סנן גם 'settings'
        .sort();
}

// ================================================
// =========== תחזית רב-חודשית מקושרת ===========
// ================================================
// חודשים עתידיים (אחרי החודש של היום): העו"ש בתחילת החודש מחושב אוטומטית
// מהעו"ש הצפוי בסוף החודש שלפניו, ומתעדכן מיד כשמשנים חודש קודם.
// החודש הנוכחי וחודשים שעברו: העו"ש מוזן ידנית (העו"ש האמיתי בבנק).

function isForecastMonth(monthKey) {
    return monthKey > getCurrentMonthKey();
}

function getMonthFinalBalance(monthKey) {
    const monthData = allData[monthKey];
    if (!monthData) return 0;
    const income = (monthData.income || []).reduce((sum, t) => safeCalc(sum + (t.checked ? t.amount : 0)), 0);
    const expenses = (monthData.expenses || []).reduce((sum, t) => safeCalc(sum + (t.checked ? t.amount : 0)), 0);
    return safeCalc((monthData.balance || 0) + income - expenses);
}

function recomputeForecastBalances() {
    const months = getExistingMonths();
    for (let i = 1; i < months.length; i++) {
        if (isForecastMonth(months[i])) {
            allData[months[i]].balance = getMonthFinalBalance(months[i - 1]);
        }
    }
}

function updateMonthDisplay() {
    if (!currentMonth) return;
    const monthDisplay = document.getElementById('currentMonthDisplay');
    const [year, month] = currentMonth.split('-');
    const date = new Date(year, month - 1);
    const monthName = date.toLocaleString('he-IL', { month: 'long' });
    monthDisplay.textContent = `${monthName} ${year}`;
    updateNavButtons();
}

function updateNavButtons() {
    const prevMonthBtn = document.getElementById('prevMonthBtn');
    const nextMonthBtn = document.getElementById('nextMonthBtn');
    const existingMonths = getExistingMonths();
    const currentIndex = existingMonths.indexOf(currentMonth);
    prevMonthBtn.disabled = (currentIndex === 0);
    const isLastMonth = (currentIndex === existingMonths.length - 1);
    if (isLastMonth) {
        nextMonthBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        nextMonthBtn.title = "צור חודש חדש";
    } else {
        nextMonthBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
        nextMonthBtn.title = "החודש הבא";
    }
    nextMonthBtn.setAttribute('aria-label', nextMonthBtn.title);
}

function handleCreateNewMonth(newMonthKey, prevMonthKey, shouldCopy) {
    currentMonth = newMonthKey;
    const previousMonthFinalBalance = allData[prevMonthKey] ? getMonthFinalBalance(prevMonthKey) : 0;
    allData[currentMonth] = { income: [], expenses: [], balance: previousMonthFinalBalance };
    if (shouldCopy && allData[prevMonthKey]) {
        // מעתיקים רק את התנועות הקבועות של החודש הקודם, כך שתנועה קבועה שנמחקה לא חוזרת
        const prevData = allData[prevMonthKey];
        (prevData.income || []).filter(t => t.recurrence && t.recurrence.isRecurring).forEach(t => {
            allData[currentMonth].income.push({ ...t, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, checked: true });
        });
        (prevData.expenses || []).filter(t => t.type !== 'loan' && t.recurrence && t.recurrence.isRecurring).forEach(t => {
            allData[currentMonth].expenses.push({ ...t, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, checked: true });
        });

        if (allData[prevMonthKey] && allData[prevMonthKey].expenses) {
            const loansToCopy = allData[prevMonthKey].expenses.filter(t => t.type === 'loan' && !t.completed);
            
            loansToCopy.forEach(loan => {
                const newLoan = { ...loan };
                newLoan.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                // ודא של-ID המקורי יש ID גלובלי (למקרה שזו הלוואה ישנה מאוד)
                if (!newLoan.globalLoanId) {
                    newLoan.globalLoanId = `loan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                }
                
                newLoan.loanCurrent++;

                if (newLoan.loanCurrent >= newLoan.loanTotal) {
                    newLoan.completed = true;
                    newLoan.checked = true; 
                } else {
                    newLoan.completed = false;
                    newLoan.checked = true;
                }
                allData[currentMonth].expenses.push(newLoan);
            });
        }
    }

    document.getElementById('currentBalanceInput').value = allData[currentMonth].balance || 0;
    closeNewMonthModal();
    saveData();
    render();
}

function openNewMonthModal(newMonthKey, prevMonthKey) {
    const modal = document.getElementById('newMonthModal');
    modal.dataset.newMonthKey = newMonthKey;
    modal.dataset.prevMonthKey = prevMonthKey;
    modal.classList.add('active');
}

function closeNewMonthModal() {
    document.getElementById('newMonthModal').classList.remove('active');
}

function navigateMonths(direction) {
    const existingMonths = getExistingMonths();
    const currentIndex = existingMonths.indexOf(currentMonth);

    // 1. שמירת נתוני החודש הנוכחי (עם העו"ש שלו)
    saveData();

    if (direction === 1) { // Next
        if (currentIndex < existingMonths.length - 1) {
            // 2. קבע את החודש החדש
            currentMonth = existingMonths[currentIndex + 1];
            
            // 3. הצג את החודש החדש
            showCurrentMonth();
        } else { // Reached the end
            const [year, month] = currentMonth.split('-').map(Number);
            const nextDate = new Date(year, month, 1);
            const newMonthKey = `${nextDate.getFullYear()}-${(nextDate.getMonth() + 1).toString().padStart(2, '0')}`;
            openNewMonthModal(newMonthKey, currentMonth);
        }
    } else if (direction === -1) { // Previous
        if (currentIndex > 0) {
            // 2. קבע את החודש החדש
            currentMonth = existingMonths[currentIndex - 1];

            // 3. הצג את החודש החדש
            showCurrentMonth();
        }
    }
}

function openEditMonthModal() {
    const existingMonths = getExistingMonths();
    const currentIndex = existingMonths.indexOf(currentMonth);
    const isLastMonth = currentIndex === existingMonths.length - 1;
    const deleteBtn = document.getElementById('deleteMonthPermanentlyBtn');
    if (isLastMonth) {
        deleteBtn.classList.remove('hidden');
    } else {
        deleteBtn.classList.add('hidden');
    }
    document.getElementById('editMonthModal').classList.add('active');
}

function closeEditMonthModal() {
    document.getElementById('editMonthModal').classList.remove('active');
}

function resetCurrentMonth() {
    saveStateForUndo();
    const monthData = allData[currentMonth];
    monthData.income = [];
    monthData.expenses = [];
    closeEditMonthModal();
    saveData();
    render();
}

function deleteCurrentMonth() {
    saveStateForUndo();
    const monthToDelete = currentMonth;
    const existingMonths = getExistingMonths();
    const currentIndex = existingMonths.indexOf(monthToDelete);
    let newCurrentMonth = (currentIndex > 0) ? existingMonths[currentIndex - 1] : (existingMonths.length > 1 ? existingMonths[0] : getCurrentMonthKey());
    
    delete allData[monthToDelete];
    
    if (!allData[newCurrentMonth]) { // נמחק החודש היחיד
        allData[newCurrentMonth] = { income: [], expenses: [], balance: 0 };
    }
    currentMonth = newCurrentMonth;
    
    // תיקון: עדכון ידני של שדה העו"ש לערך של החודש החדש
    document.getElementById('currentBalanceInput').value = allData[currentMonth].balance || 0;

    closeEditMonthModal();
    saveData();
    render();
}

function toggleMonthJumper() {
    document.getElementById('monthJumperList').classList.toggle('active');
}

function jumpToMonth(monthKey) {
    if (currentMonth === monthKey) {
        toggleMonthJumper();
        return;
    }

    // 1. שמירת נתוני החודש הנוכחי
    saveData(); 

    // 2. קבע את החודש החדש
    currentMonth = monthKey;
    
    toggleMonthJumper();
    
    // 3. הצג את החודש החדש
    showCurrentMonth();
}

function jumpToCurrentMonth() {
    const todayMonthKey = getCurrentMonthKey();
    if (currentMonth === todayMonthKey) return;
    
    // 1. שמירת נתוני החודש הנוכחי
    saveData();

    if (allData[todayMonthKey]) {
        // 2. קבע את החודש החדש
        currentMonth = todayMonthKey;

        // 3. הצג את החודש החדש
        showCurrentMonth();
    } else {
        const existingMonths = getExistingMonths();
        const lastMonthKey = existingMonths[existingMonths.length - 1];
        openNewMonthModal(todayMonthKey, lastMonthKey);
    }
}

function populateMonthJumper() {
    const jumperList = document.getElementById('monthJumperList');
    if (!jumperList) return;
    const months = getExistingMonths().sort((a, b) => b.localeCompare(a));
    jumperList.innerHTML = '';
    if (currentMonth !== getCurrentMonthKey()) {
        const back = document.createElement('div');
        back.classList.add('filter-option', 'jump-today');
        back.textContent = 'חזרה לחודש הנוכחי';
        back.onclick = () => { toggleMonthJumper(); jumpToCurrentMonth(); };
        jumperList.appendChild(back);
    }
    months.forEach(monthKey => {
        const [year, month] = monthKey.split('-');
        const date = new Date(year, month - 1);
        const monthName = date.toLocaleString('he-IL', { month: 'long', year: 'numeric' });
        const option = document.createElement('div');
        option.classList.add('filter-option');
        if (monthKey === currentMonth) {
            option.classList.add('selected');
        }
        option.textContent = monthName;
        option.onclick = () => jumpToMonth(monthKey);
        jumperList.appendChild(option);
    });
}

/**
 * פונקציית עזר לתיקון נתונים ישנים (Migration)
 * כולל קישור חכם של הלוואות קיימות
 */
function migrateData(data) {
    if (!data) return {};
    const loanGroups = new Map(); // Key: description, Value: globalLoanId
    const monthKeys = Object.keys(data).filter(key => key !== 'tags' && key !== 'settings' && data[key]).sort();
    const loansOf = key => (Array.isArray(data[key].expenses) ? data[key].expenses : []).filter(t => t.type === 'loan');

    // שלב 1: הלוואות ישנות בלי מזהה גלובלי מקושרות לפי שם.
    // הלוואה שכבר יש לה מזהה משלה לא משתנה, כך ששתי הלוואות שונות עם אותו שם לא מתמזגות.
    monthKeys.forEach(key => loansOf(key).forEach(t => {
        if (t.globalLoanId && !loanGroups.has(t.description)) loanGroups.set(t.description, t.globalLoanId);
    }));
    monthKeys.forEach(key => loansOf(key).forEach(t => {
        if (t.globalLoanId) return;
        if (!loanGroups.has(t.description)) {
            loanGroups.set(t.description, `loan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
        }
        t.globalLoanId = loanGroups.get(t.description);
    }));

    // שלב 2: בצע את שאר המיגרציות (כמו תיקון 'recurrence')
    Object.keys(data).forEach(key => {
        if (key === 'tags' || !data[key]) return;
        ['income', 'expenses'].forEach(type => {
            if (data[key][type] && Array.isArray(data[key][type])) {
                data[key][type].forEach(t => {
                    // 1. אם אובייקט 'recurrence' חסר
                    if (!t.recurrence) {
                        t.recurrence = { isRecurring: false, dayOfMonth: null };
                    }
                    
                    // 2. תיקון לנתונים ישנים
                    if (t.recurrence.isRecurring && (t.recurrence.dayOfMonth === null || typeof t.recurrence.dayOfMonth === 'undefined')) {
                        t.recurrence.isRecurring = false;
                        t.recurrence.dayOfMonth = null;
                    }
                });
            }
        });
    });
    return data;
}


/**
 * מציב נתונים שנטענו (מהענן או מקובץ) כמצב הנוכחי של האפליקציה ומציג אותם
 */
function applyLoadedData(data) {
    allData = migrateData(data || {});
    if (!allData.settings) allData.settings = {};
    initializeTags();

    const months = getExistingMonths();
    const savedMonth = localStorage.getItem('currentMonth');
    const todayKey = getCurrentMonthKey();
    if (savedMonth && months.includes(savedMonth)) {
        currentMonth = savedMonth;
    } else if (months.includes(todayKey) || months.length === 0) {
        currentMonth = todayKey;
    } else {
        currentMonth = months[months.length - 1];
    }

    loadFilters();
    showCurrentMonth();
}

/**
 * מציג את החודש שב-currentMonth (יוצר אותו אם הוא לא קיים)
 */
function showCurrentMonth() {
    if (!allData[currentMonth]) {
        allData[currentMonth] = { income: [], expenses: [], balance: 0 };
    }
    localStorage.setItem('currentMonth', currentMonth);
    manualSortActive = { income: false, expense: false };
    document.getElementById('currentBalanceInput').value = allData[currentMonth].balance || 0;
    render();
}

// ================================================
// =========== פונקציות ליבה ו-UI ===========
// ================================================
function toggleLoanProgress(type, id) {
    const transaction = allData[currentMonth].expenses.find(t => t.id == id);
    if (transaction && transaction.type === 'loan') {
        transaction.isExpanded = !transaction.isExpanded;
        render();
    }
}

function selectTransactionType(type) {
    if ((type === 'loan' || type === 'variable') && currentType === 'income') return;
    selectedTransactionType = type;
    
    document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
    document.getElementById(type === 'variable' ? 'typeVariable' : (type === 'loan' ? 'typeLoan' : 'typeOnetime')).classList.add('selected');

    const loanFields = document.getElementById('loanFields');
    const recurrenceGroup = document.querySelector('.recurrence-group');
    const descriptionInput = document.getElementById('descriptionInput');
    const amountLabel = document.getElementById('amountLabel');

    if (type === 'loan') {
        recurrenceGroup.classList.add('hidden');
        loanFields.classList.add('active');
        amountLabel.textContent = "סכום תשלום חודשי (₪)";
        descriptionInput.placeholder = currentType === 'income' ? "" : "למשל: החזר משכנתא, הלוואת רכב";
    } else {
        recurrenceGroup.classList.remove('hidden');
        loanFields.classList.remove('active');
        amountLabel.textContent = "סכום (₪)";
        if (currentType === 'income') {
            descriptionInput.placeholder = "למשל: משכורת, מתנה";
        } else {
            descriptionInput.placeholder = (type === 'variable') ? "למשל: שם הכרטיס (אמקס, ויזה)" : "למשל: קניות, חשבון חשמל";
        }
    }
}

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function loadTheme() {
    const savedTheme = localStorage.getItem('themePreference') || 'auto';
    applyTheme(savedTheme);
}

function applyTheme(theme) {
    const body = document.body;
    if (theme === 'auto') {
        body.setAttribute('data-theme', getSystemTheme());
    } else {
        body.setAttribute('data-theme', theme);
    }
    updateThemeButton(theme);
}

function updateThemeButton(theme) {
    const labels = { auto: 'אוטומטי', light: 'בהיר', dark: 'כהה' };
    document.getElementById('themeValue').textContent = labels[theme] || '';
}

function cycleTheme() {
    const currentTheme = localStorage.getItem('themePreference') || 'auto';
    let newTheme;
    if (currentTheme === 'auto') {
        newTheme = 'light';
    } else if (currentTheme === 'light') {
        newTheme = 'dark';
    } else {
        newTheme = 'auto';
    }
    localStorage.setItem('themePreference', newTheme);
    applyTheme(newTheme);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const savedTheme = localStorage.getItem('themePreference') || 'auto';
    if (savedTheme === 'auto') {
        applyTheme('auto');
    }
});

function updateSummary() {
    if (!allData[currentMonth]) return;
    syncBalanceFromInput();
    const balance = allData[currentMonth].balance || 0;
    const finalBalance = getMonthFinalBalance(currentMonth);
    const limit = Math.abs(parseFloat(allData.settings && allData.settings.overdraftLimit) || 0);

    const balanceDisplay = document.getElementById('balanceDisplay');
    balanceDisplay.textContent = formatMoney(balance);
    balanceDisplay.classList.toggle('negative', balance < 0);

    const finalBalanceEl = document.getElementById('finalBalance');
    finalBalanceEl.textContent = formatMoney(finalBalance);
    finalBalanceEl.className = 'hero-tile-value ' + (finalBalance >= 0 ? 'positive' : 'negative');

    // מרווח עד המסגרת
    const marginEl = document.getElementById('overdraftMargin');
    const margin = safeCalc(finalBalance + limit);
    if (limit > 0) {
        marginEl.textContent = formatMoney(margin);
        marginEl.className = 'hero-tile-value ' + (margin < 0 ? 'negative' : (finalBalance < 0 ? 'warning' : ''));
    } else {
        marginEl.innerHTML = '<button type="button" class="link-btn" onclick="openOverdraftModal()">הגדר מסגרת</button>';
        marginEl.className = 'hero-tile-value';
    }
    document.getElementById('menuOverdraftValue').textContent = limit > 0 ? formatMoney(limit) : 'לא הוגדרה';

    // שורת הסטטוס
    let state, text;
    if (finalBalance >= 0) {
        state = 'ok';
        text = 'לא צפוי מינוס החודש';
    } else if (limit > 0 && margin >= 0) {
        state = 'warning';
        text = 'צפוי מינוס, עדיין בתוך המסגרת';
    } else if (limit > 0) {
        state = 'danger';
        text = `צפויה חריגה של ${formatMoney(-margin)} מהמסגרת`;
    } else {
        state = 'danger';
        text = `צפוי מינוס של ${formatMoney(-finalBalance)}`;
    }
    const icons = {
        ok: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
        warning: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
    };
    icons.danger = icons.warning;
    const statusEl = document.getElementById('forecastStatus');
    statusEl.dataset.state = state;
    document.getElementById('forecastStatusIcon').innerHTML = icons[state];
    document.getElementById('forecastStatusText').textContent = text;

    saveData();
}

function updateLoansSummary() {
    const loansContent = document.getElementById('loansSummaryContent');
    const noLoansMessage = document.getElementById('noLoansMessage');

    // --- חלק 1: נתונים גלובליים (סריקת כל החודשים) ---
    // משמש לחישוב "סך כל ההלוואות" ו"יתרה לתשלום"
    const latestLoansMap = new Map();
    const allMonthKeys = getExistingMonths();
    
    allMonthKeys.forEach(monthKey => {
        const monthData = allData[monthKey];
        if (monthData && monthData.expenses) {
            const loansInMonth = monthData.expenses.filter(t => t.type === 'loan');
            loansInMonth.forEach(loan => {
                latestLoansMap.set(loan.globalLoanId || loan.description, loan);
            });
        }
    });
    // זוהי רשימה של המצב העדכני ביותר של *כל* הלוואה שאי פעם הייתה קיימת
    const allLoanTransactions = Array.from(latestLoansMap.values());

    // --- 💡 חלק 2: נתוני החודש האחרון (התיקון כאן) ---
    // משמש לחישוב "הלוואות פעילות" ו"תשלום חודשי"
    
    let activeLoansInLatestMonth = [];
    if (allMonthKeys.length > 0) {
        // 1. מצא את המפתח של החודש האחרון
        const latestMonthKey = allMonthKeys[allMonthKeys.length - 1];
        // 2. קבל את הנתונים רק שלו
        const latestMonthData = allData[latestMonthKey] || { expenses: [] };
        // 3. סנן את ההלוואות רק מהחודש האחרון
        activeLoansInLatestMonth = (latestMonthData.expenses || []).filter(t => t.type === 'loan');
    }

    // --- חלק 3: הצגת הנתונים ---
    
    // אם אין הלוואות בכלל (בשום חודש), הצג הודעה
    if (allLoanTransactions.length === 0) {
        if (loansContent) loansContent.style.display = 'none';
        if (noLoansMessage) noLoansMessage.style.display = 'block';
        document.getElementById('totalLoansCount').textContent = 0;
        document.getElementById('monthlyLoanPayment').textContent = `₪0.00`;
        document.getElementById('totalLoanAmount').textContent = `₪0.00`;
        document.getElementById('remainingLoanBalance').textContent = `₪0.00`;
        document.getElementById('loansCollapsedSummary').innerHTML = `<span class="summary-label">אין הלוואות פעילות</span>`;
        return;
    }

    if (loansContent) loansContent.style.display = 'block';
    if (noLoansMessage) noLoansMessage.style.display = 'none';

    // חישוב "פעילות" על בסיס החודש האחרון במערכת
    const activeLoansCount = activeLoansInLatestMonth.length;
    const monthlyPayment = activeLoansInLatestMonth.reduce((sum, t) => sum + t.amount, 0);

    // חישוב "גלובלי" על בסיס כל הנתונים
    const totalAmount = allLoanTransactions.reduce((sum, t) => sum + (t.originalLoanAmount || 0), 0);
    
    // סנן הלוואות גלובליות שעדיין לא הסתיימו
    const activeGlobalLoans = allLoanTransactions.filter(t => t.loanCurrent < t.loanTotal);
    
    const remainingBalance = activeGlobalLoans.reduce((sum, t) => {
        const paidAmount = t.amount * t.loanCurrent;
        const remaining = (t.originalLoanAmount || 0) - paidAmount;
        return sum + (remaining > 0 ? remaining : 0);
    }, 0);

    // עדכון ה-DOM
    document.getElementById('totalLoansCount').textContent = activeLoansCount;
    document.getElementById('monthlyLoanPayment').textContent = `₪${monthlyPayment.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
    document.getElementById('totalLoanAmount').textContent = `₪${totalAmount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
    document.getElementById('remainingLoanBalance').textContent = `₪${remainingBalance.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
    document.getElementById('loansCollapsedSummary').innerHTML = `<span class="summary-label">יתרה לתשלום:</span> <span class="summary-value">₪${remainingBalance.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>`;
}



function toggleSortDropdown(type) {
    const otherDropdownId = type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense';
    document.getElementById(otherDropdownId).classList.remove('active');
    const dropdownId = type === 'income' ? 'sortDropdownIncome' : 'sortDropdownExpense';
    const dropdown = document.getElementById(dropdownId);
    if (dropdown.classList.contains('active')) {
        dropdown.classList.remove('active');
        return;
    }
    populateSortDropdown(type);
    dropdown.classList.add('active');
}

function populateSortDropdown(type) {
    const dropdownId = type === 'income' ? 'sortDropdownIncome' : 'sortDropdownExpense';
    const dropdown = document.getElementById(dropdownId);
    const currentSettings = sortSettings[type];
    const options = [
        { mode: 'manual', text: 'סידור אישי' },
        { mode: 'alpha', text: 'לפי א׳-ב׳' },
        { mode: 'amount', text: 'לפי סכום' },
        { mode: 'date', text: 'לפי תאריך' }
    ];
    dropdown.innerHTML = options.map(opt => {
        const isSelected = currentSettings.mode === opt.mode;
        let directionIndicator = '';
        if (opt.mode === 'amount' && isSelected) {
            const arrow = currentSettings.direction === 'asc' ?
                '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>' :
                '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>';
            directionIndicator = `<span class="sort-direction">${arrow}</span>`;
        }
        return `<div class="filter-option ${isSelected ? 'selected' : ''}" onclick="setSortMode('${type}', '${opt.mode}')">
                    <span>${opt.text}</span> ${directionIndicator}
                </div>`;
    }).join('');
}

function setSortMode(type, mode) {
    const settings = sortSettings[type];

    if (mode === 'manual') {
        // 💡 --- כאן הלוגיקה החדשה --- 💡
        if (settings.mode === 'manual') {
            // אם אנחנו כבר במצב ידני, הלחיצה הבאה מפעילה/מכבה את החיצים
            manualSortActive[type] = !manualSortActive[type];
        } else {
            // אם אנחנו עוברים ממצב אחר (כמו 'סכום') למצב ידני:
            // 1. קבע את המצב ל'ידני' (זה יבטל את המיון הקודם)
            settings.mode = 'manual';
            // 2. ודא שהחיצים כבויים!
            manualSortActive[type] = false; 
        }
        // 💡 --- סוף הלוגיקה החדשה --- 💡

    } else { // משתמש לחץ על 'סכום', 'א'-ב'' וכו'.
        // 1. כבה את מצב העריכה הידני (החיצים) בכל מקרה
        manualSortActive[type] = false; 
        
        // 2. טפל בהחלפת כיוון המיון (אם לוחצים על 'סכום' פעמיים)
        if (settings.mode === 'amount' && mode === 'amount') {
            settings.direction = settings.direction === 'asc' ? 'desc' : 'asc';
        } else {
            // 3. קבע את מצב המיון החדש
            settings.mode = mode;
            settings.direction = 'asc';
        }
    }

    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('active'));
    closeSheets();
    render();
}

function loadFilters() {
    let savedIncomeFilter = localStorage.getItem('incomeFilter') || 'all';
    let savedExpenseFilter = localStorage.getItem('expenseFilter') || 'all';

    // ודא שלא נטען סינון תג ישן בטעות מרענון
    filterIncome = savedIncomeFilter.startsWith('tag-') ? 'all' : savedIncomeFilter;
    filterExpense = savedExpenseFilter.startsWith('tag-') ? 'all' : savedExpenseFilter;
    
    // 💡 אין צורך לעדכן את ה-DOM מכאן, הוא יטופל דינמית
}

function moveItem(event, type, id, direction) {
    saveStateForUndo();
    event.stopPropagation();
    const arr = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const index = arr.findIndex(t => t.id == id);
    if (index === -1) return;
    if (direction === 'up' && index > 0) {
        [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
    } else if (direction === 'down' && index < arr.length - 1) {
        [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    }
    saveData();
    render();
}

function toggleFilter(type) {
    const otherDropdownId = type === 'income' ? 'sortDropdownIncome' : 'sortDropdownExpense';
    document.getElementById(otherDropdownId).classList.remove('active');
    
    const dropdownId = type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense';
    const dropdown = document.getElementById(dropdownId);

    if (dropdown.classList.contains('active')) {
        dropdown.classList.remove('active');
        return;
    }

    populateFilterDropdown(type); // 💡 קריאה לפונקציה החדשה
    dropdown.classList.add('active');
}

function setFilter(type, filter) {
    if (type === 'income') {
        filterIncome = filter;
    } else {
        filterExpense = filter;
    }

    // 💡 שינוי לוגי: אל תשמור סינון תגים זמני ב-LocalStorage
    if (filter.startsWith('tag-')) {
         // אל תעשה כלום עם localStorage
    } else {
        localStorage.setItem(`${type}Filter`, filter);
    }

    const dropdownId = type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense';
    document.getElementById(dropdownId).classList.remove('active');
    closeSheets();
    
    // אין צורך לעדכן 'selected' ידנית, התפריט ייבנה מחדש בפתיחה הבאה
    
    render();
}

function exportData() {
    const dataStr = JSON.stringify(allData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `budget-data-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

function importData(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const imported = JSON.parse(e.target.result);
                openConfirmModal('אישור ייבוא נתונים', 'האם לייבא את הנתונים? הנתונים הנוכחיים יוחלפו.', () => {
                    saveStateForUndo();
                    applyLoadedData(imported);
                    saveData();
                    closeConfirmModal();
                });
            } catch (error) {
                openConfirmModal('שגיאה', 'אירעה שגיאה בקריאת הקובץ.', closeConfirmModal);
            }
        };
        reader.readAsText(file);
    }
    event.target.value = '';
}

function showChart(type) {
    const data = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const checkedData = data.filter(t => t.checked);
    if (checkedData.length === 0) {
        const message = data.length === 0 ? 'אין נתונים להצגה בגרף.' : 'אין פריטים מסומנים להצגה בגרף.';
        openConfirmModal('מידע', message, closeConfirmModal);
        return;
    }
    document.getElementById('chartModalTitle').textContent = type === 'income' ? 'התפלגות הכנסות' : 'התפלגות הוצאות';
    document.getElementById('chartModal').classList.add('active');
    const labels = checkedData.map(t => t.description);
    const amounts = checkedData.map(t => t.amount);
    const colors = generateColors(checkedData.length);
    const ctx = document.getElementById('pieChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: amounts,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: getComputedStyle(document.body).getPropertyValue('--card-bg')
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: { size: 14 },
                        color: getComputedStyle(document.body).getPropertyValue('--text-primary')
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (c) => `${c.label}: ₪${c.parsed.toLocaleString('he-IL')} (${((c.parsed / c.dataset.data.reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%)`
                    }
                }
            }
        }
    });
}

function generateColors(count) {
    return ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'].slice(0, count);
}

function closeChartModal() {
    document.getElementById('chartModal').classList.remove('active');
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}

function deleteAllData() {
    if (Object.keys(allData).length === 1 && allData.tags) return;
    const message = `אתה עומד למחוק את <b>כל הנתונים מכל החודשים</b> לצמיתות. האם להמשיך?`;
    openConfirmModal('אישור מחיקת כל הנתונים', message, () => {
        saveStateForUndo();
        allData = {};
        currentMonth = getCurrentMonthKey();
        allData[currentMonth] = { income: [], expenses: [], balance: 0 };
        initializeTags();
        document.getElementById('currentBalanceInput').value = 0;
        saveData();
        render();
        closeConfirmModal();
    });
}

function openModal(type, id = null) {
    currentType = type;
    editingId = id;
    const modal = document.getElementById('transactionModal');
    const title = document.getElementById('modalTitle');
    const descriptionInput = document.getElementById('descriptionInput');
    const amountInput = document.getElementById('amountInput');
    const recurrenceCheckbox = document.getElementById('recurrenceCheckbox');
    const recurrenceDayInput = document.getElementById('recurrenceDayInput');

    document.getElementById('typeLoan').classList.toggle('disabled', type === 'income');
    document.getElementById('typeVariable').classList.toggle('disabled', type === 'income');
    
    [descriptionInput, amountInput, recurrenceDayInput].forEach(input => input.value = '');
    recurrenceCheckbox.checked = false;
    document.querySelector('.day-of-month-group').style.display = 'none';
    
    // Reset tags
    currentTransactionTags = [];
    renderSelectedTags();
    
    const loanCurrentInput = document.getElementById('loanCurrentInput');
    loanCurrentInput.disabled = false; 

    // 💡 אפס את שדה יום החיוב
    const loanBillingDayInput = document.getElementById('loanBillingDayInput');
    loanBillingDayInput.value = '';

    if (id) {
        const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
        const transaction = list.find(t => t.id == id);
        if (!transaction) return;

        title.textContent = 'עריכת תנועה';
        descriptionInput.value = transaction.description;
        amountInput.value = transaction.amount;
        
        let effectiveType = transaction.type;
        if (effectiveType === 'regular') effectiveType = 'onetime';
        selectTransactionType(effectiveType);

        if (transaction.type === 'loan') {
            document.getElementById('loanOriginalAmountInput').value = transaction.originalLoanAmount || '';
            document.getElementById('loanTotalInput').value = transaction.loanTotal || '';
            document.getElementById('loanCurrentInput').value = transaction.loanCurrent || '';
            loanCurrentInput.disabled = true;
            
            // 💡 מלא את שדה יום החיוב
            loanBillingDayInput.value = transaction.loanBillingDay || '';
        }
        
        if (transaction.recurrence && transaction.recurrence.isRecurring) {
            recurrenceCheckbox.checked = true;
            recurrenceDayInput.value = transaction.recurrence.dayOfMonth;
            document.querySelector('.day-of-month-group').style.display = 'flex';
        }

        if (transaction.tags && Array.isArray(transaction.tags)) {
            currentTransactionTags = transaction.tags.map(tagId => getTagById(tagId)).filter(Boolean);
            renderSelectedTags();
        }

    } else {
        title.textContent = type === 'income' ? 'הוספת הכנסה' : 'הוספת הוצאה';
        ['loanOriginalAmountInput', 'loanTotalInput', 'loanCurrentInput', 'loanBillingDayInput'].forEach(id => document.getElementById(id).value = '');
        selectTransactionType('onetime');
    }

    const extraActions = document.getElementById('editExtraActions');
    extraActions.classList.toggle('hidden', !id);
    if (id) {
        const applyBtn = document.getElementById('txApplyBtn');
        applyBtn.classList.toggle('hidden', isForecastMonth(currentMonth));
        applyBtn.onclick = () => { closeModal(); openApplyOptionsModal(type, id); };
        document.getElementById('txDeleteBtn').onclick = () => { closeModal(); deleteTransaction({ stopPropagation() {} }, type, id); };
    }

    modal.classList.add('active');
    modalInitialState = getModalFormState();
    descriptionInput.focus();
}

// ---------- הגנה מאיבוד שינויים בחלון התנועה ----------
let modalInitialState = null;

function getModalFormState() {
    const ids = ['descriptionInput', 'amountInput', 'recurrenceDayInput', 'loanOriginalAmountInput', 'loanTotalInput', 'loanCurrentInput', 'loanBillingDayInput'];
    return JSON.stringify({
        values: ids.map(id => document.getElementById(id).value),
        recurring: document.getElementById('recurrenceCheckbox').checked,
        type: selectedTransactionType,
        tags: currentTransactionTags.map(t => t.id)
    });
}

// ביטול / Escape: אם שינית משהו - שואל לפני שסוגר
async function requestCloseModal() {
    const modal = document.getElementById('transactionModal');
    if (!modal.classList.contains('active')) return;
    if (document.getElementById('choiceScreen').classList.contains('active')) return;
    if (getModalFormState() === modalInitialState) {
        closeModal();
        return;
    }
    const choice = await showChoiceDialog(
        'יש שינויים שלא נשמרו',
        'מה לעשות עם השינויים שהזנת?',
        [
            { label: 'שמור', value: 'save', style: 'modal-btn-save' },
            { label: 'צא בלי לשמור', value: 'discard' },
            { label: 'המשך לערוך', value: 'keep' }
        ]
    );
    if (choice === 'save') saveTransaction();
    else if (choice === 'discard') closeModal();
}

function closeModal() {
    document.getElementById('transactionModal').classList.remove('active');
    
    // 💡 --- שחרר את נעילת השדה בסגירה --- 💡
    document.getElementById('loanCurrentInput').disabled = false;
    
    editingId = null;
    currentTransactionTags = []; // Clear tags on close
}

async function saveTransaction() {
    saveStateForUndo();
    const description = document.getElementById('descriptionInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value);
    const isRecurring = document.getElementById('recurrenceCheckbox').checked;
    
    let dayOfMonth = parseInt(document.getElementById('recurrenceDayInput').value, 10);
    if (isNaN(dayOfMonth)) {
        dayOfMonth = null;
    }
    
    if (!description || !amount || amount <= 0) {
        openConfirmModal('שגיאה', 'נא למלא תיאור וסכום חיובי.', closeConfirmModal);
        return;
    }
    
    if (isRecurring && (dayOfMonth === null || dayOfMonth < 1 || dayOfMonth > 31)) {
        openConfirmModal('שגיאה', 'יש להזין יום חוקי בחודש (1-31) עבור תנועה קבועה.', closeConfirmModal);
        return;
    }

    const transactionData = {
        description,
        amount,
        type: selectedTransactionType,
        recurrence: {
            isRecurring: isRecurring,
            dayOfMonth: isRecurring ? dayOfMonth : null
        },
        tags: currentTransactionTags.map(tag => tag.id)
    };
    
    if (transactionData.type === 'regular') {
        transactionData.type = 'onetime';
    }

    if (selectedTransactionType === 'loan') {
        const originalLoanAmount = parseFloat(document.getElementById('loanOriginalAmountInput').value);
        const loanTotal = parseInt(document.getElementById('loanTotalInput').value);
        const loanCurrent = parseInt(document.getElementById('loanCurrentInput').value);
        
        // 💡 קרא את שדה יום החיוב
        const loanBillingDay = parseInt(document.getElementById('loanBillingDayInput').value, 10);
        
        // 💡 ודא שהוזן יום תקין
        if (isNaN(loanBillingDay) || loanBillingDay < 1 || loanBillingDay > 31) {
             openConfirmModal('שגיאה', 'נא להזין יום חיוב חוקי (1-31) עבור ההלוואה.', closeConfirmModal);
             return;
        }

        if (!originalLoanAmount || !loanTotal || isNaN(loanCurrent) || originalLoanAmount <= 0 || loanTotal < 1 || loanCurrent < 0 || loanCurrent > loanTotal || amount > originalLoanAmount) {
            openConfirmModal('שגיאה', 'נא למלא את כל פרטי ההלוואה באופן תקין.', closeConfirmModal);
            return;
        }
        transactionData.originalLoanAmount = originalLoanAmount;
        transactionData.loanTotal = loanTotal;
        transactionData.loanCurrent = loanCurrent;
        transactionData.completed = transactionData.loanCurrent >= transactionData.loanTotal;
        transactionData.type = 'loan';
        transactionData.recurrence.isRecurring = false;
        
        // 💡 הוסף את יום החיוב לנתונים
        transactionData.loanBillingDay = loanBillingDay;
    }

    const list = currentType === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;

    if (editingId) {
        // --- מצב עריכה ---
        const indexToUpdate = list.findIndex(t => t.id == editingId);
        if (indexToUpdate > -1) {
            const existingTransaction = list[indexToUpdate];
            const updatedTransaction = { ...existingTransaction, ...transactionData };
            
            if (updatedTransaction.type === 'loan') {
                const changes = [];
                if (existingTransaction.description !== updatedTransaction.description) changes.push('תיאור');
                if (existingTransaction.originalLoanAmount !== updatedTransaction.originalLoanAmount) changes.push('סכום מקורי');
                if (existingTransaction.loanTotal !== updatedTransaction.loanTotal) changes.push('מספר תשלומים');
                
                // 💡 הוסף את יום החיוב לבדיקת השינויים
                if (existingTransaction.loanBillingDay !== updatedTransaction.loanBillingDay) changes.push('יום חיוב');

                if (changes.length > 0) {
                    const confirmed = await showAsyncConfirm(
                        'עדכון גלובלי',
                        `שינוי זה (${changes.join(', ')}) יחול על הלוואה זו <b>בכל החודשים</b>. האם להמשיך?`
                    );
                    if (!confirmed) {
                        closeModal();
                        return;
                    }
                }
            }

            if (updatedTransaction.type === 'loan') {
                updatedTransaction.checked = true;
            }
            
            list[indexToUpdate] = updatedTransaction; // עדכן את התנועה הנוכחית

            // סנכרון גלובלי להלוואות (קיים מהקודם)
            if (updatedTransaction.type === 'loan' && updatedTransaction.globalLoanId) {
                const globalId = updatedTransaction.globalLoanId;
                
                getExistingMonths().forEach(monthKey => {
                    if (monthKey === currentMonth) return; 
                    const monthData = allData[monthKey];
                    if (monthData.expenses) {
                        monthData.expenses.forEach(expense => {
                            if (expense.type === 'loan' && expense.globalLoanId === globalId) {
                                expense.description = updatedTransaction.description;
                                expense.originalLoanAmount = updatedTransaction.originalLoanAmount;
                                expense.loanTotal = updatedTransaction.loanTotal;
                                
                                // 💡 סנכרן את יום החיוב גלובלית
                                expense.loanBillingDay = updatedTransaction.loanBillingDay;
                            }
                        });
                    }
                });
                
                cascadeLoanUpdates(updatedTransaction, currentMonth);
            }
        }
    } else {
        // --- מצב יצירה חדשה ---
        const newTransaction = {
            ...transactionData,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            checked: true
        };
        
        if (newTransaction.type === 'loan') {
            newTransaction.checked = true;
            newTransaction.globalLoanId = `loan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            list.push(newTransaction);
            cascadeLoanUpdates(newTransaction, currentMonth);
            backfillLoan(newTransaction, currentMonth);

        } else {
             list.push(newTransaction);
        }
    }

    saveData();
    render();
    closeModal();
}

async function deleteTransaction(event, type, id) { // 💡 --- הפך ל-async --- 💡
    event.stopPropagation();
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const transaction = list.find(t => t.id == id);
    if (!transaction) return;

    // 💡 --- לוגיקת מחיקה גלובלית --- 💡
    if (transaction.type === 'loan' && transaction.globalLoanId) {
        const confirmed = await showAsyncConfirm(
            'מחיקה גלובלית',
            `זוהי תנועת הלוואה. המחיקה תסיר את <b>"${sanitizeHTML(transaction.description)}"</b> <u>מכל החודשים</u>. האם למחוק לצמיתות?`
        );

        if (confirmed) {
            saveStateForUndo(); // שמור מצב לפני המחיקה הגלובלית
            const globalId = transaction.globalLoanId;
            
            // סרוק את כל החודשים ומחק כל מופע של ההלוואה
            getExistingMonths().forEach(monthKey => {
                const monthData = allData[monthKey];
                if (monthData.expenses) {
                    monthData.expenses = monthData.expenses.filter(expense => 
                        expense.globalLoanId !== globalId
                    );
                }
            });
            
            saveData();
            render();
        }
        // הפונקציה showAsyncConfirm סוגרת את חלון האישור
        return; // עצור כאן, סיימנו
    }
    // 💡 --- סוף לוגיקת מחיקה גלובלית --- 💡


    // --- לוגיקת מחיקה רגילה (עבור כל תנועה שאינה הלוואה) ---
    const message = `האם למחוק את <b>"${sanitizeHTML(transaction.description)}"</b> בסך <b>₪${transaction.amount.toLocaleString('he-IL')}</b>?`;
    
    // נשתמש בפונקציה החדשה גם כאן לאחידות
    const confirmed = await showAsyncConfirm('אישור מחיקת תנועה', message);
    
    if (confirmed) {
        saveStateForUndo();
        const indexToDelete = list.findIndex(t => t.id == id);
        if (indexToDelete > -1) {
            list.splice(indexToDelete, 1);
        }
        saveData();
        render();
    }
}

function toggleCheck(event, type, id) {
    saveStateForUndo();
    event.stopPropagation();
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const transaction = list.find(t => t.id == id);
    if (transaction) {
        transaction.checked = !transaction.checked;
        // הפונקציות save ו-render יקראו עכשיו מתוך handleListClick
    }
}

let currentEditingElement = null;

function editAmount(event, type, id) {
    event.stopPropagation();
    // --- 🐞 התיקון הקריטי כאן ---
    // השתמש ב-event.target כדי למצוא את האלמנט הפנימי שעליו לחצו
    // ולאחר מכן חפש את העטיפה שלו
    const amountWrapper = event.target.closest('.transaction-amount'); 
    
    if (!amountWrapper || amountWrapper.classList.contains('editing')) return;
    if (currentEditingElement) currentEditingElement.querySelector('.inline-edit-input').blur();
    
    const amountInput = amountWrapper.querySelector('.inline-edit-input');
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const transaction = list.find(t => t.id == id);
    if (!transaction) return;
    
    currentEditingElement = amountWrapper;
    amountWrapper.dataset.id = id;
    amountWrapper.classList.add('editing');
    amountInput.value = transaction.amount;
    amountInput.focus();
    amountInput.select();
}

function saveAmount(event, type) {
    const input = event.target;
    const amountWrapper = input.closest('.transaction-amount');
    const id = amountWrapper.dataset.id;
    const newAmount = parseFloat(input.value);
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const transaction = list.find(t => t.id == id);
    if (currentEditingElement) {
        currentEditingElement.classList.remove('editing');
        currentEditingElement = null;
    }
    if (transaction && !isNaN(newAmount) && newAmount >= 0 && newAmount !== transaction.amount) {
        saveStateForUndo();
        transaction.amount = newAmount;
    }
    saveData();
    render();
}

function handleEditKeys(event) {
    if (event.key === 'Enter') {
        event.target.blur();
    } else if (event.key === 'Escape') {
        event.target.value = -1;
        event.target.blur();
    }
}

function openApplyOptionsModal(type, id) {
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const transaction = list.find(t => t.id == id);
    if (!transaction) return;
    const modal = document.getElementById('applyOptionsModal');
    document.getElementById('applyOptionsTransactionInfo').innerHTML = `<span>${sanitizeHTML(transaction.description)}</span><span class="${type === 'income' ? 'positive' : 'negative'}">₪${transaction.amount.toLocaleString('he-IL')}</span>`;
    modal.querySelectorAll('.apply-option').forEach(option => {
        const newOption = option.cloneNode(true);
        option.parentNode.replaceChild(newOption, option);
        newOption.addEventListener('click', () => handleApplyAction(type, id, newOption.dataset.action));
    });
    modal.classList.add('active');
}

function handleApplyAction(type, id, action) {
    if (isForecastMonth(currentMonth)) {
        closeApplyOptionsModal();
        openConfirmModal('מידע', 'בחודש עתידי העו"ש מחושב אוטומטית מהחודש הקודם, ולכן אי אפשר להחיל עליו תנועות.', closeConfirmModal);
        return;
    }
    saveStateForUndo();
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const transaction = list.find(t => t.id == id);
    if (!transaction) return;
    const amount = transaction.amount;
    let currentBalanceValue = parseFloat(document.getElementById('currentBalanceInput').value) || 0;
    
    if (type === 'income') {
        currentBalanceValue += amount;
    } else {
        currentBalanceValue -= amount;
    }

    // --- התיקון כאן ---
    // עיגול התוצאה ל-2 ספרות עשרוניות כדי למנוע שגיאות JavaScript
    currentBalanceValue = Math.round(currentBalanceValue * 100) / 100;
    // --- סוף התיקון ---

    document.getElementById('currentBalanceInput').value = currentBalanceValue;
    
    if (action === 'apply-delete') {
        const indexToDelete = list.findIndex(t => t.id == id);
        if (indexToDelete > -1) list.splice(indexToDelete, 1);
    } else if (action === 'apply-zero') {
        transaction.amount = 0;
    } else if (action === 'apply-only') {
        transaction.checked = false; // כבר ירד מהעו"ש, אז לא לספור אותו שוב בתחזית
    }
    saveData();
    render();
    closeApplyOptionsModal();
}

function closeApplyOptionsModal() {
    document.getElementById('applyOptionsModal').classList.remove('active');
}

function saveStateForUndo() {
    syncBalanceFromInput(); // כדי שהביטול יחזיר גם את העו"ש שבשדה
    previousState = JSON.parse(JSON.stringify(allData));
    document.getElementById('undoBtn').disabled = false;
}

function undoLastAction() {
    if (previousState) {
        allData = JSON.parse(JSON.stringify(previousState));
        previousState = null;
        document.getElementById('undoBtn').disabled = true;
        showCurrentMonth(); // מעדכן גם את שדה העו"ש לפני השמירה
        saveData();
    }
}

function getFilterLabel(filter) {
    if (filter.startsWith('tag-')) {
        const tag = getTagById(filter.substring(4));
        return tag ? tag.name : 'תג';
    }
    return { active: 'פעילות', inactive: 'לא פעילות', regular: 'קבועות', variable: 'כרטיס אשראי', loan: 'הלוואות' }[filter] || '';
}

// מעל הרשימה: כמה תנועות יש, או איזה סינון פעיל (עם כפתור לניקוי)
function renderListCount(type) {
    const el = document.getElementById(type === 'income' ? 'incomeCount' : 'expenseCount');
    const filter = type === 'income' ? filterIncome : filterExpense;
    if (filter !== 'all') {
        el.innerHTML = `<button type="button" class="filter-chip" onclick="setFilter('${type}', 'all')" aria-label="נקה סינון">סינון: ${sanitizeHTML(getFilterLabel(filter))} <span aria-hidden="true">✕</span></button>`;
        return;
    }
    const list = allData[currentMonth][type === 'income' ? 'income' : 'expenses'] || [];
    const active = list.filter(t => t.checked).length;
    const inactive = list.length - active;
    el.textContent = list.length === 0 ? '' : `${active} פעילות${inactive ? ` · ${inactive} לא פעילות` : ''}`;
}

function render() {
    const currentData = allData[currentMonth];
    if (!currentData) return;

    syncBalanceFromInput();
    recomputeForecastBalances();
    updateBalanceMode();

    // 1. קבל נתונים מפולטרים וממוינים
    const filteredIncome = getFilteredAndSortedData('income');
    const filteredExpenses = getFilteredAndSortedData('expense');

    // 2. צור את ה-HTML
    const incomeList = document.getElementById('incomeList');
    incomeList.innerHTML = renderTransactionList('income', filteredIncome, currentData.income);

    const expenseList = document.getElementById('expenseList');
    expenseList.innerHTML = renderTransactionList('expense', filteredExpenses, currentData.expenses);

    // 3. עדכן סיכומים וכל השאר (הלוגיקה הזו נשארת זהה)
    // --- UPDATE TOTALS & SUMMARY ---
    const incomeTotal = filteredIncome.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = filteredExpenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);

    const labelMap = {
        all: 'סה״כ',
        regular: 'סה״כ קבועות',
        variable: 'סה״כ כ.אשראי',
        active: 'סה״כ פעילות',
        inactive: 'סה״כ לא פעילות',
        loan: 'סה״כ הלוואות'
    };
    document.getElementById('incomeTotalLabel').textContent = filterIncome === 'all' ? 'סה״כ הכנסות' : (labelMap[filterIncome] || 'סה״כ מסונן');
    document.getElementById('expenseTotalLabel').textContent = filterExpense === 'all' ? 'סה״כ הוצאות' : (labelMap[filterExpense] || 'סה״כ מסונן');
    document.getElementById('incomeTotal').textContent = formatMoney(incomeTotal);
    document.getElementById('expenseTotal').textContent = formatMoney(expenseTotal);
    // שורת הסיכום בתחתית הרשימה מוצגת רק כשיש סינון (אחרת הסכום כבר מופיע בלשונית)
    document.getElementById('incomeFooter').classList.toggle('hidden', filterIncome === 'all');
    document.getElementById('expenseFooter').classList.toggle('hidden', filterExpense === 'all');

    const totalActiveIncome = (currentData.income || []).reduce((sum, t) => safeCalc(sum + (t.checked ? t.amount : 0)), 0);
    const totalActiveExpenses = (currentData.expenses || []).reduce((sum, t) => safeCalc(sum + (t.checked ? t.amount : 0)), 0);
    document.getElementById('tabIncomeTotal').textContent = formatMoney(totalActiveIncome);
    document.getElementById('tabExpenseTotal').textContent = formatMoney(totalActiveExpenses);
    renderListCount('income');
    renderListCount('expense');

    populateMonthJumper();
    updateMonthDisplay();
    updateLoansSummary();
    updateSummary();
    const deleteAllBtn = document.getElementById('deleteAllBtn');
    const deleteMonthBtn = document.getElementById('deleteMonthBtn');
    const isDataEmpty = !currentData || ((currentData.income || []).length === 0 && (currentData.expenses || []).length === 0 && getExistingMonths().length <= 1);
    if (deleteAllBtn) deleteAllBtn.disabled = isDataEmpty;
    if (deleteMonthBtn) deleteMonthBtn.disabled = isDataEmpty;
}

// =======================================================
// =========== פונקציה 2: סינון ומיון (מתוקן) ===========
// =======================================================
function getFilteredAndSortedData(type) {
    const currentData = allData[currentMonth];
    
    const dataKey = (type === 'income') ? 'income' : 'expenses';
    const filter = (type === 'income') ? filterIncome : filterExpense;
    
    let filteredList = [...(currentData[dataKey] || [])];

    // 💡 --- לוגיקת סינון חדשה --- 💡
    if (filter.startsWith('tag-')) {
        const tagId = filter.substring(4); // חלץ את ה-ID
        filteredList = filteredList.filter(t => t.tags && t.tags.includes(tagId));
    }
    // ---------------------------------
    else if (filter !== 'all') {
        if (filter === 'active') filteredList = filteredList.filter(t => t.checked);
        else if (filter === 'inactive') filteredList = filteredList.filter(t => !t.checked);
        else if (filter === 'regular') filteredList = filteredList.filter(t => t.recurrence?.isRecurring);
        else filteredList = filteredList.filter(t => t.type === filter);
    }

    // לוגיקת מיון (נשארת זהה)
    const sortSetting = sortSettings[type];
    if (sortSetting.mode === 'alpha') filteredList.sort((a, b) => a.description.localeCompare(b.description, 'he'));
    else if (sortSetting.mode === 'amount') filteredList.sort((a, b) => sortSetting.direction === 'asc' ? a.amount - b.amount : b.amount - a.amount);
    else if (sortSetting.mode === 'date') filteredList.sort((a, b) => (a.recurrence?.dayOfMonth || 99) - (b.recurrence?.dayOfMonth || 99));

    return filteredList;
}

// =======================================================
// =========== פונקציה 3: יצירת HTML (עזר) ===========
// =======================================================
function renderTransactionList(type, filteredData, allDataForIndices) {
    if (filteredData.length === 0) {
        return `<div class="empty-state">אין ${type === 'income' ? 'הכנסות' : 'הוצאות'} להצגה</div>`;
    }

    const isManualActive = sortSettings[type].mode === 'manual' && manualSortActive[type];

    return filteredData.map(t => {
        const originalIndex = allDataForIndices.findIndex(item => item.id === t.id);
        const isRecurring = t.recurrence?.isRecurring;

        // --- בניית אייקונים (עם התאמה לסוג) ---
        let iconsHTML = '';
        if (type === 'expense') {
            if (t.type === 'loan') {
                iconsHTML += `<svg class="system-icon icon-loan ${t.completed ? 'completed' : ''}" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>`;
            } else if (t.type === 'variable') {
                iconsHTML += `<svg class="system-icon icon-variable" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
            } else if (isRecurring) {
                iconsHTML += `<svg class="system-icon icon-recurring" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`;
            }
        } else { // type === 'income'
            if (isRecurring) {
                iconsHTML += `<svg class="system-icon icon-recurring" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`;
            }
        }

        // --- פרטי הלוואה ותאריך (עם התאמה לסוג) ---
        
        // 💡 הוספנו את `billingDateNote`
        const billingDateNote = (t.type === 'loan' && t.loanBillingDay) ? `<div class="transaction-date-note">יורד ב-${t.loanBillingDay} לחודש</div>` : '';        
        const loanDetails = (type === 'expense' && t.type === 'loan' && t.originalLoanAmount) ? `<div class="loan-original-amount">סכום הלוואה: ₪${t.originalLoanAmount.toLocaleString('he-IL')}</div>` : '';
        
        const dateNote = isRecurring && t.recurrence.dayOfMonth ? `<div class="transaction-date-note">${type === 'income' ? 'מתקבל' : 'יורד'} ב-${t.recurrence.dayOfMonth} לחודש</div>` : '';

        // --- בניית תגים (זהה לשניהם) ---
        let tagsHTML = '';
        const maxVisibleTags = 3;
        if (t.tags && t.tags.length > 0) {
            const visibleTags = t.tags.slice(0, maxVisibleTags);
            const hiddenTagsCount = t.tags.length - maxVisibleTags;
            tagsHTML = visibleTags.map(tagId => {
                const tag = getTagById(tagId);
                if (!tag) return '';
                return `<span class="transaction-tag" style="background-color: ${tag.color};">${sanitizeHTML(tag.name)}</span>`;
            }).join('');
            if (hiddenTagsCount > 0) {
                const allTagIdsJson = JSON.stringify(t.tags);
                tagsHTML += `<button class="tag-overflow-btn" data-action="show-overflow-tags" data-tags='${allTagIdsJson}'>...+${hiddenTagsCount}</button>`;
            }
        }

        // --- סרגל התקדמות הלוואה (רק להוצאות) ---
        let progressBar = '';
        if (type === 'expense' && t.type === 'loan' && t.loanTotal) {
            const percentage = (t.loanCurrent / t.loanTotal) * 100;
            const amountPaid = t.amount * t.loanCurrent;
            const isComplete = t.loanCurrent >= t.loanTotal;
            progressBar = `
                <div class="loan-progress ${t.isExpanded ? 'visible' : ''}">
                    <div class="loan-progress-container"><div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${percentage}%"></div></div>
                        <div class="progress-text">${t.loanCurrent}/${t.loanTotal} (${percentage.toFixed(0)}%) · ₪${amountPaid.toLocaleString('he-IL')} שולמו</div>
                        <div class="loan-progress-actions"><button type="button" class="loan-edit-btn" data-action="edit">ערוך הלוואה</button></div>
                    </div>
                </div>`;
        }
        
        // --- תבנית HTML סופית (עם התאמה לסוג) ---
        const itemHTML = `
            <div class="transaction-item ${type === 'expense' && t.type === 'loan' ? 'loan-item' : ''} ${!t.checked ? 'inactive' : ''} ${t.completed && t.type !== 'loan' ? 'completed' : ''}" 
                 data-id="${t.id}" data-type="${type}" data-action="${type === 'expense' && t.type === 'loan' ? 'toggle-loan' : 'edit'}">
                
                <div class="transaction-info">
                    <div class="transaction-check ${t.checked ? 'checked' : ''}" data-action="toggle-check"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                    <div class="transaction-details">
                        <div class="transaction-text">
                            <span class="transaction-name">${sanitizeHTML(t.description)}</span>
                            ${t.type === 'loan' && t.loanTotal && t.loanCurrent >= t.loanTotal ? '<span class="last-payment-badge">חיוב אחרון</span>' : ''}
                            <div class="transaction-icons">${iconsHTML}</div>
                        </div>
                        <div class="transaction-tags-container">${tagsHTML}</div>
                        ${dateNote}
                        
                        ${billingDateNote}
                        
                        ${loanDetails}
                    </div>
                </div>
                
                <div class="transaction-amount" data-action="edit-amount" title="לחץ לשינוי מהיר של הסכום">
                    <span class="amount-text" dir="ltr">${formatMoney(t.amount)}</span>
                    <input type="number" inputmode="decimal" class="inline-edit-input" step="0.01" onkeydown="handleEditKeys(event)" onblur="saveAmount(event, '${type}')">
                </div>
                
                ${isManualActive ? `<div class="item-controls">
                    <div class="sort-buttons visible">
                        <button class="sort-btn" data-action="move-up" ${originalIndex === 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
                        <button class="sort-btn" data-action="move-down" ${originalIndex === allDataForIndices.length - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                    </div>
                </div>` : ''}
            </div>
        `;
        
        return `<div class="transaction-wrapper">${itemHTML}${progressBar}</div>`;

    }).join('');
}


// ================================================
// =========== פונקציות לניהול תנועות קבועות ===========
// ================================================
let allRecurringTransactions = new Map();

function toggleRecurringDropdown(type) {
    const dropdownId = type === 'income' ? 'recurringDropdownIncome' : 'recurringDropdownExpense';
    const dropdown = document.getElementById(dropdownId);
    document.getElementById(type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense').classList.remove('active');
    if (dropdown.classList.contains('active')) {
        dropdown.classList.remove('active');
        return;
    }
    populateRecurringDropdown(type);
    dropdown.classList.add('active');
}

function populateRecurringDropdown(type) {
    const dropdownId = type === 'income' ? 'recurringDropdownIncome' : 'recurringDropdownExpense';
    const dropdown = document.getElementById(dropdownId);
    allRecurringTransactions.clear(); // המאגר הזה יכיל עכשיו גם קבועות וגם תבניות
    const allMonthKeys = getExistingMonths();
    
    allMonthKeys.forEach(monthKey => {
        const monthData = allData[monthKey];
        const list = type === 'income' ? (monthData.income || []) : (monthData.expenses || []);
        list.forEach(t => {
            // 💡 שינוי לוגי: חפש תנועות קבועות או תנועות מסוג "משתנה"
            if ((t.recurrence && t.recurrence.isRecurring) || (type === 'expense' && t.type === 'variable')) {
                // 💡 שינוי לוגי: המפתח יהיה התיאור, כדי ללכוד תבניות
                allRecurringTransactions.set(t.description, t); 
            }
        });
    });
    
    const recurringList = Array.from(allRecurringTransactions.values());
    
    // 💡 שינוי לוגי: נבדוק כפילויות רק לפי שם התיאור
    const currentMonthList = type === 'income' ? (allData[currentMonth].income || []) : (allData[currentMonth].expenses || []);
    const currentDescriptions = new Set(currentMonthList.map(t => t.description));

    dropdown.innerHTML = '';
    if (recurringList.length === 0) {
        dropdown.innerHTML = '<div class="recurring-dropdown-header">לא נמצאו תנועות או תבניות</div>';
        return;
    }
    dropdown.innerHTML = '<div class="recurring-dropdown-header">בחר תנועה להוספה</div>';
    
    const unaddedTransactions = [];
    recurringList.forEach(t => {
        // 💡 שינוי לוגי: נשתמש בתיאור לבדיקה
        const isAlreadyAdded = currentDescriptions.has(t.description);
        
        if (!isAlreadyAdded) {
            unaddedTransactions.push(t);
        }
        
        const item = document.createElement('div');
        item.classList.add('filter-option', 'recurring-item');
        if (isAlreadyAdded) {
            item.classList.add('disabled');
        }
        
        const icon = isAlreadyAdded ?
            `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` :
            `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        
        // 💡 שינוי לוגי: הצג סכום או "סכום משתנה"
        let amountDisplay = '';
        if (t.recurrence && t.recurrence.isRecurring) {
            amountDisplay = `₪${t.amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
        } else if (t.type === 'variable') {
            amountDisplay = `(סכום משתנה)`;
        }

        item.innerHTML = `
            <div>${icon} ${sanitizeHTML(t.description)}</div>
            <div class="amount">${amountDisplay}</div>
        `;
        
        if (!isAlreadyAdded) {
            // 💡 שינוי לוגי: נעביר את התיאור לפונקציה
            item.onclick = () => addRecurringTransaction(type, t.description);
        }
        dropdown.appendChild(item);
    });
    
    if (unaddedTransactions.length > 0) {
        const footer = document.createElement('div');
        footer.classList.add('recurring-dropdown-footer');
        const addAllButton = document.createElement('div');
        addAllButton.classList.add('filter-option');
        
        // 💡 שינוי לוגי: ספור רק את אלו שהם *באמת* קבועים
        const trulyRecurringToAdd = unaddedTransactions.filter(t => t.recurrence && t.recurrence.isRecurring).length;
        
        addAllButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            הוסף הכל (${trulyRecurringToAdd})
        `;
        
        if (trulyRecurringToAdd === 0) {
            addAllButton.classList.add('disabled');
        } else {
            addAllButton.onclick = () => addAllRecurringTransactions(type);
        }
        
        footer.appendChild(addAllButton);
        dropdown.appendChild(footer);
    }
}

function addAllRecurringTransactions(type) {
    saveStateForUndo();
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    
    // 💡 שינוי לוגי: נבדוק כפילויות רק לפי שם התיאור
    const currentDescriptions = new Set(list.map(t => t.description));
    
    let addedCount = 0;
    allRecurringTransactions.forEach(t => {
        // 💡 שינוי לוגי: הוסף רק אם זה לא קיים, ורק אם זה *באמת* תנועה קבועה (ולא תבנית כ. אשראי)
        if (!currentDescriptions.has(t.description) && (t.recurrence && t.recurrence.isRecurring)) {
            const newTransaction = { ...t, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${addedCount}`, checked: true };
            list.push(newTransaction);
            addedCount++;
        }
    });

    if (addedCount > 0) {
        saveData();
        render();
    }
    const dropdownId = type === 'income' ? 'recurringDropdownIncome' : 'recurringDropdownExpense';
    document.getElementById(dropdownId).classList.remove('active');
    closeSheets();
}

function addRecurringTransaction(type, description) { // 💡 הפונקציה מקבלת 'description'
    // 💡 שינוי לוגי: מצא את התנועה לפי התיאור
    const transactionToAdd = allRecurringTransactions.get(description);
    if (!transactionToAdd) return;
    
    // --- 💡 כאן כל הקסם 💡 ---
    // בדוק אם זו תנועה קבועה רגילה או תבנית כרטיס אשראי
    
    if (transactionToAdd.recurrence && transactionToAdd.recurrence.isRecurring) {
        // --- התנהגות רגילה: זו תנועה קבועה, פשוט הוסף אותה ---
        saveStateForUndo();
        const newTransaction = { ...transactionToAdd, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, checked: true };
        const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
        list.push(newTransaction);
        saveData();
        render();
        
    } else if (type === 'expense' && transactionToAdd.type === 'variable') {
        // --- התנהגות חדשה: זו תבנית כרטיס אשראי, פתח את החלון ---
        
        // 1. פתח את חלון הוספת ההוצאה
        openModal(type);
        
        // 2. מלא אוטומטית את הנתונים מהתבנית
        document.getElementById('descriptionInput').value = transactionToAdd.description;
        selectTransactionType(transactionToAdd.type); // יבחר אוטומטית "כרטיס אשראי"

        // 3. טפל בתגים (אם יש בתבנית)
        if (transactionToAdd.tags && Array.isArray(transactionToAdd.tags)) {
            currentTransactionTags = transactionToAdd.tags.map(tagId => getTagById(tagId)).filter(Boolean);
            renderSelectedTags();
        }

        // 4. נקה את הסכום והתמקד בו (זה כל הרעיון!)
        document.getElementById('amountInput').value = '';
        document.getElementById('amountInput').focus();
    }
    
    // סגור את התפריט הנפתח בכל מקרה
    const dropdownId = type === 'income' ? 'recurringDropdownIncome' : 'recurringDropdownExpense';
    document.getElementById(dropdownId).classList.remove('active');
    closeSheets();
}

// ================================================
// 🚀 שיפור ביצועים: ניהול אירועים מרכזי (גרסה מתוקנת)
// ================================================
function handleListClick(event) {
    const target = event.target;
    
    // 1. מצא את העטיפה (wrapper) של כל התנועה
    const wrapper = target.closest('.transaction-wrapper');
    if (!wrapper) return; // לא נלחץ על תנועה

    // 2. מצא את פריט התנועה הראשי (כדי לקבל ID וסוג)
    const transactionItem = wrapper.querySelector('.transaction-item');
    if (!transactionItem) return; // נדרש לצורך קבלת מידע

    const id = transactionItem.dataset.id;
    const type = transactionItem.dataset.type;

    // 3. מצא את האלמנט הספציפי עם "פעולה" שלחצו עליו
    const actionElement = target.closest('[data-action]');

    if (actionElement) {
        // --- אם לחצו על כפתור ספציפי או אזור פעולה ---
        event.stopPropagation(); // מנע "זליגה" של הקליק
        const action = actionElement.dataset.action;

        switch (action) {
            case 'toggle-check':
                toggleCheck(event, type, id);
                saveData();
                render();
                break;
            case 'edit':
                openModal(type, id);
                break;
            case 'delete':
                deleteTransaction(event, type, id);
                break;
            case 'apply':
                openApplyOptionsModal(type, id);
                break;
            case 'edit-amount':
                // אל תפעיל אם כבר לחצנו על שדה הקלט הפתוח
                if (target.tagName.toLowerCase() === 'input') return;
                editAmount(event, type, id);
                break;
            case 'move-up':
                moveItem(event, type, id, 'up');
                break;
            case 'move-down':
                moveItem(event, type, id, 'down');
                break;
            case 'show-overflow-tags':
                try {
                    const tags = JSON.parse(actionElement.dataset.tags);
                    showOverflowTags(event, tags);
                } catch (e) {
                    console.error("Failed to parse tags JSON", e);
                }
                break;
            case 'toggle-loan': // <-- זה מטפל בלחיצה על גוף ההלוואה
                toggleLoanProgress(type, id);
                break;
        }
    }
    // אם לא נלחץ אלמנט עם data-action (למשל, לחיצה על רווח לבן), לא יקרה כלום.
}


// ================================================
// =========== Event Listeners Setup ===========
// ================================================
document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadHeaderPinState();
    loadCardStates();
    setupBalanceEditing();
    setupTagsInputEventListeners(); // New
    
    // ================================================
    // 🚀 שיפור ביצועים: מאזיני אירועים לרשימות
    // ================================================
    document.getElementById('incomeList').addEventListener('click', handleListClick);
    document.getElementById('expenseList').addEventListener('click', handleListClick);

    document.getElementById('prevMonthBtn').addEventListener('click', () => navigateMonths(-1));
    document.getElementById('nextMonthBtn').addEventListener('click', () => navigateMonths(1));
    document.getElementById('deleteMonthBtn').addEventListener('click', () => { closeSheets(); openEditMonthModal(); });
    document.querySelectorAll('.sheet-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheets(); });
    });
    setActiveList(localStorage.getItem('activeList') === 'income' ? 'income' : 'expense');
    document.getElementById('monthJumperBtn').addEventListener('click', toggleMonthJumper);
    document.getElementById('recurrenceCheckbox').addEventListener('change', (e) => {
        document.querySelector('.day-of-month-group').style.display = e.target.checked ? 'flex' : 'none';
    });
    const newMonthModal = document.getElementById('newMonthModal');
    document.getElementById('copyMonthBtn').addEventListener('click', () => {
        handleCreateNewMonth(newMonthModal.dataset.newMonthKey, newMonthModal.dataset.prevMonthKey, true);
    });
    document.getElementById('cleanMonthBtn').addEventListener('click', () => {
        handleCreateNewMonth(newMonthModal.dataset.newMonthKey, newMonthModal.dataset.prevMonthKey, false);
    });
    document.getElementById('cancelNewMonthBtn').addEventListener('click', closeNewMonthModal);
    document.getElementById('resetMonthBtn').addEventListener('click', resetCurrentMonth);
    document.getElementById('deleteMonthPermanentlyBtn').addEventListener('click', deleteCurrentMonth);
    document.getElementById('cancelEditMonthBtn').addEventListener('click', closeEditMonthModal);
    document.querySelectorAll('#filterDropdownIncome .filter-option, #filterDropdownExpense .filter-option').forEach(option => {
        option.addEventListener('click', (e) => {
            const dropdown = option.closest('.filter-dropdown');
            const type = dropdown.id.includes('Income') ? 'income' : 'expense';
            const filter = option.dataset.filter;
            setFilter(type, filter);
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('choiceScreen').classList.contains('active')) return;
            requestCloseModal();
            closeChartModal();
            closeConfirmModal();
            closeApplyOptionsModal();
            closeNewMonthModal();
            closeEditMonthModal();
            closeTagsManagementModal();
            closeOverflowTagsModal();
            closeShortfallModal();
            closeSheets();
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-container') && !e.target.closest('.sheet')) {
            document.getElementById('filterDropdownIncome').classList.remove('active');
            document.getElementById('filterDropdownExpense').classList.remove('active');
            document.getElementById('sortDropdownIncome').classList.remove('active');
            document.getElementById('sortDropdownExpense').classList.remove('active');
            document.getElementById('monthJumperList').classList.remove('active');
            document.getElementById('recurringDropdownIncome').classList.remove('active');
            document.getElementById('recurringDropdownExpense').classList.remove('active');
        }
        if (e.target.classList.contains('modal') && e.target.id !== 'transactionModal') {
            e.target.classList.remove('active');
        }
    });
    initStorage();
    document.body.classList.remove('preload');
});

// ================================================
// =========== תפריטים נפתחים מלמטה (sheets) ===========
// ================================================
function openSheet(id) {
    closeSheets();
    const overlay = document.getElementById(id);
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    const firstButton = overlay.querySelector('.sheet-row:not([disabled]), .sheet-close');
    if (firstButton) firstButton.focus();
}

function closeSheets() {
    document.querySelectorAll('.sheet-overlay.active').forEach(overlay => {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('.sheet-panel').forEach(panel => panel.classList.remove('active'));
}

// ---------- לשוניות הוצאות / הכנסות ----------
function setActiveList(type) {
    const isIncome = type === 'income';
    document.getElementById('incomeCard').classList.toggle('hidden', !isIncome);
    document.getElementById('expenseCard').classList.toggle('hidden', isIncome);
    document.getElementById('tabIncome').setAttribute('aria-selected', String(isIncome));
    document.getElementById('tabExpense').setAttribute('aria-selected', String(!isIncome));
    localStorage.setItem('activeList', isIncome ? 'income' : 'expense');
}

// ---------- תפריט ⋯ של הרשימה ----------
let listMenuType = 'expense';

function openListMenu(type) {
    listMenuType = type;
    const list = (allData[currentMonth] || {})[type === 'income' ? 'income' : 'expenses'] || [];
    const isEmpty = list.length === 0;
    document.getElementById('listMenuTitle').textContent = type === 'income' ? 'הכנסות' : 'הוצאות';
    ['listMenuFilter', 'listMenuSort', 'listMenuChart'].forEach(id => { document.getElementById(id).disabled = isEmpty; });
    const filter = type === 'income' ? filterIncome : filterExpense;
    document.getElementById('listMenuFilterValue').textContent = filter === 'all' ? 'הכל' : getFilterLabel(filter);
    const sortLabels = { manual: 'סידור אישי', alpha: 'א׳-ב׳', amount: 'לפי סכום', date: 'לפי תאריך' };
    document.getElementById('listMenuSortValue').textContent = sortLabels[sortSettings[type].mode] || '';
    showListMenuMain();
    openSheet('listMenuSheet');
}

function showListMenuMain() {
    document.querySelectorAll('.sheet-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById('listMenuMain').classList.remove('hidden');
    document.getElementById('listMenuBackBtn').classList.add('hidden');
    document.getElementById('listMenuTitle').textContent = listMenuType === 'income' ? 'הכנסות' : 'הוצאות';
}

function openListMenuPanel(panel) {
    document.querySelectorAll('.sheet-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('listMenuMain').classList.add('hidden');
    document.getElementById('listMenuBackBtn').classList.remove('hidden');
    const titles = { filter: 'סינון', sort: 'מיון', recurring: 'תנועות קבועות' };
    document.getElementById('listMenuTitle').textContent = titles[panel];
    if (panel === 'filter') toggleFilter(listMenuType);
    else if (panel === 'sort') toggleSortDropdown(listMenuType);
    else toggleRecurringDropdown(listMenuType);
}

function openConfirmModal(title, text, onConfirm, onCancel = closeConfirmModal) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalText').innerHTML = text;
    const confirmBtn = document.getElementById('confirmModalConfirmBtn');
    const cancelBtn = document.querySelector('#confirmModal .modal-btn-cancel');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.addEventListener('click', onConfirm);
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    newCancelBtn.addEventListener('click', onCancel);
    const isInfo = title === 'שגיאה' || title === 'מידע' || title === 'הצלחה' || title === 'סטטיסטיקת מערכת';
    newConfirmBtn.style.display = isInfo ? 'none' : 'flex';
    newCancelBtn.textContent = isInfo ? 'סגור' : 'ביטול';
    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

/**
 * פונקציית עזר לחלון אישור אסינכרוני
 * מחזירה Promise שממתין לתשובת המשתמש (true/false)
 */
function showAsyncConfirm(title, text) {
    return new Promise((resolve) => {
        openConfirmModal(
            title,
            text,
            () => { closeConfirmModal(); resolve(true); }, // אם המשתמש לחץ "אשר"
            () => { closeConfirmModal(); resolve(false); } // אם המשתמש לחץ "ביטול"
        );
    });
}

// בחודש עתידי שדה העו"ש מחושב ולא ניתן לעריכה
function updateBalanceMode() {
    const isForecast = isForecastMonth(currentMonth);
    const input = document.getElementById('currentBalanceInput');
    if (isForecast) {
        input.value = allData[currentMonth].balance || 0;
        finishBalanceEdit();
    }
    const months = getExistingMonths();
    const prevMonth = months[months.indexOf(currentMonth) - 1];
    const isCurrent = currentMonth === getCurrentMonthKey();
    document.getElementById('balanceLabelText').textContent = isForecast ? 'עו״ש פתיחה' : (isCurrent ? 'עו״ש עכשיו' : 'עו״ש בבנק');
    const chip = document.getElementById('balanceAutoChip');
    chip.textContent = prevMonth ? `מחושב מ${getMonthName(prevMonth)}` : 'מחושב';
    chip.classList.toggle('hidden', !isForecast);
    const displayBtn = document.getElementById('balanceDisplayBtn');
    displayBtn.disabled = isForecast;
    displayBtn.classList.toggle('readonly', isForecast);
    displayBtn.setAttribute('aria-label', isForecast ? 'העו״ש מחושב אוטומטית מהחודש הקודם' : 'עדכון העו״ש');
    document.body.classList.toggle('forecast-month', isForecast);
}

// עריכת העו"ש: לחיצה על המספר פותחת שדה, ✓ / Enter / יציאה מהשדה שומרים, Escape מבטל
let balanceBeforeEdit = null;

function startBalanceEdit() {
    if (isForecastMonth(currentMonth)) return;
    const input = document.getElementById('currentBalanceInput');
    balanceBeforeEdit = input.value;
    document.getElementById('balanceDisplayBtn').classList.add('hidden');
    document.getElementById('balanceEditRow').classList.remove('hidden');
    document.getElementById('balanceEditHint').classList.remove('hidden');
    input.focus();
    input.select();
}

function finishBalanceEdit() {
    if (balanceBeforeEdit === null) return;
    balanceBeforeEdit = null;
    document.getElementById('balanceDisplayBtn').classList.remove('hidden');
    document.getElementById('balanceEditRow').classList.add('hidden');
    document.getElementById('balanceEditHint').classList.add('hidden');
    render();
}

function cancelBalanceEdit() {
    if (balanceBeforeEdit === null) return;
    document.getElementById('currentBalanceInput').value = balanceBeforeEdit;
    updateSummary();
    finishBalanceEdit();
}

function setupBalanceEditing() {
    const input = document.getElementById('currentBalanceInput');
    document.getElementById('balanceDisplayBtn').addEventListener('click', startBalanceEdit);
    // mousedown במקום click כדי שה-blur של השדה לא יקדים את הלחיצה
    document.getElementById('balanceSaveBtn').addEventListener('mousedown', (e) => e.preventDefault());
    document.getElementById('balanceSaveBtn').addEventListener('click', finishBalanceEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishBalanceEdit();
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            cancelBalanceEdit();
        }
    });
    input.addEventListener('blur', finishBalanceEdit);
    // במקלדת המספרים של אייפון אין מינוס - הכפתור הופך את הסימן
    const signBtn = document.getElementById('balanceSignBtn');
    signBtn.addEventListener('mousedown', (e) => e.preventDefault());
    signBtn.addEventListener('click', () => {
        const value = parseFloat(input.value) || 0;
        input.value = value === 0 ? '' : String(safeCalc(-value));
        updateSummary();
        input.focus();
    });
}

function toggleCard(button, cardName) {
    const card = button.closest('.card');
    card.classList.toggle('is-collapsed');
    button.classList.toggle('collapsed');
    localStorage.setItem(cardName + 'CardState', card.classList.contains('is-collapsed') ? 'collapsed' : 'expanded');
}

function loadCardStates() {
    ['loansSummary'].forEach(cardName => {
        if (localStorage.getItem(cardName + 'CardState') === 'collapsed') {
            const card = document.querySelector('.' + cardName.replace('Summary', '-summary') + '-card');
            if (card) {
                card.classList.add('is-collapsed');
                card.querySelector('.collapse-btn').classList.add('collapsed');
            }
        }
    });
}

function toggleHeaderPin() {
    const body = document.body;
    body.classList.toggle('header-pinned');
    const isPinned = body.classList.contains('header-pinned');
    document.getElementById('pinValue').textContent = isPinned ? 'פעיל' : 'כבוי';
    localStorage.setItem('headerPinned', isPinned ? 'true' : 'false');
}

function loadHeaderPinState() {
    if (localStorage.getItem('headerPinned') === 'true') {
        document.body.classList.add('header-pinned');
        document.getElementById('pinValue').textContent = 'פעיל';
    }
}


// =======================================================
// =========== לוגיקה חדשה - ניהול קלט תגים ===========
// =======================================================

function setupTagsInputEventListeners() {
    const tagsInput = document.getElementById('tagsInput');
    const suggestionsContainer = document.getElementById('tagsSuggestions');

    // פונקציית עזר להצגת ההצעות
    function showSuggestionsList(query = '') {
        const allTags = getAllTags();
        let filteredTags = allTags;

        // אם יש טקסט, נסנן. אם אין טקסט - נציג הכל.
        if (query) {
            filteredTags = allTags.filter(tag => tag.name.toLowerCase().includes(query.toLowerCase()));
        }

        suggestionsContainer.innerHTML = '';
        
        if (filteredTags.length > 0) {
            filteredTags.forEach(tag => {
                // בדיקה שהתג לא נבחר כבר, כדי לא להציג כפילויות
                const isAlreadySelected = currentTransactionTags.some(t => t.id === tag.id);
                if (isAlreadySelected) return;

                const suggestionEl = document.createElement('div');
                // הוספנו את הצבע של התג גם בדרופ דאון שיהיה יפה
                suggestionEl.innerHTML = `
                    <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background-color:${tag.color}; margin-left:8px;"></span>
                    ${sanitizeHTML(tag.name)}
                `;
                
                suggestionEl.onclick = (e) => {
                    e.stopPropagation(); // מונע סגירה מיידית
                    addTagToTransaction(tag);
                    tagsInput.value = '';
                    suggestionsContainer.innerHTML = '';
                    suggestionsContainer.classList.remove('active');
                    tagsInput.focus(); // מחזיר את הפוקוס לשדה לכתיבה נוספת
                };
                suggestionsContainer.appendChild(suggestionEl);
            });
            
            // מציג רק אם יש תוצאות רלוונטיות (שלא נבחרו כבר)
            if (suggestionsContainer.children.length > 0) {
                suggestionsContainer.classList.add('active');
            } else {
                suggestionsContainer.classList.remove('active');
            }
        } else {
            suggestionsContainer.classList.remove('active');
        }
    }

    // אירוע לחיצה על ENTER (יצירת תג חדש)
    tagsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const tagName = tagsInput.value.trim();
            if (tagName) {
                let tag = Object.values(allData.tags).find(t => t.name.toLowerCase() === tagName.toLowerCase());
                if (!tag) {
                    tag = createTag(tagName);
                }
                addTagToTransaction(tag);
                tagsInput.value = '';
                suggestionsContainer.innerHTML = '';
                suggestionsContainer.classList.remove('active');
            }
        }
    });

    // אירוע הקלדה (סינון בזמן אמת)
    tagsInput.addEventListener('input', () => {
        showSuggestionsList(tagsInput.value);
    });

    // אירוע פוקוס (לחיצה על השדה) - מציג את כל התגים
    tagsInput.addEventListener('focus', () => {
        showSuggestionsList(tagsInput.value); // שולח ערך ריק או קיים
    });

    // סגירת החלונית בלחיצה בחוץ
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.tags-input-wrapper')) {
            suggestionsContainer.classList.remove('active');
        }
    });
}

function renderSelectedTags() {
    const tagsContainer = document.getElementById('tagsContainer');
    tagsContainer.innerHTML = '';
    currentTransactionTags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'selected-tag';
        tagEl.style.backgroundColor = tag.color;
        tagEl.innerHTML = `
            ${sanitizeHTML(tag.name)}
            <button type="button" class="remove-tag-btn" onclick="removeTagFromTransaction('${tag.id}')">&times;</button>
        `;
        tagsContainer.appendChild(tagEl);
    });
}

function addTagToTransaction(tag) {
    if (!tag || currentTransactionTags.some(t => t.id === tag.id)) {
        return; // Do not add if null or already exists
    }
    currentTransactionTags.push(tag);
    renderSelectedTags();
}

function removeTagFromTransaction(tagId) {
    currentTransactionTags = currentTransactionTags.filter(t => t.id !== tagId);
    renderSelectedTags();
}

// =======================================================
// =========== לוגיקה חדשה - חלון ניהול תגים ===========
// =======================================================

function openTagsManagementModal() {
    const listContainer = document.getElementById('tagsManagementList');
    listContainer.innerHTML = '';
    const allTags = getAllTags();

    if(allTags.length === 0) {
        listContainer.innerHTML = `<div class="empty-state">אין תגים להצגה. התחל להוסיף תגים לתנועות שלך!</div>`;
    } else {
        allTags.forEach(tag => {
            const tagItem = document.createElement('div');
            tagItem.className = 'tag-management-item';
            
            // --- השינוי מתחיל כאן ---
            // במקום span רגיל, שמנו input מסוג color
            // הוספנו לו אירוע onchange שקורא לפונקציה החדשה
            tagItem.innerHTML = `
                <div class="tag-color-wrapper" title="לחץ לשינוי צבע">
                    <input type="color" 
                           class="tag-color-picker" 
                           value="${tag.color}" 
                           onchange="updateTagColor('${tag.id}', this.value)">
                </div>
                <span class="tag-name">${sanitizeHTML(tag.name)}</span>
                <div class="tag-actions">
                    <button class="action-btn edit" onclick="editTag('${tag.id}')" title="שנה שם"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
                    <button class="action-btn delete" onclick="deleteTag('${tag.id}')" title="מחק תג"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            `;
            // --- השינוי מסתיים כאן ---
            
            listContainer.appendChild(tagItem);
        });
    }

    document.getElementById('tagsManagementModal').classList.add('active');
}

function closeTagsManagementModal() {
    document.getElementById('tagsManagementModal').classList.remove('active');
}

function editTag(tagId) {
    const tag = getTagById(tagId);
    if (!tag) return;

    const newName = prompt(`שנה את שם התג "${tag.name}":`, tag.name);
    if (newName && newName.trim() !== tag.name) {
        saveStateForUndo();
        allData.tags[tagId].name = newName.trim();
        saveData();
        render(); // Re-render main view
        openTagsManagementModal(); // Re-render the modal
    }
}

function deleteTag(tagId) {
    const tag = getTagById(tagId);
    if (!tag) return;
    
    const message = `האם למחוק את התג <b>"${sanitizeHTML(tag.name)}"</b> לצמיתות? <br>התג יוסר מכל התנועות בכל החודשים.`;
    openConfirmModal('אישור מחיקת תג', message, () => {
        saveStateForUndo();
        // 1. Delete the tag from the global list
        delete allData.tags[tagId];

        // 2. Remove the tagId from all transactions across all months
        getExistingMonths().forEach(monthKey => {
            const monthData = allData[monthKey];
            ['income', 'expenses'].forEach(type => {
                if (monthData[type]) {
                    monthData[type].forEach(transaction => {
                        if (transaction.tags && transaction.tags.includes(tagId)) {
                            transaction.tags = transaction.tags.filter(id => id !== tagId);
                        }
                    });
                }
            });
        });

        saveData();
        render(); // Re-render main view
        closeConfirmModal();
        openTagsManagementModal(); // Re-render the modal
    });
}

function updateTagColor(tagId, newColor) {
    const tag = getTagById(tagId);
    if (!tag || tag.color === newColor) return;

    saveStateForUndo(); // שמירת מצב לביטול
    allData.tags[tagId].color = newColor; // עדכון הצבע
    saveData(); // שמירה
    render(); // רענון המסך הראשי כדי לראות את השינוי ברקע
    
    // אין צורך לרענן את המודל כולו כי האינפוט כבר מציג את הצבע החדש
}

// =======================================================
// =========== לוגיקה חדשה - חלון תגים עודפים ===========
// =======================================================

function showOverflowTags(event, tagIds) {
    event.stopPropagation(); // Stop click from bubbling to the transaction item

    const modal = document.getElementById('tagsOverflowModal');
    const listContainer = document.getElementById('tagsOverflowModalList');
    listContainer.innerHTML = ''; // Clear previous tags

    if (!tagIds || tagIds.length === 0) {
        listContainer.innerHTML = `<div class="empty-state">אין תגים להצגה.</div>`;
    } else {
        tagIds.forEach(tagId => {
            const tag = getTagById(tagId);
            if (tag) {
                const tagItem = document.createElement('div');
                tagItem.className = 'tag-overflow-item';
                tagItem.innerHTML = `
                    <span class="tag-preview" style="background-color: ${tag.color};"></span>
                    <span class="tag-name">${sanitizeHTML(tag.name)}</span>
                `;
                listContainer.appendChild(tagItem);
            }
        });
    }

    modal.classList.add('active');
}

function closeOverflowTagsModal() {
    document.getElementById('tagsOverflowModal').classList.remove('active');
}

// =======================================================
// =========== פונקציית עזר: קבלת תגים לחודש נוכחי ===========
// =======================================================
function getTagsForCurrentMonth(type) {
    const currentData = allData[currentMonth];
    const dataKey = (type === 'income') ? 'income' : 'expenses';
    const transactions = currentData[dataKey] || [];
    const tagIds = new Set();
    transactions.forEach(t => {
        if (t.tags) {
            t.tags.forEach(tagId => tagIds.add(tagId));
        }
    });
    // המר מ-ID לאובייקטים שלמים של תג, וסנן החוצה תגים שנמחקו
    return Array.from(tagIds).map(id => getTagById(id)).filter(Boolean); 
}

// =======================================================
// =========== פונקציית עזר: בניית תפריט סינון דינמי ===========
// =======================================================
function populateFilterDropdown(type) {
    const dropdownId = type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense';
    const dropdown = document.getElementById(dropdownId);
    const currentFilter = (type === 'income') ? filterIncome : filterExpense;

    // 1. אובייקט עזר לאייקוני SVG (שהעתקנו מה-HTML המקורי)
    const icons = {
        all: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>',
        active: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        inactive: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>',
        regular: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>',
        variable: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
        loan: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="12" x2="18" y2="12"/></svg>'
    };

    // 2. הגדרת אפשרויות בסיס
    let options = [
        { filter: 'all', icon: icons.all, text: 'הצג הכל' },
        { filter: 'active', icon: icons.active, text: 'תנועות פעילות' },
        { filter: 'inactive', icon: icons.inactive, text: 'תנועות לא פעילות' },
        { filter: 'regular', icon: icons.regular, text: 'קבועות' }
    ];
    
    if (type === 'expense') {
        options.push({ filter: 'variable', icon: icons.variable, text: 'כרטיס אשראי' });
        options.push({ filter: 'loan', icon: icons.loan, text: 'הלוואות' });
    }

    // 3. קבלת תגים ייחודיים לחודש זה
    const tags = getTagsForCurrentMonth(type).sort((a, b) => a.name.localeCompare(b.name, 'he'));
    
    // 4. בניית ה-HTML
    let html = '';
    options.forEach(opt => {
        const isSelected = currentFilter === opt.filter;
        html += `<div class="filter-option ${isSelected ? 'selected' : ''}" data-filter="${opt.filter}">
                    ${opt.icon} ${sanitizeHTML(opt.text)}
                 </div>`;
    });

    if (tags.length > 0) {
        // שימוש חוזר בעיצוב הכותרת מתפריט התנועות הקבועות
        html += `<div class="recurring-dropdown-header">סינון לפי תגים</div>`; 
        tags.forEach(tag => {
            const filterKey = `tag-${tag.id}`; // מפתח ייחודי לסינון תג
            const isSelected = currentFilter === filterKey;
            // שימוש חוזר בעיצוב תצוגה מקדימה של תג
            html += `<div class="filter-option ${isSelected ? 'selected' : ''}" data-filter="${filterKey}">
                        <span class="tag-preview" style="background-color: ${tag.color};"></span>
                        ${sanitizeHTML(tag.name)}
                     </div>`;
        });
    }
    
    dropdown.innerHTML = html;

    // 5. חיבור מאזיני אירועים חדשים לפריטים שיצרנו
    dropdown.querySelectorAll('.filter-option').forEach(option => {
        option.addEventListener('click', () => {
            setFilter(type, option.dataset.filter);
        });
    });
}

function monthDiff(fromKey, toKey) {
    const [fy, fm] = fromKey.split('-').map(Number);
    const [ty, tm] = toKey.split('-').map(Number);
    return (ty - fy) * 12 + (tm - fm);
}

/**
 * הלוואה חדשה שכבר באמצע (למשל תשלום 2 מתוך 3): מוסיף את התשלומים הקודמים
 * לחודשים הקודמים שכבר קיימים, כ"לא פעילים" - החודשים האלה כבר עברו,
 * אז הם מופיעים ברשימה בלי לשנות את התחזית שלהם. חודשים חסרים לא נוצרים.
 */
function backfillLoan(sourceLoan, sourceMonthKey) {
    if (!sourceLoan || sourceLoan.type !== 'loan' || !sourceLoan.globalLoanId) return;
    getExistingMonths().filter(key => key < sourceMonthKey).forEach(monthKey => {
        const paymentNumber = sourceLoan.loanCurrent - monthDiff(monthKey, sourceMonthKey);
        if (paymentNumber < 1) return;
        const monthData = allData[monthKey];
        if (!monthData.expenses) monthData.expenses = [];
        if (monthData.expenses.some(t => t.globalLoanId === sourceLoan.globalLoanId)) return;
        monthData.expenses.push({
            ...sourceLoan,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            loanCurrent: paymentNumber,
            completed: false,
            checked: false,
            isExpanded: false
        });
    });
}

/**
 * "שרשור" הלוואות קדימה
 * מקבל הלוואת מקור ומעדכן/יוצר אותה בכל החודשים העתידיים שכבר קיימים
 */
function cascadeLoanUpdates(sourceLoan, sourceMonthKey) {
    if (!sourceLoan || sourceLoan.type !== 'loan' || !sourceLoan.globalLoanId) {
        return; 
    }

    const globalId = sourceLoan.globalLoanId;
    const allMonthKeys = getExistingMonths();
    const startIndex = allMonthKeys.indexOf(sourceMonthKey);

    if (startIndex === -1) return; 

    // רץ על כל החודשים *אחרי* חודש המקור
    for (let i = startIndex + 1; i < allMonthKeys.length; i++) {
        const futureMonthKey = allMonthKeys[i];
        const futureMonthData = allData[futureMonthKey];
        
        // מספר התשלום לפי מרחק החודשים בפועל (גם אם חסר חודש באמצע)
        const paymentNumber = sourceLoan.loanCurrent + monthDiff(sourceMonthKey, futureMonthKey);
        const isCompleted = paymentNumber >= sourceLoan.loanTotal;
        if (!futureMonthData.expenses) futureMonthData.expenses = [];

        let targetLoan = futureMonthData.expenses.find(t => t.globalLoanId === globalId);

        if (paymentNumber > sourceLoan.loanTotal) {
            // ההלוואה כבר הסתיימה לפני החודש הזה (למשל אחרי קיצור מספר התשלומים)
            if (targetLoan) futureMonthData.expenses = futureMonthData.expenses.filter(t => t.globalLoanId !== globalId);
            continue;
        }

        if (targetLoan) {
            // --- מצאנו הלוואה קיימת, עדכן אותה ---
            
            // עדכן נתונים "גלובליים" מהמקור
            targetLoan.description = sourceLoan.description;
            targetLoan.amount = sourceLoan.amount;
            targetLoan.originalLoanAmount = sourceLoan.originalLoanAmount;
            targetLoan.loanTotal = sourceLoan.loanTotal;
            
            // 💡 עדכן את יום החיוב הגלובלי
            targetLoan.loanBillingDay = sourceLoan.loanBillingDay;
            
            // עדכן נתונים "מקומיים" מחושבים
            targetLoan.loanCurrent = paymentNumber;
            targetLoan.completed = isCompleted;
            targetLoan.checked = true; 

        } else {
            // --- לא מצאנו הלוואה בחודש הזה: ניצור עותק (כולל החיוב האחרון) ---
            
            // 💡 הפונקציה { ...sourceLoan } תעתיק אוטומטית את loanBillingDay
            const newLoan = { ...sourceLoan }; 
            
            newLoan.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            newLoan.globalLoanId = globalId; 
            
            newLoan.loanCurrent = paymentNumber;
            newLoan.completed = isCompleted;
            newLoan.checked = true;
            newLoan.isExpanded = false;

            futureMonthData.expenses.push(newLoan);
        }
    }
}

// ================================================
// =========== מחשבון חריגה ===========
// ================================================
/**
 * פותח את חלון מחשבון החריגה
 */
function openOverdraftModal() {
    // מסגרת האשראי נשמרת בהגדרות (localStorage רק לתאימות לגרסה ישנה)
    const savedLimit = allData.settings.overdraftLimit || localStorage.getItem('overdraftLimit');
    document.getElementById('overdraftLimitInput').value = savedLimit ? Math.abs(parseFloat(savedLimit)) : '';
    document.getElementById('shortfallModal').classList.add('active');
    document.getElementById('overdraftLimitInput').focus();
}

/**
 * סוגר את חלון מחשבון החריגה (ללא שינוי)
 */
function closeShortfallModal() {
    document.getElementById('shortfallModal').classList.remove('active');
}

/**
 * 💡 מבצע את החישוב החדש (מינוס אוטומטי) 💡
 */
function saveOverdraftLimit() {
    const value = parseFloat(document.getElementById('overdraftLimitInput').value);
    const limit = isNaN(value) ? 0 : Math.abs(value);
    if (allData.settings.overdraftLimit !== limit) {
        saveStateForUndo();
        allData.settings.overdraftLimit = limit;
        localStorage.removeItem('overdraftLimit');
        saveData();
        render();
    }
    closeShortfallModal();
}

/**
 * פותח חלון סטטיסטיקה על מצב האחסון
 */
function showStorageStats() {
    // 1. חישוב גודל האחסון
    const dataString = JSON.stringify(allData);
    const dataSizeInBytes = new Blob([dataString]).size;
    const dataSizeInKB = (dataSizeInBytes / 1024).toFixed(2); // המרה לקילובייט

    // 2. חישוב מספר חודשים
    const allMonthKeys = getExistingMonths();
    const monthCount = allMonthKeys.length;

    // 3. חישוב מספר תנועות
    let transactionCount = 0;
    allMonthKeys.forEach(monthKey => {
        const monthData = allData[monthKey];
        transactionCount += (monthData.income || []).length;
        transactionCount += (monthData.expenses || []).length;
    });

    // 4. יצירת תוכן ה-HTML להצגה
    // (אנו משתמשים ב-ul עם עיצוב פנימי כדי שייראה טוב במודל הקיים)
    const statsHtml = `
        <ul style="text-align: right; list-style-type: none; padding-right: 0; line-height: 1.8;">
            <li style="margin-bottom: 10px;">
                <strong><span style="font-size: 1.1em;">${monthCount}</span></strong> חודשים במערכת
            </li>
            <li style="margin-bottom: 10px;">
                <strong><span style="font-size: 1.1em;">${transactionCount}</span></strong> תנועות (הכנסות והוצאות)
            </li>
            <li style="margin-bottom: 10px;">
                <strong><span style="font-size: 1.1em;">${dataSizeInKB} KB</span></strong> גודל הנתונים (לפני הצפנה)
            </li>
            <li style="margin-top: 20px; font-size: 12px; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 10px;">
                הנתונים שמורים במכשיר, מוצפנים בסיסמה שלך. גיבוי אחרון לענן: ${formatDateTime(sync.meta.lastBackupAt)}
            </li>
        </ul>
    `;
    
    // 5. פתיחת המודל הקיים במצב "מידע"
    openConfirmModal('סטטיסטיקת מערכת', statsHtml, closeConfirmModal);
}
