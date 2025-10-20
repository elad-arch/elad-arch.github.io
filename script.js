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

    input.classList.remove('positive-balance', 'negative-balance');
    if (currentBalanceValue > 0) {
        input.classList.add('positive-balance');
    } else if (currentBalanceValue < 0) {
        input.classList.add('negative-balance');
    }
    
    const incomeTotal = transactions.income.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = transactions.expenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    
    const balanceAfterExpenses = currentBalanceValue - expenseTotal;
    const finalBalance = balanceAfterExpenses + incomeTotal;
    
    const afterExpensesEl = document.getElementById('balanceAfterExpenses');
    afterExpensesEl.textContent = '₪' + balanceAfterExpenses.toLocaleString('he-IL', {minimumFractionDigits: 2});
    afterExpensesEl.className = 'summary-block-value ' + (balanceAfterExpenses >= 0 ? 'positive' : 'negative');
    
    const finalBalanceEl = document.getElementById('finalBalance');
    finalBalanceEl.textContent = '₪' + finalBalance.toLocaleString('he-IL', {minimumFractionDigits: 2});
    finalBalanceEl.className = 'summary-block-value ' + (finalBalance >= 0 ? 'positive' : 'negative');
    
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
    const totalIncome = transactions.income.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const totalExpenses = transactions.expenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);

    titleElement.classList.remove('title-positive-balance', 'title-negative-balance');
    if (totalIncome > totalExpenses) {
        titleElement.classList.add('title-positive-balance');
    } else if (totalExpenses > totalIncome) {
        titleElement.classList.add('title-negative-balance');
    }

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

        const wrapper = event.target.closest('.transaction-wrapper');
        if (wrapper) {
            const progressBarFill = wrapper.querySelector('.progress-bar-fill');
            const progressText = wrapper.querySelector('.progress-text');
            
            const percentage = (transaction.loanCurrent / transaction.loanTotal) * 100;
            const amountPaid = transaction.amount * transaction.loanCurrent;
            
            if(progressBarFill) progressBarFill.style.width = `${percentage}%`;
            if(progressText) progressText.textContent = `${transaction.loanCurrent}/${transaction.loanTotal} (${percentage.toFixed(0)}%) · ₪${amountPaid.toLocaleString('he-IL')} שולמו`;

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
    dropdown.classList.toggle('active');
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

document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-container')) {
        document.getElementById('filterDropdownIncome').classList.remove('active');
        document.getElementById('filterDropdownExpense').classList.remove('active');
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
    const checkedData = data.filter(t => t.checked);

    if (checkedData.length === 0) {
        const message = data.length === 0 ? 'אין נתונים להצגה בגרף.' : 'אין פריטים מסומנים להצגה בגרף.';
        openConfirmModal('מידע', message, closeConfirmModal);
        return;
    }

    const modal = document.getElementById('chartModal');
    document.getElementById('chartModalTitle').textContent = type === 'income' ? 'התפלגות הכנסות' : 'התפלגות הוצאות';
    modal.classList.add('active');

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
                legend: { position: 'bottom', labels: { padding: 15, font: { size: 14 }, color: getComputedStyle(document.body).getPropertyValue('--text-primary') }},
                tooltip: { callbacks: { label: function(context) {
                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                    const percentage = ((context.parsed / total) * 100).toFixed(1);
                    return `${context.label}: ₪${context.parsed.toLocaleString('he-IL')} (${percentage}%)`;
                }}}
            }
        }
    });
}

function generateColors(count) {
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'];
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

    if (incomeCount + expenseCount === 0) return;

    const message = `אתה עומד למחוק <b>${incomeCount} הכנסות</b> ו-<b>${expenseCount} הוצאות</b> לצמיתות. האם להמשיך?`;
    openConfirmModal('אישור מחיקת כל הנתונים', message, () => {
        transactions = { income: [], expenses: [] };
        saveData();
        render();
        closeConfirmModal();
    });
}

