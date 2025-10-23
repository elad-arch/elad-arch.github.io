// ================================================
// =========== הגדרות סנכרון לענן ===========
// ================================================
const BIN_ID = '68fa7e9ad0ea881f40b65011';
const MASTER_KEY = '$2a$10$2l31FVG9Qxn1DXIcxeq6hOQmZgnLls5mCIGRq2Czzfv6fNyEHQFfG';
const BIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

// ================================================
// =========== הגדרות כלליות ===========
// ================================================
let allData = {};
let currentMonth;
let currentType = 'income';
let editingIndex = -1;
let chartInstance = null;
let sortModeIncome = false;
let sortModeExpense = false;
let filterIncome = 'all';
let filterExpense = 'all';
let previousState = null;

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
        if (!decryptedString) return null; // סיסמה שגויה
        return JSON.parse(decryptedString);
    } catch (e) {
        console.error("Decryption failed:", e);
        return null; // סביר להניח שהסיסמה שגויה או שהמידע פגום
    }
}

// ================================================
// =========== פונקציות סנכרון לענן ===========
// ================================================
async function loadFromCloud(password) {
    try {
        const response = await fetch(`${BIN_URL}/latest`, {
            method: 'GET',
            headers: { 'X-Master-Key': MASTER_KEY }
        });
        if (!response.ok) throw new Error('Failed to fetch data');
        const cloudData = await response.json();
        
        // בדוק אם ה-bin במצב התחלתי או לא מכיל את מבנה הנתונים הצפוי
        if (cloudData.record.status === "ready" || !cloudData.record.data) {
            console.log("Cloud bin is empty or in initial state.");
            return 'empty'; 
        }

        const decryptedData = decryptData(cloudData.record.data, password);

        if (decryptedData) {
            allData = decryptedData;
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
    // עוטפים את המידע המוצפן באובייקט כדי לוודא שה-JSON תמיד תקין
    const dataToSave = { data: encryptData(allData, password) };
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

async function syncData() {
    const password = document.getElementById('syncPassword').value;
    if (!password) {
        openConfirmModal('שגיאה', 'יש להזין סיסמת סנכרון.', closeConfirmModal);
        return;
    }

    const syncBtn = document.getElementById('syncBtn');
    const syncBtnSpan = syncBtn.querySelector('span');
    syncBtn.disabled = true;
    syncBtnSpan.textContent = "מסנכרן...";

    const loadResult = await loadFromCloud(password);

    if (loadResult === 'decryption_failed') {
        syncBtnSpan.textContent = "סיסמה שגויה!";
        syncBtn.classList.add('error');
    } else if (loadResult === 'error') {
        syncBtnSpan.textContent = "שגיאת רשת";
        syncBtn.classList.add('error');
    } else {
        // אם הטעינה הצליחה, או אם הענן היה ריק, נשמור את המצב הנוכחי חזרה לענן
        const saveResult = await saveToCloud(password);
        if (saveResult === 'success') {
            syncBtnSpan.textContent = "סונכרן!";
        } else {
            syncBtnSpan.textContent = "שגיאת שמירה";
            syncBtn.classList.add('error');
        }
    }
    
    setTimeout(() => {
        syncBtn.disabled = false;
        syncBtnSpan.textContent = "סנכרן";
        syncBtn.classList.remove('error');
    }, 3000);
}

// ================================================
// =========== פונקציות ניהול חודשים ===========
// ================================================
function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

function updateMonthDisplay() {
    if (!currentMonth) return;
    const [year, month] = currentMonth.split('-');
    const date = new Date(year, month - 1);
    const monthName = date.toLocaleString('he-IL', { month: 'long' });
    document.getElementById('currentMonthDisplay').textContent = `${monthName} ${year}`;
}

function navigateMonths(direction) {
    saveStateForUndo();
    const prevMonthKey = currentMonth;
    
    const [year, month] = currentMonth.split('-').map(Number);
    const currentDate = new Date(year, month - 1, 1);
    currentDate.setMonth(currentDate.getMonth() + direction);
    
    const newYear = currentDate.getFullYear();
    const newMonth = (currentDate.getMonth() + 1).toString().padStart(2, '0');
    const newMonthKey = `${newYear}-${newMonth}`;

    if (direction > 0 && !allData[newMonthKey]) {
        const onConfirm = () => {
            currentMonth = newMonthKey;
            let previousMonthFinalBalance = 0;
            if (allData[prevMonthKey]) {
                const prevData = allData[prevMonthKey];
                const prevBalance = prevData.balance || 0;
                const prevIncome = prevData.income.filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
                const prevExpenses = prevData.expenses.filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
                previousMonthFinalBalance = Math.round(prevBalance + prevIncome - prevExpenses);
            }
            
            allData[currentMonth] = { income: [], expenses: [], balance: previousMonthFinalBalance };

            if (allData[prevMonthKey]) {
                allData[currentMonth].income = allData[prevMonthKey].income
                    .filter(t => t.type === 'regular')
                    .map(t => ({ ...t, id: Date.now() + Math.random(), checked: true }));

                allData[currentMonth].expenses = allData[prevMonthKey].expenses
                    .filter(t => t.type === 'regular' || t.type === 'loan')
                    .map(t => ({ ...t, id: Date.now() + Math.random(), checked: true }));
            }
            
            closeConfirmModal();
            saveDataToLocal();
            render(); 
        };

        openConfirmModal(
            'יצירת חודש חדש', 
            'אתה עומד לפתוח חודש חדש. האם להעתיק את התנועות הקבועות מהחודש הנוכחי?', 
            onConfirm,
            closeConfirmModal
        );

    } else if (allData[newMonthKey]) {
        currentMonth = newMonthKey;
        saveDataToLocal();
        loadData();
    }
}

function confirmDeleteMonth() {
    if (Object.keys(allData).length <= 1) {
        openConfirmModal('מידע', 'לא ניתן למחוק את החודש האחרון שנותר.', closeConfirmModal);
        return;
    }
    const [year, month] = currentMonth.split('-');
    const date = new Date(year, month - 1);
    const monthName = date.toLocaleString('he-IL', { month: 'long' });
    const message = `האם למחוק את כל הנתונים עבור חודש <b>${monthName} ${year}</b>?`;
    
    openConfirmModal('אישור מחיקת חודש', message, deleteCurrentMonth);
}

function deleteCurrentMonth() {
    saveStateForUndo();
    const monthToDelete = currentMonth;
    const existingMonths = Object.keys(allData).sort();
    const currentIndex = existingMonths.indexOf(monthToDelete);
    
    let newCurrentMonth = (currentIndex > 0) ? existingMonths[currentIndex - 1] : existingMonths[currentIndex + 1];

    delete allData[monthToDelete];
    currentMonth = newCurrentMonth;

    closeConfirmModal();
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
    currentMonth = monthKey;
    toggleMonthJumper();
    saveDataToLocal();
    loadData();
}

function populateMonthJumper() {
    const jumperList = document.getElementById('monthJumperList');
    if(!jumperList) return;
    const months = Object.keys(allData).sort((a, b) => b.localeCompare(a));
    
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
function saveDataToLocal() {
    if (allData[currentMonth]) {
        allData[currentMonth].balance = parseFloat(document.getElementById('currentBalanceInput').value) || 0;
    }
    localStorage.setItem('budgetData', JSON.stringify(allData));
    localStorage.setItem('currentMonth', currentMonth);
}

function loadData() {
    const savedData = localStorage.getItem('budgetData');
    allData = savedData ? JSON.parse(savedData) : {};
    
    currentMonth = localStorage.getItem('currentMonth') || getCurrentMonthKey();

    if (!allData[currentMonth]) {
        allData[currentMonth] = {
            income: [],
            expenses: [],
            balance: 0
        };
    }
    
    document.getElementById('currentBalanceInput').value = allData[currentMonth].balance || 0;
    
    loadFilters();
    render();
}

// ================================================
// =========== פונקציות ליבה ו-UI ===========
// ================================================
function toggleLoanProgress(type, index) {
    const transaction = allData[currentMonth].expenses[index];
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
    const amountLabel = document.getElementById('amountLabel');
    const loanFields = document.getElementById('loanFields');
    const descriptionInput = document.getElementById('descriptionInput');
    if (currentType === 'income') descriptionInput.placeholder = "למשל: משכורת, מתנה";
    else {
        if (type === 'variable') descriptionInput.placeholder = "למשל: שם הכרטיס (אמקס, ויזה)";
        else if (type === 'loan') descriptionInput.placeholder = "למשל: החזר משכנתא, הלוואת רכב";
        else descriptionInput.placeholder = "למשל: קניות, חשבון חשמל";
    }
    if (type === 'loan') {
        document.getElementById('typeLoan').classList.add('selected');
        loanFields.classList.add('active');
        amountLabel.textContent = "סכום תשלום חודשי (₪)";
    } else {
        if (type === 'regular') document.getElementById('typeRegular').classList.add('selected');
        if (type === 'variable') document.getElementById('typeVariable').classList.add('selected');
        if (type === 'onetime') document.getElementById('typeOnetime').classList.add('selected');
        loanFields.classList.remove('active');
        amountLabel.textContent = "סכום (₪)";
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
    if (theme === 'auto') body.setAttribute('data-theme', getSystemTheme());
    else body.setAttribute('data-theme', theme);
    updateThemeButton(theme);
}

function updateThemeButton(theme) {
    document.getElementById('themeIconContainer').innerHTML = themeIcons[theme];
}

function cycleTheme() {
    const currentTheme = localStorage.getItem('themePreference') || 'auto';
    let newTheme;
    if (currentTheme === 'auto') newTheme = 'light';
    else if (currentTheme === 'light') newTheme = 'dark';
    else newTheme = 'auto';
    localStorage.setItem('themePreference', newTheme);
    applyTheme(newTheme);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const savedTheme = localStorage.getItem('themePreference') || 'auto';
    if (savedTheme === 'auto') applyTheme('auto');
});


function updateSummary() {
    const currentBalanceValue = parseFloat(document.getElementById('currentBalanceInput').value) || 0;
    const input = document.getElementById('currentBalanceInput');
    input.classList.toggle('positive-balance', currentBalanceValue > 0);
    input.classList.toggle('negative-balance', currentBalanceValue < 0);

    const currentData = allData[currentMonth] || { income: [], expenses: [] };
    const incomeTotal = currentData.income.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = currentData.expenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
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
    const loanTransactions = allData[currentMonth]?.expenses.filter(t => t.type === 'loan') || [];
    const loansContent = document.getElementById('loansSummaryContent');
    const noLoansMessage = document.getElementById('noLoansMessage');
    const totalAmount = loanTransactions.reduce((sum, t) => sum + (t.originalLoanAmount || 0), 0);

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

    const activeLoansCount = loanTransactions.filter(t => t.loanCurrent < t.loanTotal).length;
    const monthlyPayment = loanTransactions.reduce((sum, t) => sum + t.amount, 0);
    const remainingBalance = loanTransactions.reduce((sum, t) => {
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
    const totalIncome = allData[currentMonth]?.income.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0) || 0;
    const totalExpenses = allData[currentMonth]?.expenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0) || 0;

    titleElement.classList.toggle('title-positive-balance', totalIncome > totalExpenses);
    titleElement.classList.toggle('title-negative-balance', totalExpenses > totalIncome);

    const total = totalIncome + totalExpenses;
    let incomeRatio = 0.5;
    if (total > 0) {
        incomeRatio = totalIncome / total;
    }
    indicator.style.left = `${incomeRatio * 100}%`;
}

function toggleSortMode(type) {
    if (type === 'income') {
        sortModeIncome = !sortModeIncome;
        document.getElementById('sortBtnIncome').classList.toggle('active');
    } else {
        sortModeExpense = !sortModeExpense;
        document.getElementById('sortBtnExpense').classList.toggle('active');
    }
    render();
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

function moveItem(event, type, index, direction) {
    saveStateForUndo();
    event.stopPropagation();
    const arr = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    if (direction === 'up' && index > 0) [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
    else if (direction === 'down' && index < arr.length - 1) [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    saveDataToLocal();
    render();
}

function nextLoanPayment(event, type, index) {
    saveStateForUndo();
    event.stopPropagation();
    const transaction = allData[currentMonth].expenses[index];
    if (transaction.type === 'loan' && transaction.loanCurrent < transaction.loanTotal) {
        transaction.loanCurrent++;
        transaction.isExpanded = true;
        if (transaction.loanCurrent >= transaction.loanTotal) {
            transaction.checked = false;
            transaction.completed = true;
        }
        saveDataToLocal();
        render();
    }
}

function toggleFilter(type) {
    document.getElementById(type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense').classList.toggle('active');
}

function setFilter(type, filter) {
    let dropdownId;
    if (type === 'income') {
        filterIncome = filter;
        dropdownId = 'filterDropdownIncome';
        if (sortModeIncome) {
            sortModeIncome = false;
            document.getElementById('sortBtnIncome').classList.remove('active');
        }
    } else {
        filterExpense = filter;
        dropdownId = 'filterDropdownExpense';
        if (sortModeExpense) {
            sortModeExpense = false;
            document.getElementById('sortBtnExpense').classList.remove('active');
        }
    }
    localStorage.setItem(`${type}Filter`, filter);
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
                    allData = imported;
                    currentMonth = Object.keys(allData).sort().pop() || getCurrentMonthKey();
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
            datasets: [{ data: amounts, backgroundColor: colors, borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue('--card-bg') }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { padding: 15, font: { size: 14 }, color: getComputedStyle(document.body).getPropertyValue('--text-primary') } },
                tooltip: { callbacks: { label: (c) => `${c.label}: ₪${c.parsed.toLocaleString('he-IL')} (${((c.parsed / c.dataset.data.reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%)` } }
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
    if (Object.keys(allData).length === 0) return;
    const message = `אתה עומד למחוק את <b>כל הנתונים מכל החודשים</b> לצמיתות. האם להמשיך?`;
    openConfirmModal('אישור מחיקת כל הנתונים', message, () => {
        saveStateForUndo();
        allData = {};
        currentMonth = getCurrentMonthKey();
        allData[currentMonth] = { income: [], expenses: [], balance: 0 };
        document.getElementById('currentBalanceInput').value = 0;
        saveDataToLocal();
        render();
        closeConfirmModal();
    });
}

function openModal(event, type, index = -1) {
    if (typeof event === 'string') type = event;
    else if (event) event.stopPropagation();
    currentType = type;
    editingIndex = index;
    const modal = document.getElementById('transactionModal');
    const title = document.getElementById('modalTitle');
    const [descriptionInput, amountInput, loanOriginalAmountInput, loanTotalInput, loanCurrentInput] = ['descriptionInput', 'amountInput', 'loanOriginalAmountInput', 'loanTotalInput', 'loanCurrentInput'].map(id => document.getElementById(id));

    document.getElementById('typeLoan').classList.toggle('disabled', type === 'income');
    document.getElementById('typeVariable').classList.toggle('disabled', type === 'income');

    if (index >= 0) {
        const transaction = type === 'income' ? allData[currentMonth].income[index] : allData[currentMonth].expenses[index];
        title.textContent = 'עריכת תנועה';
        descriptionInput.value = transaction.description;
        amountInput.value = transaction.amount;
        selectTransactionType(transaction.type || 'regular');
        if (transaction.type === 'loan') {
            loanOriginalAmountInput.value = transaction.originalLoanAmount || '';
            loanTotalInput.value = transaction.loanTotal || '';
            loanCurrentInput.value = transaction.loanCurrent || '';
        }
    } else {
        title.textContent = type === 'income' ? 'הוספת הכנסה' : 'הוספת הוצאה';
        [descriptionInput, amountInput, loanOriginalAmountInput, loanTotalInput, loanCurrentInput].forEach(input => input.value = '');
        selectTransactionType('regular');
    }
    modal.classList.add('active');
    descriptionInput.focus();
}

function closeModal() {
    document.getElementById('transactionModal').classList.remove('active');
}

function saveTransaction() {
    saveStateForUndo();
    const description = document.getElementById('descriptionInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value);

    if (!description || !amount || amount <= 0) {
        openConfirmModal('שגיאה', 'נא למלא תיאור וסכום חיובי.', closeConfirmModal);
        return;
    }
    const transaction = { id: Date.now(), description, amount, checked: true, type: selectedTransactionType };

    if (selectedTransactionType === 'loan') {
        const originalLoanAmount = parseFloat(document.getElementById('loanOriginalAmountInput').value);
        const loanTotal = parseInt(document.getElementById('loanTotalInput').value);
        const loanCurrent = parseInt(document.getElementById('loanCurrentInput').value);
        if (!originalLoanAmount || !loanTotal || isNaN(loanCurrent) || originalLoanAmount <= 0 || loanTotal < 1 || loanCurrent < 0 || loanCurrent > loanTotal || amount > originalLoanAmount) {
            openConfirmModal('שגיאה', 'נא למלא את כל פרטי ההלוואה באופן תקין.', closeConfirmModal);
            return;
        }
        transaction.originalLoanAmount = originalLoanAmount;
        transaction.loanTotal = loanTotal;
        transaction.loanCurrent = loanCurrent;
        transaction.completed = transaction.loanCurrent >= transaction.loanTotal;
        transaction.checked = !transaction.completed;
    }

    const list = currentType === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    if (editingIndex >= 0) {
        const existingTransaction = list[editingIndex];
        list[editingIndex] = { ...existingTransaction, ...transaction };
    } else {
        list.push(transaction);
    }
    saveDataToLocal();
    render();
    closeModal();
}

function deleteTransaction(event, type, index) {
    event.stopPropagation();
    const transaction = type === 'income' ? allData[currentMonth].income[index] : allData[currentMonth].expenses[index];
    const message = `האם למחוק את <b>"${transaction.description}"</b> בסך <b>₪${transaction.amount.toLocaleString('he-IL')}</b>?`;
    openConfirmModal('אישור מחיקת תנועה', message, () => {
        saveStateForUndo();
        if (type === 'income') allData[currentMonth].income.splice(index, 1);
        else allData[currentMonth].expenses.splice(index, 1);
        saveDataToLocal();
        render();
        closeConfirmModal();
    });
}

function toggleCheck(event, type, index) {
    saveStateForUndo();
    event.stopPropagation();
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    list[index].checked = !list[index].checked;
    saveDataToLocal();
    render();
}

let currentEditingElement = null;

function editAmount(event, type, index) {
    event.stopPropagation();
    const amountWrapper = event.currentTarget;
    if (amountWrapper.classList.contains('editing')) return;
    if (currentEditingElement) currentEditingElement.querySelector('.inline-edit-input').blur();
    const amountInput = amountWrapper.querySelector('.inline-edit-input');
    const transaction = type === 'income' ? allData[currentMonth].income[index] : allData[currentMonth].expenses[index];
    currentEditingElement = amountWrapper;
    amountWrapper.classList.add('editing');
    amountInput.value = transaction.amount;
    amountInput.focus();
    amountInput.select();
}

function saveAmount(event, type, index) {
    const input = event.target;
    const newAmount = parseFloat(input.value);
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const originalAmount = list[index].amount;
    if (currentEditingElement) {
        currentEditingElement.classList.remove('editing');
        currentEditingElement = null;
    }
    if (!isNaN(newAmount) && newAmount >= 0 && newAmount !== originalAmount) {
        saveStateForUndo();
        list[index].amount = newAmount;
    }
    saveDataToLocal();
    render();
}

function handleEditKeys(event) {
    if (event.key === 'Enter') event.target.blur();
    else if (event.key === 'Escape') {
        event.target.value = -1;
        event.target.blur();
    }
}

function openApplyOptionsModal(type, index) {
    const transaction = type === 'income' ? allData[currentMonth].income[index] : allData[currentMonth].expenses[index];
    const modal = document.getElementById('applyOptionsModal');
    document.getElementById('applyOptionsTransactionInfo').innerHTML = `<span>${transaction.description}</span><span class="${type === 'income' ? 'positive' : 'negative'}">₪${transaction.amount.toLocaleString('he-IL')}</span>`;
    modal.querySelectorAll('.apply-option').forEach(option => {
        const newOption = option.cloneNode(true);
        option.parentNode.replaceChild(newOption, option);
        newOption.addEventListener('click', () => handleApplyAction(type, index, newOption.dataset.action));
    });
    modal.classList.add('active');
}

function handleApplyAction(type, index, action) {
    saveStateForUndo();
    const list = type === 'income' ? allData[currentMonth].income : allData[currentMonth].expenses;
    const transaction = list[index];
    const amount = transaction.amount;
    let currentBalanceValue = parseFloat(document.getElementById('currentBalanceInput').value) || 0;

    if (type === 'income') currentBalanceValue += amount;
    else currentBalanceValue -= amount;
    document.getElementById('currentBalanceInput').value = currentBalanceValue;
    
    if (action === 'apply-delete') list.splice(index, 1);
    else if (action === 'apply-zero') list[index].amount = 0;
    
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

    let filteredIncome = currentData.income;
    if (filterIncome !== 'all') {
        if (filterIncome === 'active') filteredIncome = currentData.income.filter(t => t.checked);
        else if (filterIncome === 'inactive') filteredIncome = currentData.income.filter(t => !t.checked);
        else filteredIncome = currentData.income.filter(t => t.type === filterIncome);
    }
    
    const incomeList = document.getElementById('incomeList');
    incomeList.innerHTML = filteredIncome.length === 0 ? '<div class="empty-state">אין הכנסות להצגה</div>' : filteredIncome.map((t, i) => {
        let badgeClass = 'badge-regular', badgeText = 'קבוע';
        if (t.type === 'onetime') { badgeClass = 'badge-onetime'; badgeText = 'חד-פעמי'; }
        return `<div class="transaction-wrapper"><div class="transaction-item ${!t.checked ? 'inactive' : ''}"><div class="transaction-info"><div class="transaction-check ${t.checked ? 'checked' : ''}" onclick="toggleCheck(event, 'income', ${i})"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div><div class="transaction-details"><div class="transaction-text">${t.description} <span class="transaction-badge ${badgeClass}">${badgeText}</span></div></div></div><div class="transaction-amount" onclick="editAmount(event, 'income', ${i})"><span class="amount-text">₪${t.amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span><input type="number" class="inline-edit-input" step="0.01" onkeydown="handleEditKeys(event)" onblur="saveAmount(event, 'income', ${i})"></div><div class="item-controls"><div class="sort-buttons ${sortModeIncome ? 'visible' : ''}"><button class="sort-btn" onclick="moveItem(event, 'income', ${i}, 'up')" ${i === 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button><button class="sort-btn" onclick="moveItem(event, 'income', ${i}, 'down')" ${i === filteredIncome.length - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button></div><div class="transaction-actions"><button class="action-btn edit" onclick="openModal(event, 'income', ${i})" title="עריכה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button><button class="action-btn apply" onclick="openApplyOptionsModal('income', ${i})" title="החל על היתרה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m16 11-4 4-4-4"/><path d="M3 21h18"/></svg></button><button class="action-btn delete" onclick="deleteTransaction(event, 'income', ${i})" title="מחיקה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button></div></div></div></div>`;
    }).join('');

    let filteredExpenses = currentData.expenses;
    if (filterExpense !== 'all') {
        if (filterExpense === 'active') filteredExpenses = currentData.expenses.filter(t => t.checked);
        else if (filterExpense === 'inactive') filteredExpenses = currentData.expenses.filter(t => !t.checked);
        else filteredExpenses = currentData.expenses.filter(t => t.type === filterExpense);
    }
    const expenseList = document.getElementById('expenseList');
    expenseList.innerHTML = filteredExpenses.length === 0 ? '<div class="empty-state">אין הוצאות להצגה</div>' : filteredExpenses.map((t, i) => {
        let badgeClass = 'badge-regular', badgeText = 'קבוע';
        const isCompleted = t.completed;
        if (t.type === 'loan') badgeClass = isCompleted ? 'badge-loan completed' : 'badge-loan', badgeText = isCompleted ? 'שולמה' : 'הלוואה';
        else if (t.type === 'variable') badgeClass = 'badge-variable', badgeText = `<svg class="credit-card-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>&nbsp; כרטיס אשראי`;
        else if (t.type === 'onetime') badgeClass = 'badge-onetime', badgeText = 'חד-פעמי';
        const loanDetails = (t.type === 'loan' && t.originalLoanAmount) ? `<div class="loan-original-amount">סכום הלוואה: ₪${t.originalLoanAmount.toLocaleString('he-IL')}</div>` : '';
        let progressBar = '';
        if (t.type === 'loan' && t.loanTotal) {
            const percentage = (t.loanCurrent / t.loanTotal) * 100;
            const amountPaid = t.amount * t.loanCurrent;
            const isComplete = t.loanCurrent >= t.loanTotal;
            progressBar = `<div class="loan-progress ${t.isExpanded ? 'visible' : ''}"><div class="loan-progress-container"><div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${percentage}%"></div></div><div class="progress-text">${t.loanCurrent}/${t.loanTotal} (${percentage.toFixed(0)}%) · ₪${amountPaid.toLocaleString('he-IL')} שולמו</div></div><button class="loan-next-payment-btn" onclick="nextLoanPayment(event, 'expense', ${i})" ${isComplete ? 'disabled' : ''}>${isComplete ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'}</button></div>`;
        }
        const itemHTML = `<div class="transaction-item ${t.type === 'loan' ? 'loan-item' : ''} ${!t.checked ? 'inactive' : ''} ${isCompleted ? 'completed' : ''}" ${t.type === 'loan' ? `onclick="toggleLoanProgress(event, ${i})"` : ''}><div class="transaction-info"><div class="transaction-check ${t.checked ? 'checked' : ''}" onclick="toggleCheck(event, 'expense', ${i})"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div><div class="transaction-details"><div class="transaction-text">${t.description} <span class="transaction-badge ${badgeClass}">${badgeText}</span></div>${loanDetails}</div></div><div class="transaction-amount" onclick="editAmount(event, 'expense', ${i})"><span class="amount-text">₪${t.amount.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span><input type="number" class="inline-edit-input" step="0.01" onkeydown="handleEditKeys(event)" onblur="saveAmount(event, 'expense', ${i})"></div><div class="item-controls"><div class="sort-buttons ${sortModeExpense ? 'visible' : ''}"><button class="sort-btn" onclick="moveItem(event, 'expense', ${i}, 'up')" ${i === 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button><button class="sort-btn" onclick="moveItem(event, 'expense', ${i}, 'down')" ${i === filteredExpenses.length - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button></div><div class="transaction-actions"><button class="action-btn edit" onclick="openModal(event, 'expense', ${i})" title="עריכה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button><button class="action-btn apply" onclick="openApplyOptionsModal('expense', ${i})" title="החל על היתרה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m16 11-4 4-4-4"/><path d="M3 21h18"/></svg></button><button class="action-btn delete" onclick="deleteTransaction(event, 'expense', ${i})" title="מחיקה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button></div></div></div>`;
        return `<div class="transaction-wrapper">${itemHTML}${progressBar}</div>`;
    }).join('');

    const incomeTotal = filteredIncome.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = filteredExpenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const currentBalanceValue = parseFloat(document.getElementById('currentBalanceInput').value) || 0;
    const finalBalance = currentBalanceValue - expenseTotal + incomeTotal;

    const labelMap = { all: 'סה״כ', regular: 'סה״כ קבועות', variable: 'סה״כ כ.אשראי', onetime: 'סה״כ חד-פעמיות', active: 'סה״כ פעילות', inactive: 'סה״כ לא פעילות', loan: 'סה״כ הלוואות' };
    document.getElementById('incomeTotalLabel').textContent = filterIncome === 'all' ? 'סה״כ הכנסות' : labelMap[filterIncome];
    document.getElementById('expenseTotalLabel').textContent = filterExpense === 'all' ? 'סה״כ הוצאות' : labelMap[filterExpense];

    const totalActiveIncome = currentData.income.filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
    const totalActiveExpenses = currentData.expenses.filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
    document.getElementById('incomeCollapsedSummary').innerHTML = `<span class="summary-label">סה״כ הכנסות:</span> <span class="summary-value">₪${totalActiveIncome.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>`;
    document.getElementById('expenseCollapsedSummary').innerHTML = `<span class="summary-label">סה״כ הוצאות:</span> <span class="summary-value">₪${totalActiveExpenses.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>`;
    document.getElementById('summaryCollapsedSummary').innerHTML = `<span class="summary-label">עו"ש צפוי:</span> <span class="summary-value ${finalBalance >= 0 ? 'positive' : 'negative'}">₪${finalBalance.toLocaleString('he-IL', { minimumFractionDigits: 2 })}</span>`;
    document.getElementById('incomeTotal').textContent = '₪' + incomeTotal.toLocaleString('he-IL', { minimumFractionDigits: 2 });
    document.getElementById('expenseTotal').textContent = '₪' + expenseTotal.toLocaleString('he-IL', { minimumFractionDigits: 2 });
    
    document.querySelector('.income-card .chart-btn').disabled = filterIncome !== 'all';
    document.querySelector('.income-card .sort-mode-btn').disabled = filterIncome !== 'all';
    document.querySelector('.expense-card .chart-btn').disabled = filterExpense !== 'all';
    document.querySelector('.expense-card .sort-mode-btn').disabled = filterExpense !== 'all';
    
    populateMonthJumper();
    updateMonthDisplay();
    updateBalanceIndicator();
    updateLoansSummary();
    updateSummary();
}

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadHeaderPinState();
    loadData();
    loadCardStates();
    setupBalanceControls();
    document.getElementById('prevMonthBtn').addEventListener('click', () => navigateMonths(-1));
    document.getElementById('nextMonthBtn').addEventListener('click', () => navigateMonths(1));
    document.getElementById('deleteMonthBtn').addEventListener('click', confirmDeleteMonth);
    document.getElementById('monthJumperBtn').addEventListener('click', toggleMonthJumper);
    document.getElementById('syncBtn').addEventListener('click', syncData);

    document.querySelectorAll('#filterDropdownIncome .filter-option, #filterDropdownExpense .filter-option').forEach(option => {
        option.addEventListener('click', () => {
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
        }
    });
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dropdown-container')) {
            document.getElementById('filterDropdownIncome').classList.remove('active');
            document.getElementById('filterDropdownExpense').classList.remove('active');
            document.getElementById('monthJumperList').classList.remove('active');
        }
    });

    ['transactionModal', 'chartModal', 'confirmModal', 'applyOptionsModal'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target.id === id) e.target.classList.remove('active');
        });
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

    const isInfo = title === 'שגיאה' || title === 'מידע';
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
        balanceInput.value = (parseFloat(balanceInput.value) || 0) + amount;
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