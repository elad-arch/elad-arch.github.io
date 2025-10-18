let transactions = {
    income: [],
    expenses: []
};
let currentType = 'income';
let editingIndex = -1;
let chartInstance = null;
let currentBalanceValue = 0;
let sortModeIncome = false;
let sortModeExpense = false;
let filterIncome = 'all';
let filterExpense = 'all';

function toggleLoanProgress(element) {
    const wrapper = element.closest('.transaction-wrapper');
    const progressBar = wrapper.querySelector('.loan-progress');
    if (progressBar) {
        progressBar.classList.toggle('visible');
    }
}

const themeIcons = {
    light: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    dark: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
    auto: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"/><path d="M12 2a10 10 0 1 0 10 10"/></svg>'
};

function selectTransactionType(type) {
    if ((type === 'loan' || type === 'variable') && currentType === 'income') {
        return;
    }
    
    selectedTransactionType = type;
    document.querySelectorAll('.type-option').forEach(el => el.classList.remove('selected'));
    
    const amountLabel = document.getElementById('amountLabel');
    const loanFields = document.getElementById('loanFields');

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
    if (theme === 'auto') {
        const systemTheme = getSystemTheme();
        body.setAttribute('data-theme', systemTheme);
    } else {
        body.setAttribute('data-theme', theme);
    }
    updateThemeButton(theme);
}

function updateThemeButton(theme) {
    const themeIconContainer = document.getElementById('themeIconContainer');
    themeIconContainer.innerHTML = themeIcons[theme];
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

function saveData() {
    localStorage.setItem('budgetData', JSON.stringify(transactions));
    localStorage.setItem('currentBalance', currentBalanceValue.toString());
}

function updateSummary() {
    const input = document.getElementById('currentBalanceInput');
    currentBalanceValue = parseFloat(input.value) || 0;
    
    const incomeTotal = transactions.income.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = transactions.expenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    
    const balanceAfterExpenses = currentBalanceValue - expenseTotal;
    const finalBalance = balanceAfterExpenses + incomeTotal;
    
    const afterExpensesEl = document.getElementById('balanceAfterExpenses');
    afterExpensesEl.textContent = '₪' + balanceAfterExpenses.toLocaleString('he-IL', {minimumFractionDigits: 2});
    afterExpensesEl.className = 'summary-row-value ' + (balanceAfterExpenses >= 0 ? 'positive' : 'negative');
    
    const finalBalanceEl = document.getElementById('finalBalance');
    finalBalanceEl.textContent = '₪' + finalBalance.toLocaleString('he-IL', {minimumFractionDigits: 2});
    finalBalanceEl.className = 'summary-row-value ' + (finalBalance >= 0 ? 'positive' : 'negative');
    
    const summaryCard = document.querySelector('.summary-card');
    summaryCard.classList.remove('alert-danger', 'alert-warning', 'alert-success');
    
    const alertIconDiv = document.getElementById('alertIcon');
     if (finalBalance < 0) {
        summaryCard.classList.add('alert-danger');
        if(alertIconDiv) alertIconDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    } else if (finalBalance >= 0 && finalBalance <= 1000) {
        summaryCard.classList.add('alert-warning');
        if(alertIconDiv) alertIconDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
    } else {
        summaryCard.classList.add('alert-success');
        if(alertIconDiv) alertIconDiv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    }

    saveData();
}

function updateLoansSummary() {
    const loanTransactions = transactions.expenses.filter(t => t.type === 'loan');
    const loansContent = document.getElementById('loansSummaryContent');
    const noLoansMessage = document.getElementById('noLoansMessage');
    
    const totalAmount = loanTransactions.reduce((sum, t) => sum + (t.originalLoanAmount || 0), 0);

    if (loanTransactions.length === 0) {
        if(loansContent) loansContent.style.display = 'none';
        if(noLoansMessage) noLoansMessage.style.display = 'block';
        document.getElementById('totalLoansCount').textContent = 0;
        document.getElementById('monthlyLoanPayment').textContent = `₪0.00`;
        document.getElementById('totalLoanAmount').textContent = `₪0.00`;
        document.getElementById('remainingLoanBalance').textContent = `₪0.00`;
         document.getElementById('loansCollapsedSummary').innerHTML = `<span class="summary-label">אין הלוואות פעילות</span>`;

        return;
    }

    if(loansContent) loansContent.style.display = 'block';
    if(noLoansMessage) noLoansMessage.style.display = 'none';

    const activeLoansCount = loanTransactions.filter(t => t.loanCurrent < t.loanTotal).length;

    const monthlyPayment = loanTransactions.reduce((sum, t) => sum + t.amount, 0);


    const remainingBalance = loanTransactions.reduce((sum, t) => {
        const paidAmount = t.amount * t.loanCurrent;
        const remaining = (t.originalLoanAmount || 0) - paidAmount;
        return sum + (remaining > 0 ? remaining : 0);
    }, 0);

    document.getElementById('totalLoansCount').textContent = activeLoansCount;
    document.getElementById('monthlyLoanPayment').textContent = `₪${monthlyPayment.toLocaleString('he-IL', {minimumFractionDigits: 2})}`;
    document.getElementById('totalLoanAmount').textContent = `₪${totalAmount.toLocaleString('he-IL', {minimumFractionDigits: 2})}`;
    document.getElementById('remainingLoanBalance').textContent = `₪${remainingBalance.toLocaleString('he-IL', {minimumFractionDigits: 2})}`;
     document.getElementById('loansCollapsedSummary').innerHTML = `<span class="summary-label">יתרה לתשלום:</span> <span class="summary-value">₪${remainingBalance.toLocaleString('he-IL', {minimumFractionDigits: 2})}</span>`;

}

function updateBalanceIndicator() {
    const titleElement = document.querySelector('.header h1');
    const indicator = document.getElementById('balanceIndicator');

    // Use only CHECKED transactions for the main balance indicator
    const totalIncome = transactions.income.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const totalExpenses = transactions.expenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);

    // Update title stroke
    titleElement.classList.remove('title-positive-balance', 'title-negative-balance');
    if (totalIncome > totalExpenses) {
        titleElement.classList.add('title-positive-balance');
    } else if (totalExpenses > totalIncome) {
        titleElement.classList.add('title-negative-balance');
    }

    // Update scale position
    const total = totalIncome + totalExpenses;
    let incomeRatio = 0.5; // Default to center if no transactions
    if (total > 0) {
        incomeRatio = totalIncome / total;
    }
    
    // A higher incomeRatio should move the indicator to the right (green side)
    indicator.style.left = `${incomeRatio * 100}%`;
}