function openModal(event, type, index = -1) {
    if (typeof event === 'string') {
        type = event;
    } else if (event) {
        event.stopPropagation();
    }
    
    currentType = type;
    editingIndex = index;
    
    const modal = document.getElementById('transactionModal');
    const title = document.getElementById('modalTitle');
    
    const descriptionInput = document.getElementById('descriptionInput');
    const amountInput = document.getElementById('amountInput');
    const loanOriginalAmountInput = document.getElementById('loanOriginalAmountInput');
    const loanTotalInput = document.getElementById('loanTotalInput');
    const loanCurrentInput = document.getElementById('loanCurrentInput');

    document.getElementById('typeLoan').classList.toggle('disabled', type === 'income');
    document.getElementById('typeVariable').classList.toggle('disabled', type === 'income');

    if (index >= 0) {
        const transaction = type === 'income' ? transactions.income[index] : transactions.expenses[index];
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
        
        if (!originalLoanAmount || !loanTotal || isNaN(loanCurrent) || originalLoanAmount <=0 || loanTotal < 1 || loanCurrent < 0 || loanCurrent > loanTotal || amount > originalLoanAmount) {
            openConfirmModal('שגיאה', 'נא למלא את כל פרטי ההלוואה באופן תקין.', closeConfirmModal);
            return;
        }
        
        transaction.originalLoanAmount = originalLoanAmount;
        transaction.loanTotal = loanTotal;
        transaction.loanCurrent = loanCurrent;
    }

    const list = currentType === 'income' ? transactions.income : transactions.expenses;
    if (editingIndex >= 0) {
        list[editingIndex] = { ...list[editingIndex], ...transaction };
    } else {
        list.push(transaction);
    }

    saveData();
    render();
    closeModal();
}

