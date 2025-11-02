// ================================================
// =========== הגדרות סנכרון לענן ===========
// ================================================
const BIN_ID = '68fa8d59d0ea881f40b669cb';
const MASTER_KEY = '$2a$10$2l31FVG9Qxn1DXIcxeq6hOQmZgnLls5mCIGRq2Czzfv6fNyEHQFfG';
const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

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
// =========== פונקציות הצפנה ופענוח ===========
// ================================================
function encryptData(data, password) {
    if (!password) return null;
    try {
        return CryptoJS.AES.encrypt(JSON.stringify(data), password).toString();
    } catch (e) {
        console.error("Encryption failed:", e);
        return null;
    }
}

function decryptData(encryptedData, password) {
    if (!password || !encryptedData) return null;
    try {
        const bytes = CryptoJS.AES.decrypt(encryptedData, password);
        const decryptedString = bytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedString) return null;
        return JSON.parse(decryptedString);
    } catch (e) {
        console.error("Decryption failed:", e);
        return null;
    }
}

// ================================================
// =========== פונקציות סנכרון לענן ===========
// ================================================
async function loadFromCloud(password) {
    try {
        const response = await fetch(`${BIN_URL}/latest`, {
            method: 'GET',
            headers: {
                'X-Master-Key': MASTER_KEY
            }
        });
        if (!response.ok) throw new Error('Failed to fetch data');
        const cloudData = await response.json();
        if (Object.keys(cloudData.record).length === 0 || !cloudData.record.data) {
            return 'empty';
        }
        const decryptedData = decryptData(cloudData.record.data, password);
        if (decryptedData) {
            allData = migrateData(decryptedData); // <<< תיקון
            initializeTags(); // Ensure tags object exists after loading
            currentMonth = Object.keys(allData).filter(k => k !== 'tags').sort().pop() || getCurrentMonthKey();
            saveDataToLocal();
            loadData();
            return 'success';
        } else {
            return 'decryption_failed';
        }
    } catch (error) {
        console.error("Error loading from cloud:", error);
        return 'error';
    }
}

async function saveToCloud(password) {
    const dataToSave = {
        data: encryptData(allData, password)
    };
    if (!dataToSave.data) return 'encryption_failed';
    try {
        const response = await fetch(BIN_URL, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Master-Key': MASTER_KEY
            },
            body: JSON.stringify(dataToSave)
        });
        if (!response.ok) throw new Error('Failed to save data');
        return 'success';
    } catch (error) {
        console.error("Error saving to cloud:", error);
        return 'error';
    }
}

async function handleLoadFromCloud() {
    const password = document.getElementById('syncPassword').value;
    if (!password) {
        openConfirmModal('שגיאה', 'יש להזין סיסמת סנכרון.', closeConfirmModal);
        return;
    }
    const loadBtn = document.getElementById('loadFromCloudBtn');
    loadBtn.disabled = true;
    const result = await loadFromCloud(password);
    if (result === 'decryption_failed') {
        openConfirmModal('שגיאה', 'הסיסמה שגויה.', closeConfirmModal);
    } else if (result === 'error') {
        openConfirmModal('שגיאה', 'אירעה שגיאת רשת בעת הטעינה.', closeConfirmModal);
    } else if (result === 'success') {
        openConfirmModal('הצלחה', 'הנתונים נטענו מהענן!', closeConfirmModal);
    } else if (result === 'empty') {
        openConfirmModal('מידע', 'מאגר הנתונים בענן ריק.', closeConfirmModal);
    }
    loadBtn.disabled = false;
}

async function handleSaveToCloud() {
    const password = document.getElementById('syncPassword').value;
    if (!password) {
        openConfirmModal('שגיאה', 'יש להזין סיסמת סנכרון.', closeConfirmModal);
        return;
    }
    const saveBtn = document.getElementById('saveToCloudBtn');
    saveBtn.disabled = true;
    saveBtn.classList.add('loading');
    const result = await saveToCloud(password);
    if (result === 'encryption_failed') {
        openConfirmModal('שגיאה', 'ההצפנה נכשלה. לא ניתן היה לשמור.', closeConfirmModal);
        saveBtn.classList.add('error');
    } else if (result === 'error') {
        openConfirmModal('שגיאה', 'אירעה שגיאת רשת בעת השמירה.', closeConfirmModal);
        saveBtn.classList.add('error');
    } else if (result === 'success') {
        saveBtn.classList.add('success');
        openConfirmModal('הצלחה', 'הנתונים נשמרו בענן!', closeConfirmModal);
    }
    setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.classList.remove('loading', 'success', 'error');
    }, 2000);
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
    return Object.keys(allData).filter(key => key !== 'tags').sort();
}

function updateMonthDisplay() {
    if (!currentMonth) return;
    const monthDisplay = document.getElementById('currentMonthDisplay');
    const [year, month] = currentMonth.split('-');
    const date = new Date(year, month - 1);
    const monthName = date.toLocaleString('he-IL', { month: 'long' });
    monthDisplay.textContent = `${monthName} ${year}`;
    const todayMonthKey = getCurrentMonthKey();
    if (currentMonth === todayMonthKey) {
        monthDisplay.classList.add('disabled-jumper');
        monthDisplay.classList.remove('is-jumper');
        monthDisplay.onclick = null;
        monthDisplay.title = "";
    } else {
        monthDisplay.classList.remove('disabled-jumper');
        monthDisplay.classList.add('is-jumper');
        monthDisplay.onclick = jumpToCurrentMonth;
        monthDisplay.title = "קפוץ לחודש הנוכחי";
    }
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
        nextMonthBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        nextMonthBtn.title = "צור חודש חדש";
    } else {
        nextMonthBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        nextMonthBtn.title = "החודש הבא";
    }
}