function toggleSortMode(type) {
    if (type === 'income') {
        sortModeIncome = !sortModeIncome;
        const btn = document.getElementById('sortBtnIncome');
        if (sortModeIncome) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    } else {
        sortModeExpense = !sortModeExpense;
        const btn = document.getElementById('sortBtnExpense');
        if (sortModeExpense) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }
    render();
}

function loadData() {
    const saved = localStorage.getItem('budgetData');
    if (saved) {
        transactions = JSON.parse(saved);
    }
    
    const savedBalance = localStorage.getItem('currentBalance');
    if (savedBalance) {
        currentBalanceValue = parseFloat(savedBalance);
        document.getElementById('currentBalanceInput').value = currentBalanceValue;
    }
    
    loadFilters();
    render();
}

function loadFilters() {
    filterIncome = localStorage.getItem('incomeFilter') || 'all';
    filterExpense = localStorage.getItem('expenseFilter') || 'all';

    document.querySelectorAll('#filterDropdownIncome .filter-option').forEach(opt => {
        if(opt.dataset.filter === filterIncome) opt.classList.add('selected');
        else opt.classList.remove('selected');
    });
    document.querySelectorAll('#filterDropdownExpense .filter-option').forEach(opt => {
        if(opt.dataset.filter === filterExpense) opt.classList.add('selected');
        else opt.classList.remove('selected');
    });
}