function deleteTransaction(event, type, index) {
    event.stopPropagation();
    const transaction = type === 'income' ? transactions.income[index] : transactions.expenses[index];
    const message = `האם למחוק את <b>"${transaction.description}"</b> בסך <b>₪${transaction.amount.toLocaleString('he-IL')}</b>?`;

    openConfirmModal('אישור מחיקת תנועה', message, () => {
         if (type === 'income') transactions.income.splice(index, 1);
         else transactions.expenses.splice(index, 1);
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

let currentEditingElement = null;

function editAmount(event, type, index) {
    event.stopPropagation();
    if (currentEditingElement) currentEditingElement.querySelector('.inline-edit-input').blur();

    const amountWrapper = event.currentTarget;
    const amountInput = amountWrapper.querySelector('.inline-edit-input');
    const transaction = (type === 'income') ? transactions.income[index] : transactions.expenses[index];

    currentEditingElement = amountWrapper;
    amountWrapper.classList.add('editing');
    amountInput.value = transaction.amount;
    amountInput.focus();
    amountInput.select();
}

function saveAmount(event, type, index) {
    const input = event.target;
    const newAmount = parseFloat(input.value);
    
    if (currentEditingElement) {
       currentEditingElement.classList.remove('editing');
       currentEditingElement = null;
    }

    if (!isNaN(newAmount) && newAmount >= 0) {
        if (type === 'income') transactions.income[index].amount = newAmount;
        else transactions.expenses[index].amount = newAmount;
    }
    
    saveData();
    render();
}

function handleEditKeys(event) {
    if (event.key === 'Enter') event.target.blur();
    else if (event.key === 'Escape') {
        event.target.value = -1; // Invalidate to prevent saving on blur
        event.target.blur();
    }
}

function openApplyOptionsModal(type, index) {
    const transaction = (type === 'income') ? transactions.income[index] : transactions.expenses[index];
    const modal = document.getElementById('applyOptionsModal');
    const infoDiv = document.getElementById('applyOptionsTransactionInfo');

    infoDiv.innerHTML = `<span>${transaction.description}</span><span class="${type === 'income' ? 'positive' : 'negative'}">₪${transaction.amount.toLocaleString('he-IL')}</span>`;
    
    modal.querySelectorAll('.apply-option').forEach(option => {
        const newOption = option.cloneNode(true);
        option.parentNode.replaceChild(newOption, option);
        newOption.addEventListener('click', () => handleApplyAction(type, index, newOption.dataset.action));
    });

    modal.classList.add('active');
}

function handleApplyAction(type, index, action) {
    const transaction = (type === 'income') ? transactions.income[index] : transactions.expenses[index];
    const amount = transaction.amount;

    if (type === 'income') currentBalanceValue += amount;
    else currentBalanceValue -= amount;
    document.getElementById('currentBalanceInput').value = currentBalanceValue;
    
    if (action === 'apply-delete') {
        if (type === 'income') transactions.income.splice(index, 1);
        else transactions.expenses.splice(index, 1);
    } else if (action === 'apply-zero') {
        if (type === 'income') transactions.income[index].amount = 0;
        else transactions.expenses[index].amount = 0;
    }

    saveData();
    render();
    closeApplyOptionsModal();
}

function closeApplyOptionsModal() {
    document.getElementById('applyOptionsModal').classList.remove('active');
}

function render() {
    let filteredIncome = transactions.income;
    if (filterIncome !== 'all') {
        if (filterIncome === 'active') filteredIncome = transactions.income.filter(t => t.checked);
        else if (filterIncome === 'inactive') filteredIncome = transactions.income.filter(t => !t.checked);
        else filteredIncome = transactions.income.filter(t => t.type === filterIncome);
    }
    
    const incomeList = document.getElementById('incomeList');
    incomeList.innerHTML = filteredIncome.length === 0 
        ? '<div class="empty-state">אין הכנסות להצגה</div>'
        : filteredIncome.map((t) => {
            const i = transactions.income.indexOf(t);
            let badgeClass = 'badge-regular', badgeText = 'קבוע';
            if (t.type === 'variable') { badgeClass = 'badge-variable'; badgeText = 'כרטיס אשראי'; }
            else if (t.type === 'onetime') { badgeClass = 'badge-onetime'; badgeText = 'חד-פעמי'; }
            
            const transactionIcon = t.type === 'variable' ? `<svg class="credit-card-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>` : '';

            return `
            <div class="transaction-wrapper">
                <div class="transaction-item ${!t.checked ? 'inactive' : ''}">
                    <div class="transaction-info">
                        <div class="transaction-check ${t.checked ? 'checked' : ''}" onclick="toggleCheck(event, 'income', ${i})">
                             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                         <div class="transaction-details">
                            <div class="transaction-text">${transactionIcon} ${t.description} <span class="transaction-badge ${badgeClass}">${badgeText}</span></div>
                        </div>
                    </div>
                    <div class="transaction-amount" onclick="editAmount(event, 'income', ${i})">
                        <span class="amount-text">₪${t.amount.toLocaleString('he-IL', {minimumFractionDigits: 2})}</span>
                        <input type="number" class="inline-edit-input" step="0.01" onkeydown="handleEditKeys(event)" onblur="saveAmount(event, 'income', ${i})">
                    </div>
                    <div class="item-controls">
                        <div class="sort-buttons ${sortModeIncome ? 'visible' : ''}">
                            <button class="sort-btn" onclick="moveItem(event, 'income', ${i}, 'up')" ${i === 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
                            <button class="sort-btn" onclick="moveItem(event, 'income', ${i}, 'down')" ${i === transactions.income.length - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                        </div>
                        <div class="transaction-actions">
                            <button class="action-btn edit" onclick="openModal(event, 'income', ${i})" title="עריכה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
                            <button class="action-btn apply" onclick="openApplyOptionsModal('income', ${i})" title="החל על היתרה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></button>
                            <button class="action-btn delete" onclick="deleteTransaction(event, 'income', ${i})" title="מחיקה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                        </div>
                    </div>
                </div>
            </div>`;
        }).join('');

    let filteredExpenses = transactions.expenses;
    if (filterExpense !== 'all') {
        if (filterExpense === 'active') filteredExpenses = transactions.expenses.filter(t => t.checked);
        else if (filterExpense === 'inactive') filteredExpenses = transactions.expenses.filter(t => !t.checked);
        else filteredExpenses = transactions.expenses.filter(t => t.type === filterExpense);
    }

    const expenseList = document.getElementById('expenseList');
    expenseList.innerHTML = filteredExpenses.length === 0
        ? '<div class="empty-state">אין הוצאות להצגה</div>'
        : filteredExpenses.map((t) => {
            const i = transactions.expenses.indexOf(t);
            let badgeClass = 'badge-regular', badgeText = 'קבוע';
            if (t.type === 'loan') { badgeClass = 'badge-loan'; badgeText = 'הלוואה'; }
            else if (t.type === 'variable') { badgeClass = 'badge-variable'; badgeText = 'כרטיס/י אשראי'; }
            else if (t.type === 'onetime') { badgeClass = 'badge-onetime'; badgeText = 'חד-פעמי'; }
            
            const transactionIcon = t.type === 'variable' ? `<svg class="credit-card-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>` : '';
            const loanDetails = (t.type === 'loan' && t.originalLoanAmount) ? `<div class="loan-original-amount">סכום הלוואה: ₪${t.originalLoanAmount.toLocaleString('he-IL')}</div>` : '';

            let progressBar = '';
            if (t.type === 'loan' && t.loanTotal) {
                const percentage = (t.loanCurrent / t.loanTotal) * 100;
                const amountPaid = t.amount * t.loanCurrent;
                const isComplete = t.loanCurrent >= t.loanTotal;
                progressBar = `
                    <div class="loan-progress">
                        <div class="loan-progress-container">
                            <div class="progress-bar-container"><div class="progress-bar-fill" style="width: ${percentage}%"></div></div>
                            <div class="progress-text">${t.loanCurrent}/${t.loanTotal} (${percentage.toFixed(0)}%) · ₪${amountPaid.toLocaleString('he-IL')} שולמו</div>
                        </div>
                        <button class="loan-next-payment-btn" onclick="nextLoanPayment(event, 'expense', ${i})" ${isComplete ? 'disabled' : ''}>
                             ${isComplete ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>'}
                        </button>
                    </div>`;
            }

            const itemHTML = `
                <div class="transaction-item ${t.type === 'loan' ? 'loan-item' : ''} ${!t.checked ? 'inactive' : ''}" ${t.type === 'loan' ? `onclick="toggleLoanProgress(this)"` : ''}>
                    <div class="transaction-info">
                        <div class="transaction-check ${t.checked ? 'checked' : ''}" onclick="toggleCheck(event, 'expense', ${i})">
                             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </div>
                        <div class="transaction-details">
                            <div class="transaction-text">${transactionIcon} ${t.description} <span class="transaction-badge ${badgeClass}">${badgeText}</span></div>
                            ${loanDetails}
                        </div>
                    </div>
                    <div class="transaction-amount" onclick="editAmount(event, 'expense', ${i})">
                        <span class="amount-text">₪${t.amount.toLocaleString('he-IL', {minimumFractionDigits: 2})}</span>
                        <input type="number" class="inline-edit-input" step="0.01" onkeydown="handleEditKeys(event)" onblur="saveAmount(event, 'expense', ${i})">
                    </div>
                    <div class="item-controls">
                        <div class="sort-buttons ${sortModeExpense ? 'visible' : ''}">
                            <button class="sort-btn" onclick="moveItem(event, 'expense', ${i}, 'up')" ${i === 0 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg></button>
                            <button class="sort-btn" onclick="moveItem(event, 'expense', ${i}, 'down')" ${i === transactions.expenses.length - 1 ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
                        </div>
                        <div class="transaction-actions">
                            <button class="action-btn edit" onclick="openModal(event, 'expense', ${i})" title="עריכה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg></button>
                            <button class="action-btn apply" onclick="openApplyOptionsModal('expense', ${i})" title="החל על היתרה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg></button>
                            <button class="action-btn delete" onclick="deleteTransaction(event, 'expense', ${i})" title="מחיקה"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                        </div>
                    </div>
                </div>`;
            return `<div class="transaction-wrapper">${itemHTML}${progressBar}</div>`;
        }).join('');

    const incomeTotal = filteredIncome.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const expenseTotal = filteredExpenses.reduce((sum, t) => sum + (t.checked ? t.amount : 0), 0);
    const finalBalance = (currentBalanceValue || 0) - expenseTotal + incomeTotal;

    const labelMap = { all: 'סה״כ', regular: 'סה״כ קבועות', variable: 'סה״כ כ.אשראי', onetime: 'סה״כ חד-פעמיות', active: 'סה״כ פעילות', inactive: 'סה״כ לא פעילות', loan: 'סה״כ הלוואות' };
    document.getElementById('incomeTotalLabel').textContent = filterIncome === 'all' ? 'סה״כ הכנסות' : labelMap[filterIncome];
    document.getElementById('expenseTotalLabel').textContent = filterExpense === 'all' ? 'סה״כ הוצאות' : labelMap[filterExpense];

    const totalActiveIncome = transactions.income.filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);
    const totalActiveExpenses = transactions.expenses.filter(t => t.checked).reduce((sum, t) => sum + t.amount, 0);

    document.getElementById('incomeCollapsedSummary').innerHTML = `<span class="summary-label">סה״כ הכנסות:</span> <span class="summary-value">₪${totalActiveIncome.toLocaleString('he-IL', {minimumFractionDigits: 2})}</span>`;
    document.getElementById('expenseCollapsedSummary').innerHTML = `<span class="summary-label">סה״כ הוצאות:</span> <span class="summary-value">₪${totalActiveExpenses.toLocaleString('he-IL', {minimumFractionDigits: 2})}</span>`;
    document.getElementById('summaryCollapsedSummary').innerHTML = `<span class="summary-label">עו"ש צפוי:</span> <span class="summary-value ${finalBalance >= 0 ? 'positive' : 'negative'}">₪${finalBalance.toLocaleString('he-IL', {minimumFractionDigits: 2})}</span>`;

    document.getElementById('incomeTotal').textContent = '₪' + incomeTotal.toLocaleString('he-IL', {minimumFractionDigits: 2});
    document.getElementById('expenseTotal').textContent = '₪' + expenseTotal.toLocaleString('he-IL', {minimumFractionDigits: 2});
    
    document.querySelector('.income-card .chart-btn').disabled = filterIncome !== 'all';
    document.querySelector('.income-card .sort-mode-btn').disabled = filterIncome !== 'all';
    document.querySelector('.expense-card .chart-btn').disabled = filterExpense !== 'all';
    document.querySelector('.expense-card .sort-mode-btn').disabled = filterExpense !== 'all';
    
    updateBalanceIndicator();
    updateLoansSummary();
    updateSummary();
}

document.addEventListener('DOMContentLoaded', () => {
    loadTheme();
    loadData();
    loadCardStates();
    setupBalanceControls();

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
            closeApplyOptionsModal();
        }
    });

    document.getElementById('transactionModal').addEventListener('click', (e) => { if (e.target.id === 'transactionModal') closeModal(); });
    document.getElementById('chartModal').addEventListener('click', (e) => { if (e.target.id === 'chartModal') closeChartModal(); });
    document.getElementById('confirmModal').addEventListener('click', (e) => { if (e.target.id === 'confirmModal') closeConfirmModal(); });
    document.getElementById('applyOptionsModal').addEventListener('click', (e) => { if (e.target.id === 'applyOptionsModal') closeApplyOptionsModal(); });
});