function handleCreateNewMonth(newMonthKey, prevMonthKey, shouldCopy) {
    currentMonth = newMonthKey;
    let previousMonthFinalBalance = 0;
    if (allData[prevMonthKey]) {
        const prevData = allData[prevMonthKey];
        const prevBalance = prevData.balance || 0;
        const prevIncome = (prevData.income || []).filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
        const prevExpenses = (prevData.expenses || []).filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
        previousMonthFinalBalance = Math.round(prevBalance + prevIncome - prevExpenses);
    }
    allData[currentMonth] = { income: [], expenses: [], balance: previousMonthFinalBalance };
    if (shouldCopy) {
        const recurringIncomes = new Map();
        const recurringExpenses = new Map();
        const allMonthKeys = getExistingMonths();
        allMonthKeys.forEach(monthKey => {
            if (monthKey === currentMonth) return;
            const monthData = allData[monthKey];
            (monthData.income || []).forEach(t => {
                if (t.recurrence && t.recurrence.isRecurring) {
                    recurringIncomes.set(t.description, t);
                }
            });
            (monthData.expenses || []).forEach(t => {
                if (t.recurrence && t.recurrence.isRecurring) {
                    recurringExpenses.set(t.description, t);
                }
            });
        });
        recurringIncomes.forEach(t => {
            allData[currentMonth].income.push({ ...t, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, checked: true });
        });
        recurringExpenses.forEach(t => {
            allData[currentMonth].expenses.push({ ...t, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, checked: true });
        });
        if (allData[prevMonthKey] && allData[prevMonthKey].expenses) {
            const loansToCopy = allData[prevMonthKey].expenses.filter(t => t.type === 'loan' && !t.completed);
            loansToCopy.forEach(loan => {
                allData[currentMonth].expenses.push({ ...loan, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, checked: true });
            });
        }
    }

    // תיקון: עדכון ידני של שדה העו"ש לערך של החודש החדש
    document.getElementById('currentBalanceInput').value = allData[currentMonth].balance || 0;

    closeNewMonthModal();
    saveDataToLocal();
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
    saveDataToLocal();

    if (direction === 1) { // Next
        if (currentIndex < existingMonths.length - 1) {
            // 2. קבע את החודש החדש
            currentMonth = existingMonths[currentIndex + 1];
            
            // 3. (התיקון) שמור את מפתח החודש החדש ב-localStorage *לפני* הטעינה
            localStorage.setItem('currentMonth', currentMonth);
            
            // 4. טען את נתוני החודש החדש
            loadData();
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

            // 3. (התיקון) שמור את מפתח החודש החדש ב-localStorage *לפני* הטעינה
            localStorage.setItem('currentMonth', currentMonth);

            // 4. טען את נתוני החודש החדש
            loadData();
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
    recalculateBalancesFrom(currentMonth);
    closeEditMonthModal();
    saveDataToLocal();
    render();
}

function recalculateBalancesFrom(startMonthKey) {
    const allMonthKeys = getExistingMonths();
    const startIndex = allMonthKeys.indexOf(startMonthKey);
    if (startIndex === -1) return;
    for (let i = startIndex + 1; i < allMonthKeys.length; i++) {
        const monthToUpdateKey = allMonthKeys[i];
        const prevMonthKey = allMonthKeys[i - 1];
        const prevData = allData[prevMonthKey];
        const prevBalance = prevData.balance || 0;
        const prevIncome = (prevData.income || []).filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
        const prevExpenses = (prevData.expenses || []).filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
        allData[monthToUpdateKey].balance = Math.round(prevBalance + prevIncome - prevExpenses);
    }
}

function deleteCurrentMonth() {
    saveStateForUndo();
    const monthToDelete = currentMonth;
    const existingMonths = getExistingMonths();
    const currentIndex = existingMonths.indexOf(monthToDelete);
    let newCurrentMonth = (currentIndex > 0) ? existingMonths[currentIndex - 1] : (existingMonths.length > 1 ? existingMonths[0] : getCurrentMonthKey());
    
    delete allData[monthToDelete];
    
    if (Object.keys(allData).length === 1 && allData.tags) { // Only tags object left
        allData[newCurrentMonth] = { income: [], expenses: [], balance: 0 };
    }
    currentMonth = newCurrentMonth;
    
    // תיקון: עדכון ידני של שדה העו"ש לערך של החודש החדש
    document.getElementById('currentBalanceInput').value = allData[currentMonth].balance || 0;

    closeEditMonthModal();
    saveDataToLocal();
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
    saveDataToLocal(); 

    // 2. קבע את החודש החדש
    currentMonth = monthKey;

    // 3. (התיקון) שמור את מפתח החודש החדש ב-localStorage *לפני* הטעינה
    localStorage.setItem('currentMonth', currentMonth);
    
    toggleMonthJumper();
    
    // 4. טען את נתוני החודש החדש
    loadData();
}

function jumpToCurrentMonth() {
    const todayMonthKey = getCurrentMonthKey();
    if (currentMonth === todayMonthKey) return;
    
    // 1. שמירת נתוני החודש הנוכחי
    saveDataToLocal();

    if (allData[todayMonthKey]) {
        // 2. קבע את החודש החדש
        currentMonth = todayMonthKey;

        // 3. (התיקון) שמור את מפתח החודש החדש ב-localStorage *לפני* הטעינה
        localStorage.setItem('currentMonth', currentMonth);

        // 4. טען את נתוני החודש החדש
        loadData();
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

// ================================================
// =========== פונקציות שמירה וטעינה ===========
// ================================================

/**
 * פונקציית עזר לתיקון נתונים ישנים (Migration)
 * רצה על כל הנתונים ומוודאת שכל תנועה מכילה אובייקט 'recurrence' תקין
 */
function migrateData(data) {
    if (!data) return {};
    Object.keys(data).forEach(key => {
        if (key === 'tags' || !data[key]) return; // דלג על מפתח התגים

        ['income', 'expenses'].forEach(type => {
            if (data[key][type] && Array.isArray(data[key][type])) {
                data[key][type].forEach(t => {
                    // 1. אם אובייקט 'recurrence' חסר לגמרי, ניצור ברירת מחדל
                    if (!t.recurrence) {
                        t.recurrence = { isRecurring: false, dayOfMonth: null };
                    }
                    
                    // 2. זה התיקון הקריטי לנתונים ישנים:
                    // אם תנועה סומנה כקבועה אבל היום שלה הוא null (מבאג ה-NaN)
                    // נבטל את הסימון שלה כקבועה כדי לתקן את הנתונים.
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

function saveDataToLocal() {
    if (allData[currentMonth]) {
        allData[currentMonth].balance = parseFloat(document.getElementById('currentBalanceInput').value) || 0;
    }
    localStorage.setItem('budgetData', JSON.stringify(allData));
    localStorage.setItem('currentMonth', currentMonth);
}

function loadData() {
    const savedData = localStorage.getItem('budgetData');
    let parsedData = savedData ? JSON.parse(savedData) : {};
    allData = migrateData(parsedData); // <<< תיקון
    
    initializeTags(); // Ensure tags object exists

    currentMonth = localStorage.getItem('currentMonth') || getCurrentMonthKey();

    if (!allData[currentMonth]) {
        allData[currentMonth] = {
            income: [],
            expenses: [],
            balance: 0
        };
    }
    
    manualSortActive = { income: false, expense: false };
    
    document.getElementById('currentBalanceInput').value = allData[currentMonth].balance || 0;
    loadFilters();
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

const themeIcons = {
    light: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    dark: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
    auto: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/><path d="M12 2a10 10 0 1 0 10 10"/></svg>'
};

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
    document.getElementById('themeIconContainer').innerHTML = themeIcons[theme];
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
    const currentBalanceValue = parseFloat(document.getElementById('currentBalanceInput').value) || 0;
    const input = document.getElementById('currentBalanceInput');
    input.classList.toggle('positive-balance', currentBalanceValue > 0);
    input.classList.toggle('negative-balance', currentBalanceValue < 0);
    const currentData = allData[currentMonth] || { income: [], expenses: [] };
    const incomeTotal = (currentData.income || []).reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = (currentData.expenses || []).reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const balanceAfterExpenses = currentBalanceValue - expenseTotal;
    const finalBalance = balanceAfterExpenses + incomeTotal;
    const afterExpensesEl = document.getElementById('balanceAfterExpenses');
    afterExpensesEl.textContent = '₪' + balanceAfterExpenses.toLocaleString('he-IL', { minimumFractionDigits: 2 });
    afterExpensesEl.className = 'summary-block-value ' + (balanceAfterExpenses >= 0 ? 'positive' : 'negative');
    const finalBalanceEl = document.getElementById('finalBalance');
    finalBalanceEl.textContent = '₪' + finalBalance.toLocaleString('he-IL', { minimumFractionDigits: 2 });
    finalBalanceEl.className = 'summary-block-value ' + (finalBalance >= 0 ? 'positive' : 'negative');
    const summaryCard = document.querySelector('.summary-card');
    summaryCard.classList.remove('alert-danger', 'alert-warning', 'alert-success');
    const alertIconDiv = document.getElementById('alertIcon');
    if (finalBalance < 0) {
        summaryCard.classList.add('alert-danger');
        if (alertIconDiv) alertIconDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    } else if (finalBalance >= 0 && finalBalance <= 1000) {
        summaryCard.classList.add('alert-warning');
        if (alertIconDiv) alertIconDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
    } else {
        summaryCard.classList.add('alert-success');
        if (alertIconDiv) alertIconDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    }
    saveDataToLocal();
}

function updateLoansSummary() {
    const latestLoansMap = new Map();
    const allMonthKeys = getExistingMonths();
    allMonthKeys.forEach(monthKey => {
        const monthData = allData[monthKey];
        if (monthData && monthData.expenses) {
            const loansInMonth = monthData.expenses.filter(t => t.type === 'loan');
            loansInMonth.forEach(loan => {
                latestLoansMap.set(loan.description, loan);
            });
        }
    });
    const loanTransactions = Array.from(latestLoansMap.values());
    const loansContent = document.getElementById('loansSummaryContent');
    const noLoansMessage = document.getElementById('noLoansMessage');
    if (loanTransactions.length === 0) {
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
    const activeLoans = loanTransactions.filter(t => !t.completed && t.loanCurrent < t.loanTotal);
    const activeLoansCount = activeLoans.length;
    const monthlyPayment = activeLoans.reduce((sum, t) => sum + t.amount, 0);
    const totalAmount = loanTransactions.reduce((sum, t) => sum + (t.originalLoanAmount || 0), 0);
    const remainingBalance = activeLoans.reduce((sum, t) => {
        const paidAmount = t.amount * t.loanCurrent;
        const remaining = (t.originalLoanAmount || 0) - paidAmount;
        return sum + (remaining > 0 ? remaining : 0);
    }, 0);
    document.getElementById('totalLoansCount').textContent = activeLoansCount;
    document.getElementById('monthlyLoanPayment').textContent = `₪${monthlyPayment.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
    document.getElementById('totalLoanAmount').textContent = `₪${totalAmount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
    document.getElementById('remainingLoanBalance').textContent = `₪${remainingBalance.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
    document.getElementById('loansCollapsedSummary').innerHTML = `<span class="summary-label">יתרה לתשלום:</span> <span class="summary-value">₪${remainingBalance.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>`;
}

function updateBalanceIndicator() {
    const titleElement = document.querySelector('.header h1');
    const indicator = document.getElementById('balanceIndicator');
    const totalIncome = (allData[currentMonth]?.income || []).reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const totalExpenses = (allData[currentMonth]?.expenses || []).reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    titleElement.classList.toggle('title-positive-balance', totalIncome > totalExpenses);
    titleElement.classList.toggle('title-negative-balance', totalExpenses > totalIncome);
    const total = totalIncome + totalExpenses;
    let incomeRatio = 0.5;
    if (total > 0) {
        incomeRatio = totalIncome / total;
    }
    indicator.style.left = `${incomeRatio * 100}%`;
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
        manualSortActive[type] = !manualSortActive[type];
        settings.mode = 'manual';
    } else {
        manualSortActive[type] = false;
        if (settings.mode === 'amount' && mode === 'amount') {
            settings.direction = settings.direction === 'asc' ? 'desc' : 'asc';
        } else {
            settings.mode = mode;
            settings.direction = 'asc';
        }
    }
    localStorage.setItem('sortSettings', JSON.stringify(sortSettings));
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('active'));
    render();
}

function loadSortSettings() {
    const savedSortSettings = localStorage.getItem('sortSettings');
    if (savedSortSettings) {
        sortSettings = JSON.parse(savedSortSettings);
    }
}

function loadFilters() {
    filterIncome = localStorage.getItem('incomeFilter') || 'all';
    filterExpense = localStorage.getItem('expenseFilter') || 'all';
    document.querySelectorAll('#filterDropdownIncome .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.filter === filterIncome);
    });
    document.querySelectorAll('#filterDropdownExpense .filter-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.filter === filterExpense);
    });
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
    saveDataToLocal();
    render();
}

function nextLoanPayment(event, type, id) {
    saveStateForUndo();
    event.stopPropagation();
    const transaction = allData[currentMonth].expenses.find(t => t.id == id);
    if (transaction && transaction.type === 'loan' && transaction.loanCurrent < transaction.loanTotal) {
        transaction.loanCurrent++;
        transaction.isExpanded = true;
        if (transaction.loanCurrent >= transaction.loanTotal) {
            transaction.completed = true;
        }
        saveDataToLocal();
        render();
    }
}

function toggleFilter(type) {
    const otherDropdownId = type === 'income' ? 'sortDropdownIncome' : 'sortDropdownExpense';
    document.getElementById(otherDropdownId).classList.remove('active');
    document.getElementById(type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense').classList.toggle('active');
}

function setFilter(type, filter) {
    if (type === 'income') {
        filterIncome = filter;
    } else {
        filterExpense = filter;
    }
    localStorage.setItem(`${type}Filter`, filter);
    const dropdownId = type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense';
    document.getElementById(dropdownId).classList.remove('active');
    document.querySelectorAll(`#${dropdownId} .filter-option`).forEach(opt => opt.classList.remove('selected'));
    document.querySelector(`#${dropdownId} [data-filter="${filter}"]`).classList.add('selected');
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
                    allData = migrateData(imported); // <<< תיקון
                    initializeTags(); // Ensure tags object exists after import
                    currentMonth = getExistingMonths().pop() || getCurrentMonthKey();
                    saveDataToLocal();
                    loadData();
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
        saveDataToLocal();
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
        ['loanOriginalAmountInput', 'loanTotalInput', 'loanCurrentInput'].forEach(id => document.getElementById(id).value = '');
        selectTransactionType('onetime');
    }

    modal.classList.add('active');
    descriptionInput.focus();
}

function closeModal() {
    document.getElementById('transactionModal').classList.remove('active');
    editingId = null;
    currentTransactionTags = []; // Clear tags on close
}

function saveTransaction() {
    saveStateForUndo();
    const description = document.getElementById('descriptionInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value);
    const isRecurring = document.getElementById('recurrenceCheckbox').checked;
    
    // --- התחלה של התיקון ---
    // 1. קבל את הערך ונתח אותו
    let dayOfMonth = parseInt(document.getElementById('recurrenceDayInput').value, 10);
    
    // 2. ודא ש-NaN (משדה ריק או קלט שגוי) הופך ל-null
    //    כדי שנוכל לבדוק אותו בצורה אמינה.
    if (isNaN(dayOfMonth)) {
        dayOfMonth = null;
    }
    // --- סוף התיקון ---

    if (!description || !amount || amount <= 0) {
        openConfirmModal('שגיאה', 'נא למלא תיאור וסכום חיובי.', closeConfirmModal);
        return;
    }
    
    // עכשיו הבדיקה אמינה יותר כי אנחנו בודקים רק null או טווח
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
            // אם isRecurring נכון, dayOfMonth *חייב* להיות מספר תקין.
            // אם isRecurring שגוי, נשמור null.
            dayOfMonth: isRecurring ? dayOfMonth : null
        },
        tags: currentTransactionTags.map(tag => tag.id) // Save tag IDs
    };
    
    if (transactionData.type === 'regular') {
        transactionData.type = 'onetime';
    }

    if (selectedTransactionType === 'loan') {
        const originalLoanAmount = parseFloat(document.getElementById('loanOriginalAmountInput').value);
        const loanTotal = parseInt(document.getElementById('loanTotalInput').value);
        const loanCurrent = parseInt(document.getElementById('loanCurrentInput').value);
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
    }

    const list = currentType === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;

    if (editingId) {
        const indexToUpdate = list.findIndex(t => t.id == editingId);
        if (indexToUpdate > -1) {
            const existingTransaction = list[indexToUpdate];
            list[indexToUpdate] = { ...existingTransaction, ...transactionData };
            if (transactionData.type === 'loan') {
                list[indexToUpdate].checked = !transactionData.completed;
            }
        }
    } else {
        const newTransaction = {
            ...transactionData,
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            checked: true
        };
        if (newTransaction.type === 'loan') {
            newTransaction.checked = !newTransaction.completed;
        }
        list.push(newTransaction);
    }

    saveDataToLocal();
    render();
    closeModal();
}

function deleteTransaction(event, type, id) {
    event.stopPropagation();
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const transaction = list.find(t => t.id == id);
    if (!transaction) return;
    const message = `האם למחוק את <b>"${sanitizeHTML(transaction.description)}"</b> בסך <b>₪${transaction.amount.toLocaleString('he-IL')}</b>?`;
    openConfirmModal('אישור מחיקת תנועה', message, () => {
        saveStateForUndo();
        const indexToDelete = list.findIndex(t => t.id == id);
        if (indexToDelete > -1) {
            list.splice(indexToDelete, 1);
        }
        saveDataToLocal();
        render();
        closeConfirmModal();
    });
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
    saveDataToLocal();
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
    }
    saveDataToLocal();
    render();
    closeApplyOptionsModal();
}

function closeApplyOptionsModal() {
    document.getElementById('applyOptionsModal').classList.remove('active');
}

function saveStateForUndo() {
    previousState = JSON.parse(JSON.stringify(allData));
    document.getElementById('undoBtn').disabled = false;
}

function undoLastAction() {
    if (previousState) {
        allData = JSON.parse(JSON.stringify(previousState));
        previousState = null;
        document.getElementById('undoBtn').disabled = true;
        saveDataToLocal();
        loadData();
    }
}

function render() {
    const currentData = allData[currentMonth];
    if (!currentData) return;

    // --- RENDER INCOME ---
    let filteredIncome = [...(currentData.income || [])];
    if (filterIncome !== 'all') {
        if (filterIncome === 'active') filteredIncome = filteredIncome.filter(t => t.checked);
        else if (filterIncome === 'inactive') filteredIncome = filteredIncome.filter(t => !t.checked);
        else if (filterIncome === 'regular') filteredIncome = filteredIncome.filter(t => t.recurrence?.isRecurring);
        else filteredIncome = filteredIncome.filter(t => t.type === filterIncome);
    }

    const incomeSort = sortSettings.income;
    if (incomeSort.mode === 'alpha') filteredIncome.sort((a, b) => a.description.localeCompare(b.description, 'he'));
    else if (incomeSort.mode === 'amount') filteredIncome.sort((a, b) => incomeSort.direction === 'asc' ? a.amount - b.amount : b.amount - a.amount);
    else if (incomeSort.mode === 'date') filteredIncome.sort((a, b) => (a.recurrence?.dayOfMonth || 99) - (b.recurrence?.dayOfMonth || 99));

    const incomeList = document.getElementById('incomeList');
    incomeList.innerHTML = filteredIncome.length === 0 ? '<div class="empty-state">אין הכנסות להצגה</div>' : filteredIncome.map((t) => {
        const isRecurring = t.recurrence?.isRecurring;
        
        let iconsHTML = '';
        if (isRecurring) {
            iconsHTML += `<svg class="system-icon icon-recurring" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`;
        }
        
        const originalIndex = currentData.income.findIndex(item => item.id === t.id);

        const dateNote = isRecurring && t.recurrence.dayOfMonth ? `<div class="transaction-date-note">מתקבל ב-${t.recurrence.dayOfMonth} לחודש</div>` : '';
        
        let tagsHTML = '';
        const maxVisibleTags = 3; // Max tags to show inline
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
                // 🚀 שיפור: שימוש ב-data attributes במקום onclick
                tagsHTML += `<button class="tag-overflow-btn" data-action="show-overflow-tags" data-tags='${allTagIdsJson}'>...+${hiddenTagsCount}</button>`;
            }
        }

        // 🚀 שיפור: הסרת כל ה-onclick והוספת data attributes
        return `
            <div class="transaction-wrapper">
                <div class="transaction-item ${!t.checked ? 'inactive' : ''}" data-id="${t.id}" data-type="income">
                    <div class="transaction-info">
                        <div class="transaction-check ${t.checked ? 'checked' : ''}" data-action="toggle-check"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                        <div class="transaction-details">
                            <div class="transaction-text">
                                <span>${sanitizeHTML(t.description)}</span>
                                <div class="transaction-icons">${iconsHTML}</div>
                            </div>
                            <div class="transaction-tags-container">${tagsHTML}</div>
                            ${dateNote}
                        </div>
                    </div>
                    <div class="transaction-amount" data-action="edit-amount">
                        <span class="amount-text">₪${t.amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>
                        <input type="number" class="inline-edit-input" step="0.01" onkeydown="handleEditKeys(event)" onblur="saveAmount(event, 'income')">
                    </div>
                    <div class="item-controls">
                        <div class="sort-buttons ${manualSortActive.income ? 'visible' : ''}">
                            <button class="sort-btn" data-action="move-up" ${originalIndex === 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
                            <button class="sort-btn" data-action="move-down" ${originalIndex === (currentData.income || []).length - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                        </div>
                        <div class="transaction-actions">
                            <button class="action-btn edit" data-action="edit" title="עריכה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
                            <button class="action-btn apply" data-action="apply" title="החל על היתרה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m16 11-4 4-4-4"/><path d="M3 21h18"/></svg></button>
                            <button class="action-btn delete" data-action="delete" title="מחיקה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');

    // --- RENDER EXPENSES ---
    let filteredExpenses = [...(currentData.expenses || [])];
    if (filterExpense !== 'all') {
        if (filterExpense === 'active') filteredExpenses = filteredExpenses.filter(t => t.checked);
        else if (filterExpense === 'inactive') filteredExpenses = filteredExpenses.filter(t => !t.checked);
        else if (filterExpense === 'regular') filteredExpenses = filteredExpenses.filter(t => t.recurrence?.isRecurring);
        else filteredExpenses = filteredExpenses.filter(t => t.type === filterExpense);
    }

    const expenseSort = sortSettings.expense;
    if (expenseSort.mode === 'alpha') filteredExpenses.sort((a, b) => a.description.localeCompare(b.description, 'he'));
    else if (expenseSort.mode === 'amount') filteredExpenses.sort((a, b) => expenseSort.direction === 'asc' ? a.amount - b.amount : b.amount - a.amount);
    else if (expenseSort.mode === 'date') filteredExpenses.sort((a, b) => (a.recurrence?.dayOfMonth || 99) - (b.recurrence?.dayOfMonth || 99));

    const expenseList = document.getElementById('expenseList');
    expenseList.innerHTML = filteredExpenses.length === 0 ? '<div class="empty-state">אין הוצאות להצגה</div>' : filteredExpenses.map((t) => {
        const originalIndex = currentData.expenses.findIndex(item => item.id === t.id);
        const isRecurring = t.recurrence?.isRecurring;
        
        let iconsHTML = '';
        if (t.type === 'loan') {
            iconsHTML += `<svg class="system-icon icon-loan ${t.completed ? 'completed' : ''}" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>`;
        } else if (t.type === 'variable') {
            iconsHTML += `<svg class="system-icon icon-variable" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
        } else if (isRecurring) {
            iconsHTML += `<svg class="system-icon icon-recurring" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`;
        }

        const loanDetails = (t.type === 'loan' && t.originalLoanAmount) ? `<div class="loan-original-amount">סכום הלוואה: ₪${t.originalLoanAmount.toLocaleString('he-IL')}</div>` : '';
        const dateNote = isRecurring && t.recurrence.dayOfMonth ? `<div class="transaction-date-note">יורד ב-${t.recurrence.dayOfMonth} לחודש</div>` : '';
        
        let tagsHTML = '';
        const maxVisibleTags = 3; // Max tags to show inline
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
                // 🚀 שיפור: שימוש ב-data attributes במקום onclick
                tagsHTML += `<button class="tag-overflow-btn" data-action="show-overflow-tags" data-tags='${allTagIdsJson}'>...+${hiddenTagsCount}</button>`;
            }
        }

        let progressBar = '';
        if (t.type === 'loan' && t.loanTotal) {
            const percentage = (t.loanCurrent / t.loanTotal) * 100;
            const amountPaid = t.amount * t.loanCurrent;
            const isComplete = t.loanCurrent >= t.loanTotal;
            progressBar = `
                <div class="loan-progress ${t.isExpanded ? 'visible' : ''}">
                    <div class="loan-progress-container"><div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${percentage}%"></div></div>
                        <div class="progress-text">${t.loanCurrent}/${t.loanTotal} (${percentage.toFixed(0)}%) · ₪${amountPaid.toLocaleString('he-IL')} שולמו</div>
                    </div>
                    <button class="loan-next-payment-btn" data-action="next-loan" ${isComplete ? 'disabled' : ''}>
                        ${isComplete ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'}
                    </button>
                </div>`;
        }
        
        // 🚀 שיפור: הסרת כל ה-onclick והוספת data attributes
        const itemHTML = `
            <div class="transaction-item ${t.type === 'loan' ? 'loan-item' : ''} ${!t.checked ? 'inactive' : ''} ${t.completed ? 'completed' : ''}" 
                 data-id="${t.id}" data-type="expense" ${t.type === 'loan' ? `data-action="toggle-loan"` : ''}>
                <div class="transaction-info">
                    <div class="transaction-check ${t.checked ? 'checked' : ''}" data-action="toggle-check"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
                    <div class="transaction-details">
                        <div class="transaction-text">
                            <span>${sanitizeHTML(t.description)}</span>
                            <div class="transaction-icons">${iconsHTML}</div>
                        </div>
                        <div class="transaction-tags-container">${tagsHTML}</div>
                        ${dateNote}
                        ${loanDetails}
                    </div>
                </div>
                <div class="transaction-amount" data-action="edit-amount">
                    <span class="amount-text">₪${t.amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>
                    <input type="number" class="inline-edit-input" step="0.01" onkeydown="handleEditKeys(event)" onblur="saveAmount(event, 'expense')">
                </div>
                <div class="item-controls">
                    <div class="sort-buttons ${manualSortActive.expense ? 'visible' : ''}">
                        <button class="sort-btn" data-action="move-up" ${originalIndex === 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
                        <button class="sort-btn" data-action="move-down" ${originalIndex === (currentData.expenses || []).length - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                    </div>
                    <div class="transaction-actions">
                        <button class="action-btn edit" data-action="edit" title="עריכה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
                        <button class="action-btn apply" data-action="apply" title="החל על היתרה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m16 11-4 4-4-4"/><path d="M3 21h18"/></svg></button>
                        <button class="action-btn delete" data-action="delete" title="מחיקה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                    </div>
                </div>
            </div>
        `;
        return `<div class="transaction-wrapper">${itemHTML}${progressBar}</div>`;
    }).join('');

    // --- UPDATE TOTALS & SUMMARY ---
    const incomeTotal = filteredIncome.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = filteredExpenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const currentBalanceValue = parseFloat(document.getElementById('currentBalanceInput').value) || 0;
    const finalBalance = currentBalanceValue - expenseTotal + incomeTotal;

    const labelMap = {
        all: 'סה״כ',
        regular: 'סה״כ קבועות',
        variable: 'סה״כ כ.אשראי',
        active: 'סה״כ פעילות',
        inactive: 'סה״כ לא פעילות',
        loan: 'סה״כ הלוואות'
    };
    document.getElementById('incomeTotalLabel').textContent = filterIncome === 'all' ? 'סה״כ הכנסות' : labelMap[filterIncome];
    document.getElementById('expenseTotalLabel').textContent = filterExpense === 'all' ? 'סה״כ הוצאות' : labelMap[filterExpense];

    const totalActiveIncome = (currentData.income || []).filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
    const totalActiveExpenses = (currentData.expenses || []).filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);

    document.getElementById('incomeCollapsedSummary').innerHTML = `<span class="summary-label">סה״כ הכנסות:</span> <span class="summary-value">₪${totalActiveIncome.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>`;
    document.getElementById('expenseCollapsedSummary').innerHTML = `<span class="summary-label">סה״כ הוצאות:</span> <span class="summary-value">₪${totalActiveExpenses.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>`;
    document.getElementById('summaryCollapsedSummary').innerHTML = `<span class="summary-label">עו"ש צפוי:</span> <span class="summary-value ${finalBalance >= 0 ? 'positive' : 'negative'}">₪${finalBalance.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>`;
    document.getElementById('incomeTotal').textContent = '₪' + incomeTotal.toLocaleString('he-IL', { minimumFractionDigits: 2 });
    document.getElementById('expenseTotal').textContent = '₪' + expenseTotal.toLocaleString('he-IL', { minimumFractionDigits: 2 });

    const isIncomeListEmpty = (currentData.income || []).length === 0;
    const isExpenseListEmpty = (currentData.expenses || []).length === 0;
    document.querySelector('.income-card .chart-btn').disabled = isIncomeListEmpty;
    document.getElementById('sortBtnIncome').disabled = isIncomeListEmpty;
    document.getElementById('filterBtnIncome').disabled = isIncomeListEmpty;
    document.querySelector('.expense-card .chart-btn').disabled = isExpenseListEmpty;
    document.getElementById('sortBtnExpense').disabled = isExpenseListEmpty;
    document.getElementById('filterBtnExpense').disabled = isExpenseListEmpty;

    populateMonthJumper();
    updateMonthDisplay();
    updateBalanceIndicator();
    updateLoansSummary();
    updateSummary();
    const deleteAllBtn = document.querySelector('.backup-controls .btn-delete-all-small:last-of-type');
    const deleteMonthBtn = document.getElementById('deleteMonthBtn');
    const isDataEmpty = !currentData || ((currentData.income || []).length === 0 && (currentData.expenses || []).length === 0 && getExistingMonths().length <= 1);
    if (deleteAllBtn) deleteAllBtn.disabled = isDataEmpty;
    if (deleteMonthBtn) deleteMonthBtn.disabled = isDataEmpty;
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
    allRecurringTransactions.clear();
    const allMonthKeys = getExistingMonths();
    allMonthKeys.forEach(monthKey => {
        const monthData = allData[monthKey];
        const list = type === 'income' ? (monthData.income || []) : (monthData.expenses || []);
        list.forEach(t => {
            if (t.recurrence && t.recurrence.isRecurring) {
                // שינוי 1: המפתח הייחודי הוא עכשיו שם + סכום
                const uniqueKey = `${t.description}__${t.amount}`;
                allRecurringTransactions.set(uniqueKey, t);
            }
        });
    });
    
    const recurringList = Array.from(allRecurringTransactions.values());
    
    // שינוי 2: נבדוק כפילויות לפי שם + סכום
    const currentMonthList = type === 'income' ? (allData[currentMonth].income || []) : (allData[currentMonth].expenses || []);
    const currentUniqueKeys = new Set(currentMonthList.map(t => `${t.description}__${t.amount}`));

    dropdown.innerHTML = '';
    if (recurringList.length === 0) {
        dropdown.innerHTML = '<div class="recurring-dropdown-header">לא נמצאו תנועות קבועות</div>';
        return;
    }
    dropdown.innerHTML = '<div class="recurring-dropdown-header">בחר תנועה להוספה</div>';
    
    const unaddedTransactions = [];
    recurringList.forEach(t => {
        // שינוי 3: נשתמש במפתח הייחודי לבדיקה
        const uniqueKey = `${t.description}__${t.amount}`;
        const isAlreadyAdded = currentUniqueKeys.has(uniqueKey);
        
        if (!isAlreadyAdded) {
            unaddedTransactions.push(t);
        }
        
        const item = document.createElement('div');
        item.classList.add('filter-option', 'recurring-item');
        if (isAlreadyAdded) {
            item.classList.add('disabled');
        }
        
        const amountDisplay = `₪${t.amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}`;
        const icon = isAlreadyAdded ?
            `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>` :
            `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
        
        item.innerHTML = `
            <div>${icon} ${sanitizeHTML(t.description)}</div>
            <div class="amount">${amountDisplay}</div>
        `;
        
        if (!isAlreadyAdded) {
            // שינוי 4: נעביר את המפתח הייחודי לפונקציה
            item.onclick = () => addRecurringTransaction(type, uniqueKey);
        }
        dropdown.appendChild(item);
    });
    
    if (unaddedTransactions.length > 0) {
        const footer = document.createElement('div');
        footer.classList.add('recurring-dropdown-footer');
        const addAllButton = document.createElement('div');
        addAllButton.classList.add('filter-option');
        addAllButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            הוסף הכל (${unaddedTransactions.length})
        `;
        addAllButton.onclick = () => addAllRecurringTransactions(type);
        footer.appendChild(addAllButton);
        dropdown.appendChild(footer);
    }
}

function addAllRecurringTransactions(type) {
    saveStateForUndo();
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    
    // ================================================
    // =========== 🐛 תיקון באג לוגי ===========
    // ================================================
    // במקום לבדוק רק לפי 'description'
    // ניצור Set של מפתחות ייחודיים (שם + סכום)
    const currentUniqueKeys = new Set(list.map(t => `${t.description}__${t.amount}`));
    
    let addedCount = 0;
    allRecurringTransactions.forEach(t => {
        // נשתמש במפתח הייחודי לבדיקה
        const uniqueKey = `${t.description}__${t.amount}`;
        if (!currentUniqueKeys.has(uniqueKey)) {
            const newTransaction = { ...t, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${addedCount}`, checked: true };
            list.push(newTransaction);
            addedCount++;
        }
    });
    // ================================================
    // =========== 🐛 סוף תיקון באג לוגי ===========
    // ================================================

    if (addedCount > 0) {
        saveDataToLocal();
        render();
    }
    const dropdownId = type === 'income' ? 'recurringDropdownIncome' : 'recurringDropdownExpense';
    document.getElementById(dropdownId).classList.remove('active');
}

function addRecurringTransaction(type, uniqueKey) {
    // שינוי: הפונקציה מקבלת 'uniqueKey' במקום 'description'
    const transactionToAdd = allRecurringTransactions.get(uniqueKey);
    if (!transactionToAdd) return;
    
    saveStateForUndo();
    const newTransaction = { ...transactionToAdd, id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, checked: true };
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    list.push(newTransaction);
    saveDataToLocal();
    render();
    
    const dropdownId = type === 'income' ? 'recurringDropdownIncome' : 'recurringDropdownExpense';
    document.getElementById(dropdownId).classList.remove('active');
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
                saveDataToLocal();
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
            case 'next-loan': // <-- התיקון כאן, הכפתור הזה יזוהה עכשיו
                nextLoanPayment(event, type, id);
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
    loadSortSettings(); 
    loadData();
    loadCardStates();
    setupBalanceControls();
    setupTagsInputEventListeners(); // New
    
    // ================================================
    // 🚀 שיפור ביצועים: מאזיני אירועים לרשימות
    // ================================================
    document.getElementById('incomeList').addEventListener('click', handleListClick);
    document.getElementById('expenseList').addEventListener('click', handleListClick);

    document.getElementById('prevMonthBtn').addEventListener('click', () => navigateMonths(-1));
    document.getElementById('nextMonthBtn').addEventListener('click', () => navigateMonths(1));
    document.getElementById('deleteMonthBtn').addEventListener('click', openEditMonthModal);
    document.getElementById('monthJumperBtn').addEventListener('click', toggleMonthJumper);
    document.getElementById('loadFromCloudBtn').addEventListener('click', handleLoadFromCloud);
    document.getElementById('saveToCloudBtn').addEventListener('click', handleSaveToCloud);
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
            closeModal();
            closeChartModal();
            closeConfirmModal();
            closeApplyOptionsModal();
            closeNewMonthModal();
            closeEditMonthModal();
            closeTagsManagementModal();
            closeOverflowTagsModal(); // Added
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-container')) {
            document.getElementById('filterDropdownIncome').classList.remove('active');
            document.getElementById('filterDropdownExpense').classList.remove('active');
            document.getElementById('sortDropdownIncome').classList.remove('active');
            document.getElementById('sortDropdownExpense').classList.remove('active');
            document.getElementById('monthJumperList').classList.remove('active');
            document.getElementById('recurringDropdownIncome').classList.remove('active');
            document.getElementById('recurringDropdownExpense').classList.remove('active');
        }
        if (e.target.classList.contains('modal')) {
            e.target.classList.remove('active');
        }
    });
    document.body.classList.remove('preload');
});

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
    const isInfo = title === 'שגיאה' || title === 'מידע' || title === 'הצלחה';
    newConfirmBtn.style.display = isInfo ? 'none' : 'flex';
    newCancelBtn.textContent = isInfo ? 'סגור' : 'ביטול';
    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

function setupBalanceControls() {
    let currentStep = 100;
    const balanceInput = document.getElementById('currentBalanceInput');
    
    const updateBalance = (amount) => {
        let newBalance = (parseFloat(balanceInput.value) || 0) + amount;
        
        // --- התיקון כאן ---
        // עיגול התוצאה ל-2 ספרות עשרוניות
        newBalance = Math.round(newBalance * 100) / 100;
        // --- סוף התיקון ---

        balanceInput.value = newBalance;
        updateSummary();
    };
    
    document.getElementById('incrementBtn').addEventListener('click', () => updateBalance(currentStep));
    document.getElementById('decrementBtn').addEventListener('click', () => updateBalance(-currentStep));
    
    document.getElementById('balanceStepSelector').addEventListener('click', (e) => {
        if (e.target.classList.contains('step-btn')) {
            document.querySelector('#balanceStepSelector .active').classList.remove('active');
            e.target.classList.add('active');
            currentStep = parseInt(e.target.dataset.step, 10);
        }
    });
}

function toggleCard(button, cardName) {
    const card = button.closest('.card');
    card.classList.toggle('is-collapsed');
    button.classList.toggle('collapsed');
    localStorage.setItem(cardName + 'CardState', card.classList.contains('is-collapsed') ? 'collapsed' : 'expanded');
}

function loadCardStates() {
    ['income', 'expense', 'loansSummary', 'summary'].forEach(cardName => {
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
    document.getElementById('pinHeaderBtn').classList.toggle('active', isPinned);
    localStorage.setItem('headerPinned', isPinned ? 'true' : 'false');
}

function loadHeaderPinState() {
    if (localStorage.getItem('headerPinned') === 'true') {
        document.body.classList.add('header-pinned');
        document.getElementById('pinHeaderBtn').classList.add('active');
    }
}


// =======================================================
// =========== לוגיקה חדשה - ניהול קלט תגים ===========
// =======================================================

function setupTagsInputEventListeners() {
    const tagsInput = document.getElementById('tagsInput');
    const suggestionsContainer = document.getElementById('tagsSuggestions');

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

    tagsInput.addEventListener('keyup', () => {
        const query = tagsInput.value.toLowerCase();
        if (!query) {
            suggestionsContainer.innerHTML = '';
            suggestionsContainer.classList.remove('active');
            return;
        }
        const allTags = getAllTags();
        const filteredTags = allTags.filter(tag => tag.name.toLowerCase().includes(query));
        
        suggestionsContainer.innerHTML = '';
        if(filteredTags.length > 0) {
            filteredTags.forEach(tag => {
                const suggestionEl = document.createElement('div');
                suggestionEl.textContent = tag.name;
                suggestionEl.onclick = () => {
                    addTagToTransaction(tag);
                    tagsInput.value = '';
                    suggestionsContainer.innerHTML = '';
                    suggestionsContainer.classList.remove('active');
                };
                suggestionsContainer.appendChild(suggestionEl);
            });
            suggestionsContainer.classList.add('active');
        } else {
            suggestionsContainer.classList.remove('active');
        }
    });

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
            tagItem.innerHTML = `
                <span class="tag-preview" style="background-color: ${tag.color};"></span>
                <span class="tag-name">${sanitizeHTML(tag.name)}</span>
                <div class="tag-actions">
                    <button class="action-btn edit" onclick="editTag('${tag.id}')" title="שנה שם"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
                    <button class="action-btn delete" onclick="deleteTag('${tag.id}')" title="מחק תג"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
            `;
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
        saveDataToLocal();
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

        saveDataToLocal();
        render(); // Re-render main view
        closeConfirmModal();
        openTagsManagementModal(); // Re-render the modal
    });
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