function moveItem(event, type, index, direction) {
    event.stopPropagation();
    const arr = type === 'income' ? transactions.income : transactions.expenses;
    
    if (direction === 'up' && index > 0) {
        [arr[index], arr[index - 1]] = [arr[index - 1], arr[index]];
    } else if (direction === 'down' && index < arr.length - 1) {
        [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    }
    
    saveData();
    render();
}

function nextLoanPayment(event, type, index) {
    event.stopPropagation();
    const transactionList = type === 'income' ? transactions.income : transactions.expenses;
    const transaction = transactionList[index];
    
    if (transaction.type === 'loan' && transaction.loanCurrent < transaction.loanTotal) {
        transaction.loanCurrent++;
        saveData();

        // Update the DOM directly instead of re-rendering the whole list
        const wrapper = event.target.closest('.transaction-wrapper');
        if (wrapper) {
            const progressBarFill = wrapper.querySelector('.progress-bar-fill');
            const progressText = wrapper.querySelector('.progress-text');
            
            const percentage = (transaction.loanCurrent / transaction.loanTotal) * 100;
            const amountPaid = transaction.amount * transaction.loanCurrent;
            
            if(progressBarFill) {
                progressBarFill.style.width = `${percentage}%`;
            }
            if(progressText) {
                progressText.textContent = `${transaction.loanCurrent}/${transaction.loanTotal} (${percentage.toFixed(0)}%) · ₪${amountPaid.toLocaleString('he-IL')} שולמו`;
            }

            if (transaction.loanCurrent >= transaction.loanTotal) {
                const button = event.target.closest('button');
                if (button) {
                    button.disabled = true;
                    button.title = 'ההלוואה שולמה במלואה';
                    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                }
            }
        }
         updateLoansSummary();
    }
}

function toggleFilter(type) {
    const dropdown = document.getElementById(type === 'income' ? 'filterDropdownIncome' : 'filterDropdownExpense');
    const btn = document.getElementById(type === 'income' ? 'filterBtnIncome' : 'filterBtnExpense');
    
    dropdown.classList.toggle('active');
    btn.classList.toggle('active');
}

function setFilter(type, filter, shouldRender = true) {
    let dropdownId, btnId;
    if (type === 'income') {
        filterIncome = filter;
        dropdownId = 'filterDropdownIncome';
        btnId = 'filterBtnIncome';
    } else {
        filterExpense = filter;
        dropdownId = 'filterDropdownExpense';
        btnId = 'filterBtnExpense';
    }
    
// --- הוספה חדשה: נטרול מצב מיון בעת שינוי פילטר ---
    if (type === 'income' && sortModeIncome) {
        sortModeIncome = false;
        const btn = document.getElementById('sortBtnIncome');
        if (btn) btn.classList.remove('active');
    } else if (type === 'expense' && sortModeExpense) {
        sortModeExpense = false;
        const btn = document.getElementById('sortBtnExpense');
        if (btn) btn.classList.remove('active');
    }
    // --- סוף הוספה חדשה ---

    localStorage.setItem(`${type}Filter`, filter);

    const dropdown = document.getElementById(dropdownId);
    const btn = document.getElementById(btnId);
    if (dropdown) dropdown.classList.remove('active');
    if (btn) btn.classList.remove('active');
    
    document.querySelectorAll(`#${dropdownId} .filter-option`).forEach(opt => {
        opt.classList.remove('selected');
    });

    const selectedOption = document.querySelector(`#${dropdownId} [data-filter="${filter}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
    
    if (shouldRender) {
        render();
    }
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-container')) {
        const incomeDropdown = document.getElementById('filterDropdownIncome');
        const expenseDropdown = document.getElementById('filterDropdownExpense');
        if(incomeDropdown) incomeDropdown.classList.remove('active');
        if(expenseDropdown) expenseDropdown.classList.remove('active');

        const incomeBtn = document.getElementById('filterBtnIncome');
        const expenseBtn = document.getElementById('filterBtnExpense');
        if(incomeBtn) incomeBtn.classList.remove('active');
        if(expenseBtn) expenseBtn.classList.remove('active');
    }
});

function exportData() {
    const dataStr = JSON.stringify(transactions, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `budget-${new Date().toISOString().split('T')[0]}.json`;
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
                    transactions = imported;
                    saveData();
                    render();
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
    const data = type === 'income' ? transactions.income : transactions.expenses;
    
    if (data.length === 0) {
        openConfirmModal('מידע', 'אין נתונים להצגה בגרף.', closeConfirmModal);
        return;
    }

    const checkedData = data.filter(t => t.checked);
    if (checkedData.length === 0) {
        openConfirmModal('מידע', 'אין פריטים מסומנים להצגה בגרף.', closeConfirmModal);
        return;
    }

    const modal = document.getElementById('chartModal');
    const title = document.getElementById('chartModalTitle');
    
    title.textContent = type === 'income' ? 'התפלגות הכנסות' : 'התפלגות הוצאות';
    modal.classList.add('active');

    const labels = checkedData.map(t => t.description);
    const amounts = checkedData.map(t => t.amount);
    const colors = generateColors(checkedData.length);

    const ctx = document.getElementById('pieChart').getContext('2d');
    
    if (chartInstance) {
        chartInstance.destroy();
    }

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
                        font: {
                            size: 14
                        },
                        color: getComputedStyle(document.body).getPropertyValue('--text-primary')
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ₪${value.toLocaleString('he-IL')} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function generateColors(count) {
    const colors = [
        '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
        '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
    ];
    return colors.slice(0, count);
}

function closeChartModal() {
    document.getElementById('chartModal').classList.remove('active');
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
}

function deleteAllData() {
    const incomeCount = transactions.income.length;
    const expenseCount = transactions.expenses.length;
    const totalItems = incomeCount + expenseCount;

    if (totalItems === 0) {
        return;
    }

    const message = `אתה עומד למחוק את כל הנתונים לצמיתות.<br><br>` +
                  `<b>סה"כ למחיקה:</b><br>` +
                  `• ${incomeCount} הכנסות<br>` +
                  `• ${expenseCount} הוצאות<br><br>` +
                  `האם אתה בטוח שברצונך להמשיך?`;

    openConfirmModal('אישור מחיקת כל הנתונים', message, () => {
        transactions = {
            income: [],
            expenses: []
        };
        saveData();
        render();
        closeConfirmModal();
    });
}

function openModal(event, type, index = -1) {
    if (typeof event === 'string') {
        // Handle call from add button like openModal('income')
        type = event;
        index = -1;
    } else if (event) {
        // Handle call from edit button like openModal(event, 'income', i)
        event.stopPropagation();
    }
    
    currentType = type;
    editingIndex = index;
    
    const modal = document.getElementById('transactionModal');
    const title = document.getElementById('modalTitle');
    const descInput = document.getElementById('descriptionInput');
    const amountInput = document.getElementById('amountInput');
    const loanOriginalAmountInput = document.getElementById('loanOriginalAmountInput');
    const loanTotalInput = document.getElementById('loanTotalInput');
    const loanCurrentInput = document.getElementById('loanCurrentInput');
    const loanBtn = document.getElementById('typeLoan');
    const variableBtn = document.getElementById('typeVariable');

    if (type === 'income') {
        loanBtn.classList.add('disabled');
        loanBtn.title = 'הלוואה זמינה רק בהוצאות';
        variableBtn.classList.add('disabled');
        variableBtn.title = 'כרטיס אשראי זמין רק בהוצאות';
    } else {
        loanBtn.classList.remove('disabled');
        loanBtn.title = '';
        variableBtn.classList.remove('disabled');
        variableBtn.title = '';
    }

    if (index >= 0) {
        const transaction = type === 'income' ? transactions.income[index] : transactions.expenses[index];
        title.textContent = 'עריכת תנועה';
        descInput.value = transaction.description;
        amountInput.value = transaction.amount;
        selectTransactionType(transaction.type || 'regular');
        
        if (transaction.type === 'loan') {
            loanOriginalAmountInput.value = transaction.originalLoanAmount || '';
            loanTotalInput.value = transaction.loanTotal || '';
            loanCurrentInput.value = transaction.loanCurrent || '';
        }
    } else {
        title.textContent = type === 'income' ? 'הוספת הכנסה' : 'הוספת הוצאה';
        descInput.value = '';
        amountInput.value = '';
        loanOriginalAmountInput.value = '';
        loanTotalInput.value = '';
        loanCurrentInput.value = '';
        selectTransactionType('regular');
    }

    modal.classList.add('active');
    descInput.focus();
}

function closeModal() {
    document.getElementById('transactionModal').classList.remove('active');
}

function saveTransaction() {
    const description = document.getElementById('descriptionInput').value.trim();
    const amount = parseFloat(document.getElementById('amountInput').value); // This is now monthly amount

    if (!description || !amount || amount <= 0) {
        openConfirmModal('שגיאה', 'נא למלא תיאור וסכום חיובי.', closeConfirmModal);
        return;
    }

    const transaction = {
        id: Date.now(),
        description,
        amount,
        checked: true,
        type: selectedTransactionType
    };

    if (selectedTransactionType === 'loan') {
        const originalLoanAmount = parseFloat(document.getElementById('loanOriginalAmountInput').value);
        const loanTotal = parseInt(document.getElementById('loanTotalInput').value);
        const loanCurrent = parseInt(document.getElementById('loanCurrentInput').value);
        
        if (!originalLoanAmount || !loanTotal || Number.isNaN(loanCurrent) || originalLoanAmount <=0 || loanTotal < 1 || loanCurrent < 0 || loanCurrent > loanTotal) {
            openConfirmModal('שגיאה', 'נא למלא את כל פרטי ההלוואה באופן תקין.', closeConfirmModal);
            return;
        }

        if (amount > originalLoanAmount) {
            openConfirmModal('שגיאה', 'הסכום החודשי אינו יכול להיות גבוה מסכום ההלוואה המקורי.', closeConfirmModal);
            return;
        }
        
        transaction.originalLoanAmount = originalLoanAmount;
        transaction.loanTotal = loanTotal;
        transaction.loanCurrent = loanCurrent;
    }

    if (editingIndex >= 0) {
        if (currentType === 'income') {
            transactions.income[editingIndex] = { ...transactions.income[editingIndex], ...transaction };
        } else {
            transactions.expenses[editingIndex] = { ...transactions.expenses[editingIndex], ...transaction };
        }
    } else {
        if (currentType === 'income') {
            transactions.income.push(transaction);
        } else {
            transactions.expenses.push(transaction);
        }
    }

    saveData();
    render();
    closeModal();
}

function deleteTransaction(event, type, index) {
    event.stopPropagation();
    const transaction = type === 'income' ? transactions.income[index] : transactions.expenses[index];
    const message = `האם אתה בטוח שברצונך למחוק את התנועה?<br><br><b>"${transaction.description}"</b> בסך <b>₪${transaction.amount.toLocaleString('he-IL')}</b>`;

    openConfirmModal('אישור מחיקת תנועה', message, () => {
         if (type === 'income') {
            transactions.income.splice(index, 1);
        } else {
            transactions.expenses.splice(index, 1);
        }
        saveData();
        render();
        closeConfirmModal();
    });
}

function toggleCheck(event, type, index) {
    event.stopPropagation();
    if (type === 'income') {
        transactions.income[index].checked = !transactions.income[index].checked;
    } else {
        transactions.expenses[index].checked = !transactions.expenses[index].checked;
    }
    saveData();
    render();
}

function render() {
    let filteredIncome = transactions.income;
    if (filterIncome === 'active') {
        filteredIncome = transactions.income.filter(t => t.checked);
    } else if (filterIncome === 'inactive') {
        filteredIncome = transactions.income.filter(t => !t.checked);
    } else if (filterIncome !== 'all') {
        filteredIncome = transactions.income.filter(t => t.type === filterIncome);
    }
    
    const incomeList = document.getElementById('incomeList');
    incomeList.innerHTML = filteredIncome.length === 0 
        ? '<div class="empty-state">אין הכנסות להצגה</div>'
        : filteredIncome.map((t) => {
            const i = transactions.income.indexOf(t);
            let badgeClass, badgeText;
            if (t.type === 'loan') {
                badgeClass = 'badge-loan';
                badgeText = 'הלוואה';
            } else if (t.type === 'variable') {
                badgeClass = 'badge-variable';
                badgeText = 'כרטיס אשראי';
            } else if (t.type === 'onetime') {
                badgeClass = 'badge-onetime';
                badgeText = 'חד-פעמי';
            } else {
                badgeClass = 'badge-regular';
                badgeText = 'קבוע';
            }
            
            let loanDetails = '';
            if (t.type === 'loan' && t.originalLoanAmount) {
                loanDetails = `<div class="loan-original-amount">סכום הלוואה: ₪${t.originalLoanAmount.toLocaleString('he-IL')}</div>`;
            }
            
            let progressBar = '';
            if (t.type === 'loan' && t.loanTotal && typeof t.loanCurrent === 'number') {
                const percentage = (t.loanCurrent / t.loanTotal) * 100;
                const amountPaid = t.amount * t.loanCurrent;
                const isComplete = t.loanCurrent >= t.loanTotal;
                progressBar = `
                    <div class="loan-progress">
                        <div class="loan-progress-container">
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill" style="width: ${percentage}%"></div>
                            </div>
                            <div class="progress-text">${t.loanCurrent}/${t.loanTotal} (${percentage.toFixed(0)}%) · ₪${amountPaid.toLocaleString('he-IL')} שולמו</div>
                        </div>
                        <button class="loan-next-payment-btn" 
                                onclick="nextLoanPayment(event, 'income', ${i})"
                                ${isComplete ? 'disabled' : ''}
                                title="${isComplete ? 'ההלוואה שולמה במלואה' : 'הוסף תשלום'}">
                             ${isComplete 
                                 ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' 
                                 : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
                             }
                        </button>
                    </div>
                `;
            }

            let transactionIcon = '';
            if (t.type === 'variable') {
                transactionIcon = `<svg class="credit-card-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
            }

            const itemHTML = `
                <div class="transaction-info">
                    <div class="transaction-check ${t.checked ? 'checked' : ''}" 
                         onclick="toggleCheck(event, 'income', ${i})">
                         <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                     <div class="transaction-details">
                        <div class="transaction-text">
                            ${transactionIcon}
                            ${t.description}
                            <span class="transaction-badge ${badgeClass}">${badgeText}</span>
                        </div>
                        ${loanDetails}
                    </div>
                </div>
                <div class="transaction-amount">₪${t.amount.toLocaleString('he-IL', {minimumFractionDigits: 2})}</div>
                <div class="item-controls">
                    <div class="sort-buttons ${sortModeIncome ? 'visible' : ''}">
                        <button class="sort-btn" onclick="moveItem(event, 'income', ${i}, 'up')" ${i === 0 ? 'disabled' : ''} title="הזז למעלה"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
                        <button class="sort-btn" onclick="moveItem(event, 'income', ${i}, 'down')" ${i === transactions.income.length - 1 ? 'disabled' : ''} title="הזז למטה"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                    </div>
                    <div class="transaction-actions">
                        <button class="action-btn edit" onclick="openModal(event, 'income', ${i})" title="עריכה">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                        </button>
                        <button class="action-btn delete" onclick="deleteTransaction(event, 'income', ${i})" title="מחיקה">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </div>
            `;
            
            if (t.type === 'loan') {
                 return `
                 <div class="transaction-wrapper">
                    <div class="transaction-item loan-item ${!t.checked ? 'inactive' : ''}" onclick="toggleLoanProgress(this)">
                        ${itemHTML}
                    </div>
                    ${progressBar}
                </div>`;
            } else {
                return `
                <div class="transaction-wrapper">
                    <div class="transaction-item ${!t.checked ? 'inactive' : ''}">
                        ${itemHTML}
                    </div>
                </div>`;
            }
        }).join('');

    let filteredExpenses = transactions.expenses;
    if (filterExpense === 'active') {
        filteredExpenses = transactions.expenses.filter(t => t.checked);
    } else if (filterExpense === 'inactive') {
        filteredExpenses = transactions.expenses.filter(t => !t.checked);
    } else if (filterExpense !== 'all') {
        filteredExpenses = transactions.expenses.filter(t => t.type === filterExpense);
    }

    const expenseList = document.getElementById('expenseList');
    expenseList.innerHTML = filteredExpenses.length === 0
        ? '<div class="empty-state">אין הוצאות להצגה</div>'
        : filteredExpenses.map((t) => {
            const i = transactions.expenses.indexOf(t);
            let badgeClass, badgeText;
            if (t.type === 'loan') {
                badgeClass = 'badge-loan';
                badgeText = 'הלוואה';
            } else if (t.type === 'variable') {
                badgeClass = 'badge-variable';
                badgeText = 'כרטיס אשראי';
            } else if (t.type === 'onetime') {
                badgeClass = 'badge-onetime';
                badgeText = 'חד-פעמי';
            } else {
                badgeClass = 'badge-regular';
                badgeText = 'קבוע';
            }
            
            let loanDetails = '';
            if (t.type === 'loan' && t.originalLoanAmount) {
                loanDetails = `<div class="loan-original-amount">סכום הלוואה: ₪${t.originalLoanAmount.toLocaleString('he-IL')}</div>`;
            }
            
            let progressBar = '';
            if (t.type === 'loan' && t.loanTotal && typeof t.loanCurrent === 'number') {
                const percentage = (t.loanCurrent / t.loanTotal) * 100;
                const amountPaid = t.amount * t.loanCurrent;
                const isComplete = t.loanCurrent >= t.loanTotal;
                progressBar = `
                    <div class="loan-progress">
                        <div class="loan-progress-container">
                            <div class="progress-bar-container">
                                <div class="progress-bar-fill" style="width: ${percentage}%"></div>
                            </div>
                            <div class="progress-text">${t.loanCurrent}/${t.loanTotal} (${percentage.toFixed(0)}%) · ₪${amountPaid.toLocaleString('he-IL')} שולמו</div>
                        </div>
                        <button class="loan-next-payment-btn" 
                                onclick="nextLoanPayment(event, 'expense', ${i})"
                                ${isComplete ? 'disabled' : ''}
                                title="${isComplete ? 'ההלוואה שולמה במלואה' : 'הוסף תשלום'}">
                             ${isComplete 
                                 ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' 
                                 : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'
                             }
                        </button>
                    </div>
                `;
            }
            
            let transactionIcon = '';
            if (t.type === 'variable') {
                transactionIcon = `<svg class="credit-card-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;
            }

            const itemHTML = `
                <div class="transaction-info">
                    <div class="transaction-check ${t.checked ? 'checked' : ''}" 
                         onclick="toggleCheck(event, 'expense', ${i})">
                         <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </div>
                    <div class="transaction-details">
                        <div class="transaction-text">
                            ${transactionIcon}
                            ${t.description}
                            <span class="transaction-badge ${badgeClass}">${badgeText}</span>
                        </div>
                        ${loanDetails}
                    </div>
                </div>
                <div class="transaction-amount">₪${t.amount.toLocaleString('he-IL', {minimumFractionDigits: 2})}</div>
                <div class="item-controls">
                    <div class="sort-buttons ${sortModeExpense ? 'visible' : ''}">
                        <button class="sort-btn" onclick="moveItem(event, 'expense', ${i}, 'up')" ${i === 0 ? 'disabled' : ''} title="הזז למעלה"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
                        <button class="sort-btn" onclick="moveItem(event, 'expense', ${i}, 'down')" ${i === transactions.expenses.length - 1 ? 'disabled' : ''} title="הזז למטה"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                    </div>
                    <div class="transaction-actions">
                       <button class="action-btn edit" onclick="openModal(event, 'expense', ${i})" title="עריכה">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                        </button>
                        <button class="action-btn delete" onclick="deleteTransaction(event, 'expense', ${i})" title="מחיקה">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </div>
            `;
            
            if (t.type === 'loan') {
                 return `
                 <div class="transaction-wrapper">
                    <div class="transaction-item loan-item ${!t.checked ? 'inactive' : ''}" onclick="toggleLoanProgress(this)">
                        ${itemHTML}
                    </div>
                    ${progressBar}
                </div>`;
            } else {
                return `
                <div class="transaction-wrapper">
                    <div class="transaction-item ${!t.checked ? 'inactive' : ''}">
                        ${itemHTML}
                    </div>
                </div>`;
            }
        }).join('');

    const incomeTotal = filteredIncome.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = filteredExpenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const finalBalance = (currentBalanceValue || 0) - expenseTotal + incomeTotal;

    // --- Summary for Expanded View Footer (uses filtered totals) ---
    let incomeLabelText = 'סה״כ הכנסות';
    switch (filterIncome) {
        case 'regular': incomeLabelText = 'סה״כ קבועות'; break;
        case 'variable': incomeLabelText = 'סה״כ כ.אשראי'; break;
        case 'onetime': incomeLabelText = 'סה״כ חד-פעמיות'; break;
        case 'active': incomeLabelText = 'סה״כ פעילות'; break;
        case 'inactive': incomeLabelText = 'סה״כ לא פעילות'; break;
    }
    document.getElementById('incomeTotalLabel').textContent = incomeLabelText;

    let expenseLabelText = 'סה״כ הוצאות';
    switch (filterExpense) {
        case 'regular': expenseLabelText = 'סה״כ קבועות'; break;
        case 'variable': expenseLabelText = 'סה״כ כ.אשראי'; break;
        case 'onetime': expenseLabelText = 'סה״כ חד-פעמיות'; break;
        case 'loan': expenseLabelText = 'סה״כ הלוואות'; break;
        case 'active': expenseLabelText = 'סה״כ פעילות'; break;
        case 'inactive': expenseLabelText = 'סה״כ לא פעילות'; break;
    }
    document.getElementById('expenseTotalLabel').textContent = expenseLabelText;

    // --- Summary for Collapsed View (always shows total of *active* items, ignoring filters) ---
    const totalActiveIncome = transactions.income
        .filter(t => t.checked)
        .reduce((sum, t) => sum + t.amount, 0);

    const totalActiveExpenses = transactions.expenses
        .filter(t => t.checked)
        .reduce((sum, t) => sum + t.amount, 0);

    document.getElementById('incomeCollapsedSummary').innerHTML = `<span class="summary-label">סה״כ הכנסות:</span> <span class="summary-value">₪${totalActiveIncome.toLocaleString('he-IL', {minimumFractionDigits: 2})}</span>`;
    document.getElementById('expenseCollapsedSummary').innerHTML = `<span class="summary-label">סה״כ הוצאות:</span> <span class="summary-value">₪${totalActiveExpenses.toLocaleString('he-IL', {minimumFractionDigits: 2})}</span>`;
    
    const finalBalanceValueString = `₪${finalBalance.toLocaleString('he-IL', {minimumFractionDigits: 2})}`;
    const finalBalanceClass = finalBalance >= 0 ? 'positive' : 'negative';
    document.getElementById('summaryCollapsedSummary').innerHTML = `<span class="summary-label">עו"ש צפוי:</span> <span class="summary-value ${finalBalanceClass}">${finalBalanceValueString}</span>`;


    document.getElementById('incomeTotal').textContent = 
        '₪' + incomeTotal.toLocaleString('he-IL', {minimumFractionDigits: 2});
    document.getElementById('expenseTotal').textContent = 
        '₪' + expenseTotal.toLocaleString('he-IL', {minimumFractionDigits: 2});
    
    const incomeChartBtn = document.querySelector('.income-card .chart-btn');
    const incomeSortBtn = document.querySelector('.income-card .sort-mode-btn');
    const expenseChartBtn = document.querySelector('.expense-card .chart-btn');
    const expenseSortBtn = document.querySelector('.expense-card .sort-mode-btn');

    if (filterIncome !== 'all') {
        incomeChartBtn.disabled = true;
        incomeSortBtn.disabled = true;
        incomeChartBtn.title = "האפשרות זמינה רק במצב 'הצג הכל'";
        incomeSortBtn.title = "האפשרות זמינה רק במצב 'הצג הכל'";
    } else {
        incomeChartBtn.disabled = false;
        incomeSortBtn.disabled = false;
        incomeChartBtn.title = "הצג גרף";
        incomeSortBtn.title = "סידור";
    }

    if (filterExpense !== 'all') {
        expenseChartBtn.disabled = true;
        expenseSortBtn.disabled = true;
        expenseChartBtn.title = "האפשרות זמינה רק במצב 'הצג הכל'";
        expenseSortBtn.title = "האפשרות זמינה רק במצב 'הצג הכל'";
    } else {
        expenseChartBtn.disabled = false;
        expenseSortBtn.disabled = false;
        expenseChartBtn.title = "הצג גרף";
        expenseSortBtn.title = "סידור";
    }
    
    updateBalanceIndicator();
    updateLoansSummary();
    updateSummary();
}

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadData();
    loadCardStates();

    document.querySelectorAll('.filter-option').forEach(option => {
        option.addEventListener('click', (e) => {
            const dropdown = e.target.closest('.filter-dropdown');
            const type = dropdown.id.includes('Income') ? 'income' : 'expense';
            const filter = e.target.closest('.filter-option').dataset.filter;
            setFilter(type, filter);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeChartModal();
            closeConfirmModal();
        }
    });

    document.getElementById('transactionModal').addEventListener('click', (e) => {
        if (e.target.id === 'transactionModal') closeModal();
    });

    document.getElementById('chartModal').addEventListener('click', (e) => {
        if (e.target.id === 'chartModal') closeChartModal();
    });

    document.getElementById('confirmModal').addEventListener('click', (e) => {
        if (e.target.id === 'confirmModal') closeConfirmModal();
    });
});


function openConfirmModal(title, text, onConfirm) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalText').innerHTML = text; 
    
    const confirmBtn = document.getElementById('confirmModalConfirmBtn');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    
    newConfirmBtn.addEventListener('click', onConfirm);
    
    if (title === 'שגיאה' || title === 'מידע') {
         newConfirmBtn.style.display = 'none';
         document.querySelector('#confirmModal .modal-btn-cancel').textContent = 'סגור';
    } else {
         newConfirmBtn.style.display = 'flex';
         newConfirmBtn.textContent = 'אשר';
         document.querySelector('#confirmModal .modal-btn-cancel').textContent = 'ביטול';
    }

    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

function toggleCard(button, cardName) {
    const card = button.closest('.card');
    card.classList.toggle('is-collapsed');
    button.classList.toggle('collapsed');

    if (card.classList.contains('is-collapsed')) {
        localStorage.setItem(cardName + 'CardState', 'collapsed');
    } else {
        localStorage.setItem(cardName + 'CardState', 'expanded');
    }
}

function loadCardStates() {
    const cards = ['income', 'expense', 'loansSummary', 'summary'];
    cards.forEach(cardName => {
        const savedState = localStorage.getItem(cardName + 'CardState');
        if (savedState === 'collapsed') {
            const card = document.querySelector('.'+cardName.replace('Summary', '-summary')+'-card');
            const button = card.querySelector('.collapse-btn');
            if (card) card.classList.add('is-collapsed');
            if (button) button.classList.add('collapsed');
        }
    });
}