function openConfirmModal(title, text, onConfirm) {
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalText').innerHTML = text; 
    
    const confirmBtn = document.getElementById('confirmModalConfirmBtn');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.addEventListener('click', onConfirm);
    
    const isInfo = title === 'שגיאה' || title === 'מידע';
    newConfirmBtn.style.display = isInfo ? 'none' : 'flex';
    document.querySelector('#confirmModal .modal-btn-cancel').textContent = isInfo ? 'סגור' : 'ביטול';

    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
}

function setupBalanceControls() {
    let currentStep = 100;
    const balanceInput = document.getElementById('currentBalanceInput');
    const incrementBtn = document.getElementById('incrementBtn');
    const decrementBtn = document.getElementById('decrementBtn');
    const stepSelector = document.getElementById('balanceStepSelector');

    function updateBalance(amount) {
        let currentValue = parseFloat(balanceInput.value) || 0;
        balanceInput.value = currentValue + amount;
        updateSummary();
    }

    incrementBtn.addEventListener('click', () => updateBalance(currentStep));
    decrementBtn.addEventListener('click', () => updateBalance(-currentStep));

    stepSelector.addEventListener('click', (e) => {
        if (e.target.classList.contains('step-btn')) {
            stepSelector.querySelector('.active').classList.remove('active');
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
            const card = document.querySelector('.'+cardName.replace('Summary', '-summary')+'-card');
            if (card) {
                card.classList.add('is-collapsed');
                card.querySelector('.collapse-btn').classList.add('collapsed');
            }
        }
    });
}