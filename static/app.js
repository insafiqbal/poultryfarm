// --- State & Constants ---
const API_BASE = '/api';

// Global Helper for Robust Numeric Parsing (moved to top for accessibility)
// Global Helper for Robust Numeric Parsing (moved to top for accessibility)
window.cleanNum = function (val) {
    if (!val) return 0;
    let str = String(val).replace(/[^0-9.-]/g, '');
    return parseFloat(str) || 0;
};

// Global Settlement Balance Calculator
window.updateSettleBalance = function () {
    const total = window.cleanNum(document.getElementById('settleTotalSalary').value);
    const advances = window.cleanNum(document.getElementById('settleAdvances').value);
    const balance = total - advances;
    const balEl = document.getElementById('settleBalance');
    if (balEl) balEl.textContent = balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Global Settlement Balance Calculator (moved to top for accessibility)


document.addEventListener('DOMContentLoaded', () => {
    // --- State & Constants ---
    const API_BASE = '/api';
    let categories = []; // Dynamic
    // const CATEGORIES = []; // Removed hardcoded list

    let currentBatch = null;
    let currentCategory = '';
    let currentExpenses = []; // Store for access
    let currentSales = [];
    let editingExpenseId = null;
    let editingSaleId = null;
    let editingWorkerId = null;
    let currentWorkers = [];
    let saveTimeout = null; // Estimator auto-save timeout
    const deleteBatchCooldowns = {}; // Store expiry timestamps per batchId
    let editingDepositId = null;
    let currentDeposits = [];

    // --- DOM Elements ---
    const navBatches = document.getElementById('navBatches');
    const navContribution = document.getElementById('navContribution');
    const navWorkers = document.getElementById('navWorkers');

    // --- Hoisted Logic for Manage Funds ---
    window.loadOpeningBalances = async function () {
        if (!currentBatch) return;
        const setV = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

        // Reset
        setV('obs_Date', '');
        ['Farm', 'Kaleel', 'Iqbal', 'Farhan'].forEach(k => {
            setV(`obs_${k}`, '');
            setV(`obs_Ref_${k}`, '');
        });

        try {
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}`);
            const data = await res.json();

            // Prefer New Data Structure
            if (data.opening_balance_data) {
                const d = data.opening_balance_data;
                if (d.date) setV('obs_Date', d.date);

                if (Array.isArray(d.items)) {
                    d.items.forEach(item => {
                        setV(`obs_${item.provider}`, item.amount);
                        setV(`obs_Ref_${item.provider}`, item.ref || '');
                    });
                }
            }
            // Fallback
            else if (data.opening_balance_breakdown) {
                const b = data.opening_balance_breakdown;
                setV('obs_Farm', b.Farm || '');
                setV('obs_Kaleel', b.Kaleel || '');
                setV('obs_Iqbal', b.Iqbal || '');
                setV('obs_Farhan', b.Farhan || '');
            }
        } catch (e) { console.error(e); }
    };

    window.saveOpeningBalanceModal = async function () {
        const dateVal = document.getElementById('obs_Date').value;
        const providers = ['Farm', 'Kaleel', 'Iqbal', 'Farhan'];

        let items = [];
        let hasNegative = false;

        providers.forEach(p => {
            const amt = cleanNum(document.getElementById(`obs_${p}`).value);
            const ref = document.getElementById(`obs_Ref_${p}`).value || '';
            if (amt < 0) hasNegative = true;
            items.push({ provider: p, amount: amt, ref: ref });
        });

        if (hasNegative) return alert('Cannot enter negative amounts');

        const payload = {
            opening_balance_payload: {
                date: dateVal,
                items: items
            }
        };

        try {
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const updated = await res.json();
                currentBatch = updated;
                alert('Opening balances updated successfully');
                loadBalance();
                if (typeof loadDepositsTable === 'function') loadDepositsTable();
            } else { alert('Failed to update opening balances'); }
        } catch (e) { console.error(e); alert('Update error'); }
    };

    window.deleteDeposit = async function (id) {
        if (!confirm('Remove this deposit?')) return;
        try {
            const res = await fetch(`${API_BASE}/deposits/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadBalance();
                if (typeof loadDepositsTable === 'function') loadDepositsTable();
            }
        } catch (e) { console.error(e); }
    };

    window.openManageFundsModal = async function () {
        if (!currentBatch) return alert('No batch selected');
        const m = document.getElementById('manageFundsModal');
        if (typeof loadOpeningBalances === 'function') await loadOpeningBalances();

        // Reset Edit State
        editingDepositId = null;
        document.getElementById('depositModalSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Add Deposit';

        const safeVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        safeVal('modalDepositRef', '');
        safeVal('modalDepositBy', 'Kaleel');
        safeVal('modalDepositDate', new Date().toISOString().split('T')[0]);
        safeVal('modalDepositAmount', '');
        safeVal('modalDepositDesc', '');

        showModal(m);
        if (typeof loadDepositsTable === 'function') loadDepositsTable();
    };

    window.editDeposit = function (id) {
        const deposit = currentDeposits.find(d => d.id === id);
        if (!deposit) return;

        editingDepositId = id;
        document.getElementById('depositModalSubmitBtn').innerHTML = '<i class="fa-solid fa-save"></i> Update Deposit';

        const safeVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        safeVal('modalDepositRef', deposit.ref_no || '');
        safeVal('modalDepositBy', deposit.deposited_by || 'Kaleel');
        safeVal('modalDepositDate', deposit.date);
        safeVal('modalDepositAmount', deposit.amount);
        safeVal('modalDepositDesc', deposit.description || '');

        // Scroll to form
        const formSection = document.getElementById('manageFundsModal').querySelector('.fund-section:nth-child(4)'); // Rough guess, better to rely on user scrolling or minimal scroll
        // Ideally just show modal (it is already open usually if clicking edit from table inside modal?)
        // The table IS inside the modal. So we just need to scroll up to the form.
        document.getElementById('manageFundsModal').querySelector('.modal-content').scrollTop = 0;
    };

    // Views
    const batchesView = document.getElementById('batchesView');
    const batchDetailView = document.getElementById('batchDetailView');
    const workersView = document.getElementById('workersView');

    const contributionView = document.getElementById('contributionView');

    function switchView(viewName) {
        // 1. Hide ALL views
        batchesView.classList.add('hidden');
        batchDetailView.classList.add('hidden');
        workersView.classList.add('hidden');
        if (contributionView) contributionView.classList.add('hidden');

        // Fix: Hide floating subviews (Profit, Sales, Balance, Estimator) and Settings
        // These are currently outside batchDetailView in DOM, so we must hide them manually
        ['subview-sales', 'subview-profit', 'subview-balance', 'subview-estimator', 'settingsView'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });

        // 2. Deactivate ALL nav buttons
        navBatches.classList.remove('active');
        navContribution.classList.remove('active');
        navWorkers.classList.remove('active');

        // 3. Show requested view
        if (viewName === 'batches') {
            navBatches.classList.add('active');
            batchesView.classList.remove('hidden');
            loadBatches();
        } else if (viewName === 'workers') {
            navWorkers.classList.add('active');
            workersView.classList.remove('hidden');
            loadWorkersView();
        } else if (viewName === 'contribution') {
            navContribution.classList.add('active');
            if (contributionView) contributionView.classList.remove('hidden');
        } else if (viewName === 'detail') {
            navBatches.classList.add('active');
            batchDetailView.classList.remove('hidden');
        }
    }

    navBatches.onclick = () => switchView('batches');
    navWorkers.onclick = () => switchView('workers');
    navContribution.onclick = () => switchView('contribution');

    const categoriesListContainer = document.getElementById('categoryTabs');
    const backToBatchesBtn = document.getElementById('backToBatchesBtn');
    const endBatchBtn = document.getElementById('endBatchBtn');
    const reopenBatchBtn = document.getElementById('reopenBatchBtn');

    // Modals
    const modalBatch = document.getElementById('batchModal');
    const modalEndBatch = document.getElementById('endBatchModal');
    const modalExpense = document.getElementById('expenseModal');
    const modalSale = document.getElementById('saleModal');
    const modalShare = document.getElementById('shareModal');
    const modalPayable = document.getElementById('payableModal');
    const modalCategory = document.getElementById('categoryModal');

    const today = new Date().toISOString().split('T')[0];

    // --- Initialization ---
    // Start by loading categories
    loadCategories();
    loadBatches();
    switchView('batches');

    // Make global functions available for inline JS
    window.loadSales = loadSales;
    window.loadProfit = loadProfit;
    window.loadBalance = loadBalance;
    window.showModal = showModal;
    window.hideModals = hideModals;
    window.openManageFundsModal = openManageFundsModal;
    window.saveOpeningBalanceModal = saveOpeningBalanceModal;
    window.submitDepositModal = submitDepositModal;
    window.deleteDeposit = deleteDeposit;
    window.initProfitEstimator = initProfitEstimator;
    window.calculateEstimation = calculateEstimation;
    window.addExtraExpense = addExtraExpense;
    window.addHimaPayable = addHimaPayable;
    window.formatCommaInput = formatCommaInput;
    window.resetEstimateUI = resetEstimateUI;
    window.debouncedSave = debouncedSave;
    window.updateExpenseTotal = updateExpenseTotal;
    window.updateSaleTotal = updateSaleTotal;
    window.downloadReport = function () {
        if (!currentBatch) {
            alert('No batch selected');
            return;
        }
        window.open(`${API_BASE}/batches/${currentBatch.id}/report`, '_blank');
    };

    window.viewReceipt = function (url) {
        if (!url) return;
        const modal = document.getElementById('receiptViewerModal');
        const img = document.getElementById('receiptImage');
        const downloadLink = document.getElementById('receiptDownloadLink');

        if (img) img.src = url;
        if (downloadLink) downloadLink.href = url;

        if (modal) modal.classList.add('show');
    };

    // --- User Dropdown Logic (Global for reliability) ---
    const userDropdown = document.getElementById('userDropdown');
    const userDropdownBtn = document.getElementById('userDropdownBtn');

    window.toggleUserDropdown = function (e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (userDropdown) {
            userDropdown.classList.toggle('hidden');
            console.log('User Dropdown Toggled. Hidden:', userDropdown.classList.contains('hidden'));
        }
    };

    // Close dropdown on click outside
    window.addEventListener('click', (e) => {
        if (userDropdown && !userDropdown.classList.contains('hidden')) {
            // Check if click is outside dropdown AND outside the button (including icons inside it)
            const isClickInsideBtn = userDropdownBtn && (userDropdownBtn === e.target || userDropdownBtn.contains(e.target));
            const isClickInsideDropdown = userDropdown.contains(e.target);

            if (!isClickInsideDropdown && !isClickInsideBtn) {
                userDropdown.classList.add('hidden');
            }
        }
    });

    if (userDropdown) {
        userDropdown.onclick = (e) => e.stopPropagation();
    }

    // --- Global Exposed Functions (Hoisted) ---
    window.deleteExpense = async (id) => {
        console.log('Delete requested for:', id);
        // Ensure checkClosed is available (hoisted function)
        if (typeof checkClosed === 'function' && checkClosed()) {
            alert('Batch is closed. Cannot delete.');
            return;
        }

        // Conditional Delete Logic
        const exp = currentExpenses.find(e => e.id === id);
        if (exp && exp.is_advance) {
            // Check if worker is settled
            const hasSettlement = currentExpenses.some(e =>
                e.worker_id === exp.worker_id &&
                !e.is_advance &&
                (e.ref_no === 'SETTLE' || e.subject.includes('Settlement'))
            );
            if (hasSettlement) {
                alert('Cannot delete this advance because the worker has already been settled. Please delete the settlement first.');
                return;
            }
        }

        if (!confirm('Are you sure you want to delete this expense?')) return;

        try {
            const res = await fetch(`${API_BASE}/expenses/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadExpenses();
                loadProfit();
            } else {
                alert('Failed to delete expense.');
            }
        } catch (e) {
            alert('Error deleting: ' + e.message);
        }
    };

    window.editExpense = (id) => {
        const exp = currentExpenses.find(e => e.id === id);
        if (!exp) return;

        editingExpenseId = id;
        document.getElementById('expenseModalTitle').textContent = 'Edit Expense';
        document.getElementById('saveExpenseBtn').textContent = 'Update Expense';

        // Populate
        document.getElementById('expDate').value = exp.date;
        document.getElementById('expRef').value = exp.ref_no || '';
        document.getElementById('expSubject').value = exp.subject;
        document.getElementById('expQty').value = exp.qty || '';
        document.getElementById('expPrice').value = exp.unit_price || '';
        document.getElementById('expTotal').value = exp.total;

        // Toggle Worker Section
        const workerSec = document.getElementById('workerSection');
        if (exp.category === 'Labour') {
            workerSec.classList.remove('hidden');
            // Init Custom Dropdown instead
            initWorkerDropdown('expWorkerContainer', exp.worker_id);

        } else {
            workerSec.classList.add('hidden');
        }

        // Receipt Presence UI
        const currentReceipt = document.getElementById('expCurrentReceipt');
        if (currentReceipt) {
            if (exp.receipt_url) {
                currentReceipt.classList.remove('hidden');
                currentReceipt.innerHTML = `<i class="fa-solid fa-receipt"></i> <a href="javascript:void(0)" onclick="window.viewReceipt('${exp.receipt_url}')" style="color:var(--accent); text-decoration:underline;">View current receipt</a>`;
            } else {
                currentReceipt.classList.add('hidden');
            }
        }
        // Clear file input
        const fileInput = document.getElementById('expReceipt');
        if (fileInput) fileInput.value = '';

        showModal(document.getElementById('expenseModal'));
    };

    window.deleteSale = async (id) => {
        if (typeof checkClosed === 'function' && checkClosed()) {
            alert('Batch is closed. Cannot delete.');
            return;
        }
        if (!confirm('Delete sale?')) return;
        await fetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
        loadSales();
        if (typeof loadProfit === 'function') loadProfit();
    };


    // --- Event Listeners ---
    // Batches
    document.getElementById('addBatchBtn').onclick = () => {
        document.getElementById('newBatchDate').value = today;
        showModal(modalBatch);
    };
    document.getElementById('saveBatchBtn').onclick = createBatch;
    document.getElementById('endBatchBtn').onclick = () => {
        document.getElementById('endBatchDate').value = today;
        // Reset UI State for Modal
        document.getElementById('endBatchStep1').style.display = 'block';
        document.getElementById('endBatchStep2').style.display = 'none';
        document.getElementById('endBatchOtp').value = '';
        showModal(modalEndBatch);
    };

    // Missing Listener Restored
    const confirmEndBtn = document.getElementById('confirmEndBatchBtn');
    if (confirmEndBtn) confirmEndBtn.onclick = confirmEndBatch;

    // Assign these late to ensure functions are defined
    // (Moving strict Assignments to bottom of file or wrapping in safe block is better, 
    // but here we just ensure they point to window.X if defined there)

    // Reopen Button in UI (Header)
    document.getElementById('reopenBatchBtn').onclick = function () {
        // Reset UI State
        document.getElementById('reopenBatchStep1').style.display = 'block';
        document.getElementById('reopenBatchStep2').style.display = 'none';
        document.getElementById('reopenBatchOtp').value = '';
        showModal(document.getElementById('reopenBatchModal'));
    };

    // Navigation
    backToBatchesBtn.onclick = () => { currentBatch = null; switchView('batches'); };

    // Expenses
    // Expenses
    document.getElementById('addExpenseBtn').onclick = () => {
        try {
            editingExpenseId = null; // Reset edit state
            document.getElementById('expenseModalTitle').textContent = 'Add Expense';
            document.getElementById('saveExpenseBtn').textContent = 'Save Expense';
            resetExpenseModal();

            const workerSec = document.getElementById('workerSection');

            if (currentCategory === 'Labour') {
                if (workerSec) workerSec.classList.remove('hidden');
                // loadWorkers();
                initWorkerDropdown('expWorkerContainer');
            } else {
                if (workerSec) workerSec.classList.add('hidden');
            }

            showModal(modalExpense);
        } catch (e) {
            console.error(e);
            alert('Error opening form: ' + e.message);
        }
    };

    // Open Add Worker Modal
    const openAddWorkerModalBtn = document.getElementById('openAddWorkerModalBtn');
    if (openAddWorkerModalBtn) {
        openAddWorkerModalBtn.onclick = () => {
            editingWorkerId = null; // Reset
            document.getElementById('newWorkerName').value = '';
            document.getElementById('newWorkerId').value = '';
            document.getElementById('newWorkerDob').value = '';
            document.getElementById('newWorkerPhone').value = '';
            document.getElementById('newWorkerAddress').value = '';

            // Init Custom Dropdown for Status
            initCustomDropdown('newWorkerStatusContainer', [
                { value: 'true', label: 'Working (Active)' },
                { value: 'false', label: 'Not Working (Inactive)' }
            ], null, 'true'); // Default Active

            document.getElementById('saveWorkerBtn').textContent = 'Create Worker';
            showModal(document.getElementById('workerModal'));
        };
    }

    window.editWorker = (id) => {
        const worker = currentWorkers.find(w => w.id === id);
        if (!worker) return;

        editingWorkerId = id;
        document.getElementById('newWorkerName').value = worker.name;
        document.getElementById('newWorkerId').value = worker.emp_id || '';
        document.getElementById('newWorkerDob').value = worker.dob || '';
        document.getElementById('newWorkerPhone').value = worker.phone || '';
        document.getElementById('newWorkerAddress').value = worker.address || '';

        // Init Custom Dropdown with Pre-selected value
        initCustomDropdown('newWorkerStatusContainer', [
            { value: 'true', label: 'Working (Active)' },
            { value: 'false', label: 'Not Working (Inactive)' }
        ], null, worker.active.toString());

        document.getElementById('saveWorkerBtn').textContent = 'Update Worker';
        showModal(document.getElementById('workerModal'));
    };

    window.deleteWorker = async (id) => {
        if (!confirm('Are you sure you want to delete this worker?')) return;
        try {
            const res = await fetch(`${API_BASE}/workers/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadWorkersView();
            } else {
                alert('Failed to delete worker');
            }
        } catch (e) { console.error(e); }
    };

    document.getElementById('saveWorkerBtn').onclick = async () => {
        const name = document.getElementById('newWorkerName').value;
        const emp_id = document.getElementById('newWorkerId').value;
        const dob = document.getElementById('newWorkerDob').value;
        const phone = document.getElementById('newWorkerPhone').value;
        const address = document.getElementById('newWorkerAddress').value;

        // Read from Custom Dropdown
        const statusContainer = document.getElementById('newWorkerStatusContainer');
        const active = statusContainer ? (statusContainer.dataset.value === 'true') : true;

        if (!name) {
            alert('Worker name is required');
            return;
        }

        const method = editingWorkerId ? 'PUT' : 'POST';
        const url = editingWorkerId ? `${API_BASE}/workers/${editingWorkerId}` : `${API_BASE}/workers`;

        try {
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, emp_id, dob, phone, address, active })
            });
            if (res.ok) {
                hideModals();
                loadWorkersView(); // Refresh table
            } else {
                const err = await res.json();
                alert('Failed to save worker: ' + (err.error || 'Unknown error'));
            }
        } catch (e) {
            console.error(e);
            alert('System Error: ' + e.message);
        }
    };

    // Calculate Age Helper
    function calculateAge(dobStr) {
        if (!dobStr) return '-';
        const dob = new Date(dobStr);
        const diff = Date.now() - dob.getTime();
        const ageDate = new Date(diff);
        return Math.abs(ageDate.getUTCFullYear() - 1970);
    }

    // Render Logic
    async function loadWorkersView() {
        try {
            const res = await fetch(`${API_BASE}/workers`);
            currentWorkers = await res.json(); // Global store
            const tbody = document.querySelector('#workersTable tbody');
            tbody.innerHTML = '';

            currentWorkers.forEach(w => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${w.emp_id || '-'}</td>
                    <td>${w.name}</td>
                    <td>${w.dob || '-'}</td>
                    <td>${calculateAge(w.dob)}</td>
                    <td>${w.phone || '-'}</td>
                    <td>${w.address || '-'}</td>
                    <td><span class="badge ${w.active ? 'badge-active' : 'badge-inactive'}">${w.active ? 'Working' : 'Not Working'}</span></td>
                    <td>
                        <div class="action-group">
                            <button class="action-btn edit-btn" onclick="editWorker(${w.id})">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button class="action-btn delete-btn" onclick="deleteWorker(${w.id})">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) { console.error(e); }
    }


    document.getElementById('saveExpenseBtn').onclick = createExpense;

    // Salary Manager
    const manageWorkersBtn = document.getElementById('manageWorkersBtn');
    if (manageWorkersBtn) manageWorkersBtn.onclick = openSettleInterface;

    const confirmSettleBtn = document.getElementById('confirmSettleBtn');
    if (confirmSettleBtn) confirmSettleBtn.onclick = confirmSettlement;

    // --- Helper for Manager Button Visibility ---
    // Modify switching tab to show/hide button (hook into existing switchTab or add observer)
    // best place is switchTab, let's update switchTab later or inject into it.
    // For now, let's just make the button visible when Labour is clicked
    // We can do this by overriding switchTab logic slightly or adding a check in loadExpenses.

    // Sales
    document.getElementById('addSaleBtn').onclick = () => {
        if (checkClosed()) return;
        resetSaleModal();
        showModal(modalSale);
    }
    document.getElementById('saveSaleBtn').onclick = createSale;

    // Payables
    const savePayableBtn = document.getElementById('savePayableBtn');
    if (savePayableBtn) savePayableBtn.onclick = createPayable;

    // Categories
    const saveCategoryBtn = document.getElementById('saveCategoryBtn');
    if (saveCategoryBtn) saveCategoryBtn.onclick = createCategory;


    // Auto-Calcs
    document.getElementById('expQty').addEventListener('input', calcExpTotal);
    document.getElementById('expPrice').addEventListener('input', calcExpTotal);
    document.getElementById('saleWeight').addEventListener('input', calcSaleTotal);
    document.getElementById('salePrice').addEventListener('input', calcSaleTotal);

    // Bank Balance Listeners
    // document.getElementById('editOpeningBalanceBtn').onclick = ... (Removed old listeners)
    // New listeners are attached inside DOMContentLoaded lower down or we can clean up here.
    // For safety, let's just leave this block empty or remove the old references.

    // --- User Profile Dropdown ---
    // Moved to bottom or consolidated


    document.querySelectorAll('.close-modal').forEach(btn => btn.onclick = hideModals);



    // --- Functions ---

    // ... (checkClosed, calcExpTotal, calcSaleTotal, showView unchanged) ...
    // ... we need to skip lines or rely on user to assume they exist ... 
    // BUT I must provide valid replacement. 
    // I will try to keep the diff minimal but I edited initialization logic which spans many lines.

    // ... (keeping helper functions as is, reusing space) ...
    function checkClosed() {
        if (currentBatch && currentBatch.status === 'Closed') {
            alert('Batch is closed. Reopen to make changes.');
            return true;
        }
        return false;
    }

    function calcExpTotal() {
        const qty = cleanNum(document.getElementById('expQty').value);
        const price = cleanNum(document.getElementById('expPrice').value);
        const total = qty * price;
        document.getElementById('expTotal').value = total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function calcSaleTotal() {
        const weight = cleanNum(document.getElementById('saleWeight').value);
        const price = cleanNum(document.getElementById('salePrice').value);
        const total = weight * price;
        document.getElementById('saleTotal').value = total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }




    // --- Categories Management ---
    async function loadCategories() {
        try {
            const res = await fetch(`${API_BASE}/categories`);
            categories = await res.json();
            initTabs();
        } catch (e) {
            console.error('Failed to load categories', e);
            // Default fallback
            categories = [
                { name: 'Chicks', is_hima: true },
                { name: 'Chicken Feed', is_hima: true },
                { name: 'Medicine', is_hima: true },
                { name: 'Labour', is_hima: false },
                { name: 'Food for Labour', is_hima: false },
                { name: 'Electricity', is_hima: false },
                { name: 'Saw Dust (UMI)', is_hima: false },
                { name: 'Wood (Kolli)', is_hima: false },
                { name: 'Additional Cost', is_hima: false }
            ];
            initTabs();
        }
    }

    async function createCategory() {
        const name = document.getElementById('newCategoryName').value.trim();
        const isHima = document.getElementById('newCategoryIsHima').checked;

        if (!name) return;
        try {
            const res = await fetch(`${API_BASE}/categories`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, is_hima: isHima })
            });
            if (res.ok) {
                hideModals();
                loadCategories(); // Reloads tabs
            } else {
                const data = await res.json();
                alert(data.error || 'Failed to create category');
            }
        } catch (e) { console.error(e); }
    }


    // --- Batches ---
    async function loadBatches() {
        try {
            const res = await fetch(`${API_BASE}/batches`);
            const batches = await res.json();
            batchGrid.innerHTML = '';

            batches.forEach(batch => {
                const isClosed = batch.status === 'Closed';
                const card = document.createElement('div');
                card.className = 'batch-card';
                card.style.borderColor = isClosed ? '#ef4444' : 'var(--glass-border)';
                const statusColor = isClosed ? '#ef4444' : '#4ade80';

                card.innerHTML = `
                    <div class="delete-batch-btn" title="Delete Batch" onclick="event.stopPropagation(); window.openDeleteBatchModal(${batch.id})">
                        <i class="fa-solid fa-trash"></i>
                    </div>
                    <h3>${batch.name}</h3>
                    <p><i class="fa-regular fa-calendar"></i> Starts: ${batch.start_date}</p>
                    <p style="margin-top:0.5rem; color: ${statusColor}; font-weight:600;">
                        ${isClosed ? `Ended: ${batch.end_date}` : 'Active'}
                    </p>
                `;
                card.onclick = (e) => {
                    // Navigate only if the click wasn't on the delete button
                    if (!e.target.closest('.delete-batch-btn')) {
                        openBatchDetail(batch);
                    }
                };
                batchGrid.appendChild(card);
            });
        } catch (err) { console.error(err); }
    }

    async function createBatch() {
        const name = document.getElementById('newBatchName').value;
        const date = document.getElementById('newBatchDate').value;
        if (!name) return;
        try {
            const res = await fetch(`${API_BASE}/batches`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, start_date: date })
            });
            if (res.ok) {
                hideModals();
                loadBatches();
            } else {
                const errData = await res.json();
                alert('Error creating batch: ' + (errData.error || 'Unknown error'));
            }
        } catch (err) {
            console.error(err);
            alert('Connection error: ' + err.message);
        }
    }

    function openBatchDetail(batch) {
        currentBatch = batch;
        document.getElementById('currentBatchTitle').textContent = batch.name;
        document.getElementById('currentDate').textContent = batch.start_date;

        // --- Calculate Batch Age ---
        const start = new Date(batch.start_date);
        let end = new Date(); // Default to now

        // If batch is closed, use end_date
        if (batch.status === 'Closed' && batch.end_date) {
            end = new Date(batch.end_date);
        }

        // Calculate difference (Time matches UTC vs Local issues usually, so we strip time or use rough day calc)
        // Best approach: reset hours to 0 for both to get clean day diff
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);

        const diffTime = Math.abs(end - start);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        // Note: Day 1 starts at 0 or 1? usually "Age" implies duration.
        // If started today, is it day 0 or day 1? 
        // User asked for "todays day minus the batch start date", which implies mathematical difference.
        // so Same day = 0.

        document.querySelector('#batchAgeDisplay .age-value').textContent = diffDays;
        document.querySelector('#batchAgeDisplay .age-unit').textContent = diffDays === 1 ? 'Day' : 'Days';

        if (batch.status === 'Closed') {
            endBatchBtn.style.display = 'none';
            reopenBatchBtn.classList.remove('hidden');
        } else {
            endBatchBtn.style.display = 'flex';
            reopenBatchBtn.classList.add('hidden');
        }

        // Default to expenses view
        window.switchSubView('expenses');
        // Ensure category is set
        if (categories.length > 0 && !currentCategory) {
            currentCategory = categories[0].name; // Fix: use .name
            initTabs(); // Re-render to highlight correct tab
        } else {
            loadExpenses();
        }
        if (window.loadOpeningBalances) window.loadOpeningBalances();
        switchView('detail');
    }

    // --- Batch Action OTP Helper ---
    window.requestBatchActionOtp = async function (action) {
        // Special Handling for Delete Batch (No steps, just timer)
        if (action === 'delete') {
            const batchId = batchIdToDelete;
            if (!batchId) return;

            // Check Cooldown
            const now = Date.now();
            if (deleteBatchCooldowns[batchId] && now < deleteBatchCooldowns[batchId]) {
                return; // Still cooling down
            }

            const btn = document.getElementById('reqDeleteBatchOtpBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
            btn.disabled = true;

            try {
                const res = await fetch(`${API_BASE}/request-action-otp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'Delete Batch' })
                });
                const data = await res.json();

                if (res.ok) {
                    // Start 60s cooldown
                    deleteBatchCooldowns[batchId] = Date.now() + 60000;
                    window.updateDeleteBatchTimer(batchId);
                    alert('OTP sent to your email.');
                } else {
                    alert(data.error || 'Failed to send OTP');
                    btn.innerHTML = originalText;
                    btn.disabled = false;
                }
            } catch (e) {
                console.error(e);
                alert('Network error');
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
            return;
        }

        const btnId = action === 'end' ? 'reqEndBatchOtpBtn' : 'reqReopenBatchOtpBtn';
        const step1Id = action === 'end' ? 'endBatchStep1' : 'reopenBatchStep1';
        const step2Id = action === 'end' ? 'endBatchStep2' : 'reopenBatchStep2';

        const btn = document.getElementById(btnId);
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
        btn.disabled = true;

        try {
            const actionLabel = action === 'end' ? 'End Batch' : 'Reopen Batch';
            const res = await fetch(`${API_BASE}/request-action-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: actionLabel })
            });
            const data = await res.json();

            if (res.ok) {
                document.getElementById(step1Id).style.display = 'none';
                document.getElementById(step2Id).style.display = 'block';
                if (action === 'end') document.getElementById('endBatchDate').value = today; // set default date
            } else {
                alert(data.error || 'Failed to send OTP');
            }
        } catch (e) {
            console.error(e);
            alert('Network error');
        }
        btn.innerHTML = originalText;
        btn.disabled = false;
    };

    window.updateDeleteBatchTimer = function (batchId) {
        const btn = document.getElementById('reqDeleteBatchOtpBtn');
        if (!btn) return;

        const interval = setInterval(() => {
            // Safety: If we switched batches or closed, stop this interval
            if (batchId !== batchIdToDelete) {
                clearInterval(interval);
                return;
            }

            const now = Date.now();
            const expiry = deleteBatchCooldowns[batchId];

            if (!expiry || now >= expiry) {
                clearInterval(interval);
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-regular fa-paper-plane"></i> Send OTP to Delete';
                btn.style.opacity = '1';
                return;
            }

            const remaining = Math.ceil((expiry - now) / 1000);
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-clock"></i> Resend in ${remaining}s`;
            btn.style.opacity = '0.7';
        }, 1000);
    };

    // Override generic close to reset OTP steps
    const originalHideModals = window.hideModals;
    window.hideModals = function () {
        originalHideModals();
        // Reset steps after delay
        setTimeout(() => {
            ['endBatch', 'reopenBatch'].forEach(prefix => {
                const s1 = document.getElementById(prefix + 'Step1');
                const s2 = document.getElementById(prefix + 'Step2');
                const otp = document.getElementById(prefix + 'Otp');
                if (s1) s1.style.display = 'block';
                if (s2) s2.style.display = 'none';
                if (otp) otp.value = '';
            });
            // Separately reset delete field
            const deleteOtp = document.getElementById('deleteBatchOtp');
            if (deleteOtp) deleteOtp.value = '';
        }, 500);
    };

    let batchIdToDelete = null;

    window.openDeleteBatchModal = function (batchId) {
        batchIdToDelete = batchId;
        showModal(document.getElementById('deleteBatchModal'));

        // Check if cooldown is active for this batch
        const now = Date.now();
        const expiry = deleteBatchCooldowns[batchId];
        const btn = document.getElementById('reqDeleteBatchOtpBtn');

        if (expiry && now < expiry) {
            // Immediate UI update to avoid flicker
            if (btn) {
                const remaining = Math.ceil((expiry - now) / 1000);
                btn.disabled = true;
                btn.innerHTML = `<i class="fa-solid fa-clock"></i> Resend in ${remaining}s`;
                btn.style.opacity = '0.7';
            }
            window.updateDeleteBatchTimer(batchId);
        } else {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-regular fa-paper-plane"></i> Send OTP to Delete';
                btn.style.opacity = '1';
            }
        }
    };

    window.confirmDeleteBatch = async function () {
        const otp = document.getElementById('deleteBatchOtp').value;
        if (!otp) return alert('Enter OTP to confirm deletion');

        const btn = document.getElementById('confirmDeleteBatchBtn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Deleting...';
        btn.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/batches/${batchIdToDelete}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ otp: otp })
            });
            const data = await res.json();
            if (res.ok) {
                hideModals();
                loadBatches();
                alert('Batch deleted successfully');
            } else {
                alert(data.error || 'Failed to delete batch');
            }
        } catch (e) {
            console.error(e);
            alert('System error during deletion');
        }
        btn.innerHTML = originalText;
        btn.disabled = false;
    };


    async function confirmEndBatch() {
        const endDate = document.getElementById('endBatchDate').value;
        const otp = document.getElementById('endBatchOtp').value;

        if (!endDate) return alert('Select End Date');
        if (!otp) return alert('Enter OTP');

        const btn = document.getElementById('confirmEndBatchBtn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';
        btn.disabled = true;

        try {
            console.log('Sending End Batch Request for:', currentBatch.id);
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Closed', end_date: endDate, otp: otp })
            });

            const data = await res.json();
            if (res.ok) {
                currentBatch.status = 'Closed';
                currentBatch.end_date = endDate;
                hideModals();
                openBatchDetail(currentBatch);
                loadBatches();
                alert('Batch ended successfully.');
            } else {
                alert(data.error || 'Failed to end batch');
                console.error('SERVER ERROR:', data);
            }
        } catch (err) {
            console.error(err);
            alert('Network or System Error: ' + err.message);
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    // Trigger Reopen Flow
    async function reopenBatch() {
        showModal(document.getElementById('reopenBatchModal'));
    }

    // Actual Reopen Action
    const reopenConfirmBtn = document.getElementById('confirmReopenBatchBtn');
    if (reopenConfirmBtn) {
        reopenConfirmBtn.onclick = async function () {
            const otp = document.getElementById('reopenBatchOtp').value;
            if (!otp) return alert('Enter OTP');

            const btn = this;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying...';
            btn.disabled = true;

            try {
                const res = await fetch(`${API_BASE}/batches/${currentBatch.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'Active', otp: otp })
                });

                const data = await res.json();
                if (res.ok) {
                    currentBatch.status = 'Active';
                    currentBatch.end_date = null;
                    hideModals();
                    openBatchDetail(currentBatch);
                    loadBatches();
                    alert('Batch reopened successfully.');
                } else {
                    alert(data.error || 'Failed to reopen batch');
                }
            } catch (err) {
                console.error(err);
                alert('System Error: ' + err.message);
            } finally {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        };
    }

    // --- Expenses ---
    function initTabs() {
        const container = document.getElementById('bracketTabsContainer');
        if (!container) return;

        container.innerHTML = '';

        if (!categories.length) return;

        const normalize = (c) => typeof c === 'string' ? { name: c, is_hima: false } : c;
        const cats = categories.map(normalize);

        // Ensure default category
        if (!currentCategory) currentCategory = cats[0].name;

        // --- Helper to build a group ---
        const createGroup = (title, groupClass, groupCats, isHimaContext) => {
            const groupDiv = document.createElement('div');
            groupDiv.className = `tab-group ${groupClass}`;

            const label = document.createElement('div');
            label.className = 'bracket-label';
            label.textContent = title;
            groupDiv.appendChild(label);

            const contentDiv = document.createElement('div');
            contentDiv.className = 'group-tabs-content';

            groupCats.forEach(catObj => {
                const btn = document.createElement('button');
                const isActive = catObj.name === currentCategory;
                btn.className = `tab-btn ${isActive ? 'active' : ''}`;
                btn.textContent = catObj.name;

                // Active Styling using Classes
                if (isActive) {
                    if (isHimaContext) {
                        btn.classList.add('active-hima');
                    } else {
                        btn.classList.add('active-farm');
                    }
                }

                btn.onclick = () => switchTab(catObj.name);
                contentDiv.appendChild(btn);
            });

            // Add Plus Button to 'Our Expense' group (or creates a smart one for both to allow context adding)
            const addBtn = document.createElement('button');
            addBtn.className = 'tab-btn';
            addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
            addBtn.style.minWidth = '40px';
            addBtn.style.opacity = '0.7';
            addBtn.onclick = () => {
                document.getElementById('newCategoryName').value = '';
                document.getElementById('newCategoryIsHima').checked = isHimaContext;
                showModal(document.getElementById('categoryModal'));
            };
            contentDiv.appendChild(addBtn);

            groupDiv.appendChild(contentDiv);
            container.appendChild(groupDiv);
        };

        const himaCats = cats.filter(c => c.is_hima);
        const farmCats = cats.filter(c => !c.is_hima);

        createGroup('Hima Expenses', 'hima-group', himaCats, true);
        createGroup('Our Expenses', 'farm-group', farmCats, false);
    }

    function switchTab(cat) {
        currentCategory = cat;
        document.getElementById('activeCategoryTitle').textContent = cat;

        // Update Active States
        // We need to look inside the bracket container now
        const container = document.getElementById('bracketTabsContainer');
        if (container) {
            const buttons = container.querySelectorAll('.tab-btn');
            buttons.forEach(btn => {
                const isMatch = btn.textContent === cat;

                // Clear old active classes
                btn.classList.remove('active', 'active-hima', 'active-farm');

                // Remove inline styles to allow class to take over (cleaner)
                // Note: We might have set inline styles in initTabs, so let's clear them generally
                btn.style.borderColor = '';
                btn.style.color = '';
                btn.style.background = '';

                if (isMatch) {
                    // Check if parent group is Hima or Farm to decide color
                    // The button is inside .group-tabs-content inside .tab-group.hima-group (or farm-group)
                    const group = btn.closest('.tab-group');
                    if (group && group.classList.contains('hima-group')) {
                        btn.classList.add('active-hima');
                    } else {
                        btn.classList.add('active-farm');
                    }
                }
            });
        }

        // Toggle Manage Workers Button
        const mgrBtn = document.getElementById('manageWorkersBtn');
        if (cat === 'Labour') mgrBtn.classList.remove('hidden');
        else mgrBtn.classList.add('hidden');

        loadExpenses();
    }

    async function loadExpenses() {
        if (!currentBatch) return;
        try {
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}/expenses`);
            currentExpenses = await res.json(); // Store globally
            renderExpenseTable(currentExpenses.filter(e => e.category === currentCategory));
        } catch (err) { console.error(err); }
    }

    async function renderExpenseTable(expenses) {
        const container = document.querySelector('#subview-expenses .table-container');

        // --- LABOUR VIEW (Dual Tables) ---
        if (currentCategory === 'Labour') {
            // Fetch workers for Name Map and Filter
            let workers = [];
            try {
                const res = await fetch(`${API_BASE}/workers`);
                workers = await res.json();
            } catch (e) { console.error(e); }

            // Split Expenses
            const advances = expenses.filter(e => e.is_advance);
            const settlements = expenses.filter(e => !e.is_advance && e.ref_no && (e.ref_no === 'SETTLE' || e.subject.includes('Settlement'))); // Robust check
            // Note: General expenses in Labour might be lost here if we strict filter. 
            // Let's add them to "Advances / General" table? 
            // User asked for "Advance Table". Let's stick to showing is_advance=True there.
            // But to avoid data loss, let's include ALL non-settlements in top table.
            const topTableExpenses = expenses.filter(e => !settlements.includes(e));

            // Build Layout
            container.innerHTML = `
                <div style="padding: 1rem; display:flex; gap:10px; align-items:center;">
                    <label style="color:var(--text-secondary);">Filter Worker:</label>
                    <div id="workerFilterContainer"></div> <!-- Custom Dropdown Mount Point -->
                </div>

                <div class="dual-table-section">
                    <h3 style="color:var(--accent); margin-bottom:10px;">Advances</h3>
                    <table class="data-table" id="advanceTable">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Ref</th>
                                <th>Worker</th>
                                <th>Subject</th>
                                <th>Amount</th>
                                <th style="width:40px;"><i class="fa-solid fa-receipt"></i></th>
                                <th style="width:100px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody></tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td colspan="4" style="text-align:right;">Total Advances</td>
                                <td id="totalAdvancesDisplay" style="font-weight:bold; color:var(--text-red);">0.00</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="dual-table-section" style="margin-top: 2rem;">
                    <h3 style="color:var(--text-green); margin-bottom:10px;">Settlements</h3>
                    <table class="data-table" id="settleTable">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Worker</th>
                                <th>Ref</th>
                                <th>Agreed Salary</th>
                                <th>Less Advances</th>
                                <th>Final Paid</th>
                                <th style="width:40px;"><i class="fa-solid fa-receipt"></i></th>
                                <th style="width:100px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="settleTableBody"></tbody>
                    </table>
                </div>
            `;

            // Populate Settlements
            const settleBody = document.getElementById('settleTableBody');
            const settls = expenses.filter(e =>
                (e.ref_no === 'SETTLEMENT' || e.subject.includes('Settlement')) && !e.is_advance
            );

            settls.forEach(s => {
                const agreed = s.total;
                const advances = s.unit_price || 0;
                const paid = agreed - advances;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${s.date}</td>
                    <td>${s.worker_name || '-'}</td>
                    <td>${s.ref_no}</td>
                    <td style="font-weight:bold;">${agreed.toLocaleString()}</td>
                    <td class="text-red">-${advances.toLocaleString()}</td>
                    <td class="text-green" style="font-weight:bold;">${paid.toLocaleString()}</td>
                    <td style="text-align:center;">
                        ${s.receipt_url ? `<button class="btn-icon" onclick="window.viewReceipt('${s.receipt_url}')" title="View Receipt"><i class="fa-solid fa-receipt" style="color:var(--accent);"></i></button>` : '-'}
                    </td>
                    <td>
                        <button class="action-btn" onclick="deleteExpense(${s.id})"><i class="fa-solid fa-trash"></i></button>
                    </td>
                `;
                settleBody.appendChild(tr);
            });




            // Logic for Advance Table & Filter
            const renderAdvances = (filterId) => {
                const tbody = document.querySelector('#advanceTable tbody');
                const tfootDist = document.getElementById('totalAdvancesDisplay');
                tbody.innerHTML = '';

                let filtered = expenses.filter(e => e.is_advance);
                if (filterId !== 'ALL') {
                    // filterId from custom dropdown might be string or number, ensure loose equality
                    filtered = filtered.filter(e => e.worker_id == filterId);
                }

                // Sort by date (desc)
                filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

                let total = 0;
                filtered.forEach(e => {
                    total += e.total;
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${e.date}</td>
                        <td style="color:var(--text-secondary);">${e.ref_no || ''}</td>
                        <td>
                            ${e.worker_name || '-'} 
                            ${e.is_advance ? '<span class="badge badge-hima" style="font-size:0.7rem; padding:2px 6px;">ADV</span>' : ''}
                        </td>
                        <td>${e.subject}</td>
                        <td style="font-weight:600;">${e.total.toLocaleString()}</td>
                        <td style="text-align:center;">
                            ${e.receipt_url ? `<button class="btn-icon" onclick="window.viewReceipt('${e.receipt_url}')" title="View Receipt"><i class="fa-solid fa-receipt" style="color:var(--accent);"></i></button>` : '-'}
                        </td>
                        <td>
                            <button class="action-btn" onclick="editExpense(${e.id})" style="color:var(--text-secondary); margin-right:8px;"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button class="action-btn" onclick="deleteExpense(${e.id})"><i class="fa-solid fa-trash"></i></button>
                        </td>
            `;
                    tbody.appendChild(tr);
                });
                tfootDist.textContent = total.toLocaleString();
            };

            // Init Render
            renderAdvances('ALL');

            // --- Init Custom Dropdown ---
            const filterOptions = [
                { value: 'ALL', label: 'All Workers' },
                ...workers.map(w => ({ value: w.id, label: w.name }))
            ];

            initCustomDropdown('workerFilterContainer', filterOptions, (val) => {
                renderAdvances(val);
            });


            // Update Header Buttons
            document.getElementById('addExpenseBtn').innerHTML = '<i class="fa-solid fa-hand-holding-dollar"></i> Add Advance';
            document.getElementById('addExpenseBtn').onclick = () => {
                currentCategory = 'Labour';
                const mt = document.getElementById('expenseModalTitle');
                if (mt) mt.textContent = 'Add Advance Payment';
                resetExpenseModal();
                showModal(modalExpense);
                // Reveal worker section
                const ws = document.getElementById('workerSection');
                if (ws) ws.classList.remove('hidden');

                // Hide Checkbox Container & Force True
                const advBox = document.getElementById('advanceCheckboxContainer');
                if (advBox) advBox.classList.add('hidden');
                const cb = document.getElementById('expIsAdvance');
                if (cb) cb.checked = true;

                initWorkerDropdown('expWorkerContainer');
            };


            const awBtn = document.getElementById('addWorkerBtn');
            if (awBtn) awBtn.classList.remove('hidden');

        } else {
            // --- STANDARD VIEW ---
            // Restore Standard Table Structure
            container.innerHTML = `
                <table class="data-table fancy-table">
                    <thead>
                        <tr>
                            <th style="width: 80px;">Ref</th>
                            <th style="width: 130px;">Date</th>
                            <th>Subject</th>
                            <th style="width: 80px;">Qty</th>
                            <th style="width: 100px;">Price</th>
                            <th style="width: 120px;">Total</th>
                            <th style="width: 40px;"><i class="fa-solid fa-receipt"></i></th>
                            <th style="width: 100px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="expenseTableBody"></tbody>
                    <tfoot>
                        <tr class="total-row">
                             <td colspan="5" style="text-align:right; font-weight:bold; color:var(--text-secondary);">Category Total</td>
                             <td id="categoryTotal" style="font-weight:bold; color:var(--accent); font-size:1.1rem;">0.00</td>
                             <td></td>
                        </tr>
                    </tfoot>
                </table>
                `;

            const tbody = document.getElementById('expenseTableBody');
            let total = 0;

            expenses.forEach(exp => {
                total += exp.total;
                const tr = document.createElement('tr');
                tr.innerHTML = `
                <td style="color:var(--text-secondary);">${exp.ref_no || ''}</td>
                    <td>${exp.date}</td>
                    <td>
                        <div style="font-weight:600; color:var(--text-primary);">${exp.subject}</div>
                    </td>
                    <td>${exp.qty || '-'}</td>
                    <td>${exp.unit_price ? exp.unit_price.toFixed(2) : '-'}</td>
                    <td style="font-weight:bold; color:var(--text-primary);">${exp.total.toFixed(2)}</td>
                    <td style="text-align:center;">
                        ${exp.receipt_url ? `<button class="btn-icon" onclick="window.viewReceipt('${exp.receipt_url}')" title="View Receipt"><i class="fa-solid fa-receipt" style="color:var(--accent);"></i></button>` : '-'}
                    </td>
                    <td>
                        <div class="action-group" style="justify-content: center;">
                            <button class="action-btn" onclick="editExpense(${exp.id})"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button class="action-btn" onclick="deleteExpense(${exp.id})"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
            `;
                tbody.appendChild(tr);
            });

            document.getElementById('categoryTotal').textContent = total.toFixed(2);

            document.getElementById('addExpenseBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Add Expense';

            // RESTORE GENERIC HANDLER (Fix for sticky Labour mode)
            document.getElementById('addExpenseBtn').onclick = () => {
                try {
                    editingExpenseId = null;
                    document.getElementById('expenseModalTitle').textContent = 'Add Expense';
                    document.getElementById('saveExpenseBtn').textContent = 'Save Expense';
                    resetExpenseModal();

                    const workerSec = document.getElementById('workerSection');
                    if (workerSec) workerSec.classList.add('hidden');

                    showModal(modalExpense);
                } catch (e) {
                    console.error(e);
                }
            };

        }
    }

    // --- Auto Calculation ---
    function updateExpenseTotal() {
        const qty = cleanNum(document.getElementById('expQty').value);
        const price = cleanNum(document.getElementById('expPrice').value);
        document.getElementById('expTotal').value = (qty * price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function updateSaleTotal() {
        const weight = cleanNum(document.getElementById('saleWeight').value);
        const price = cleanNum(document.getElementById('salePrice').value);
        document.getElementById('saleTotal').value = (weight * price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    async function createExpense() {
        try {
            console.log('Starting createExpense...');
            const dateInput = document.getElementById('expDate');
            const workerSec = document.getElementById('workerSection');

            if (!dateInput || !dateInput.value) {
                alert('Date is required');
                return;
            }

            const isAdvCheckbox = document.getElementById('expIsAdvance');
            const isAdvance = isAdvCheckbox ? isAdvCheckbox.checked : false;

            const formData = new FormData();
            formData.append('batch_id', currentBatch ? currentBatch.id : '');
            formData.append('category', currentCategory);
            formData.append('date', dateInput.value);
            formData.append('ref_no', document.getElementById('expRef').value);
            formData.append('subject', document.getElementById('expSubject').value);
            formData.append('qty', cleanNum(document.getElementById('expQty').value));
            formData.append('unit_price', cleanNum(document.getElementById('expPrice').value));
            formData.append('total', cleanNum(document.getElementById('expTotal').value));
            formData.append('is_advance', isAdvance);

            const receiptInput = document.getElementById('expReceipt');
            if (receiptInput && receiptInput.files[0]) {
                formData.append('receipt', receiptInput.files[0]);
            }

            if (!currentBatch) throw new Error("No active batch found.");

            // Add worker data logic
            const isWorkerContext = (workerSec && !workerSec.classList.contains('hidden')) || currentCategory === 'Labour';

            if (isWorkerContext) {
                // Read from Custom Dropdown Container
                const workerContainer = document.getElementById('expWorkerContainer');
                const workerVal = workerContainer ? workerContainer.dataset.value : null;

                if (workerVal) {
                    formData.set('worker_id', parseInt(workerVal));
                } else if (currentCategory === 'Labour') {
                    // Force user to pick a worker for Labour to keep Ledger clean
                    if (!confirm("No worker selected. Save as general expense?")) return;
                }

                if (currentCategory === 'Labour') {
                    formData.set('is_advance', 'true');
                }
            }

            const method = editingExpenseId ? 'PUT' : 'POST';
            const url = editingExpenseId ? `${API_BASE}/expenses/${editingExpenseId}` : `${API_BASE}/expenses`;

            const res = await fetch(url, {
                method: method,
                body: formData
            });
            if (res.ok) {
                hideModals();
                loadExpenses();
                loadProfit();
            } else {
                const err = await res.json();
                alert('Error saving: ' + (err.error || 'Unknown error'));
            }
        } catch (err) {
            console.error('CreateExpense Failed:', err);
            alert('System Error: ' + err.message);
        }
    }

    // --- Worker Logic ---
    async function loadWorkers() {
        try {
            const res = await fetch(`${API_BASE}/workers`);
            const workers = await res.json();
            const sel = document.getElementById('expWorker');
            sel.innerHTML = '<option value="">Select Worker...</option>';
            workers.forEach(w => {
                const opt = document.createElement('option');
                opt.value = w.id;
                opt.textContent = w.name;
                sel.appendChild(opt);
            });
        } catch (e) { console.error(e); }
    }



    // deleteExpense moved to top


    function resetExpenseModal() {
        document.getElementById('expDate').value = today;
        document.getElementById('expRef').value = '';
        document.getElementById('expSubject').value = '';
        document.getElementById('expQty').value = '';
        document.getElementById('expPrice').value = '';
        document.getElementById('expTotal').value = '';
        const receiptInput = document.getElementById('expReceipt');
        if (receiptInput) receiptInput.value = '';
        const currentReceipt = document.getElementById('expCurrentReceipt');
        if (currentReceipt) currentReceipt.classList.add('hidden');
    }

    // --- Sales ---
    async function loadSales() {
        if (!currentBatch) return;
        try {
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}/sales`);
            const sales = await res.json();
            renderSalesTable(sales);
        } catch (err) { console.error(err); }
    }

    function renderSalesTable(sales) {
        const tbody = document.getElementById('salesTableBody');
        tbody.innerHTML = '';
        let total = 0;
        sales.forEach(sale => {
            total += sale.total_amount;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${sale.date}</td>
                <td>${sale.load_name || '-'}</td>
                <td>${sale.qty_birds}</td>
                <td>${sale.weight_kg}</td>
                <td>${sale.price_per_kg}</td>
                <td>${sale.total_amount.toFixed(2)}</td>
                <td style="text-align:center;">
                    ${sale.receipt_url ? `<button class="btn-icon" onclick="window.viewReceipt('${sale.receipt_url}')" title="View Receipt"><i class="fa-solid fa-receipt" style="color:var(--accent);"></i></button>` : '-'}
                </td>
                <td>
                    <div class="action-group" style="justify-content: center;">
                        <button class="action-btn" onclick="deleteSale(${sale.id})"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
        document.getElementById('grandTotalSales').textContent = total.toFixed(2);
    }

    async function createSale() {
        if (!currentBatch) return;
        const dateVal = document.getElementById('saleDate').value;
        if (!dateVal) return;

        const formData = new FormData();
        formData.append('batch_id', currentBatch.id);
        formData.append('date', dateVal);
        formData.append('load_name', document.getElementById('saleLoad').value);
        formData.append('qty_birds', cleanNum(document.getElementById('saleQty').value));
        formData.append('weight_kg', cleanNum(document.getElementById('saleWeight').value));
        formData.append('price_per_kg', cleanNum(document.getElementById('salePrice').value));
        formData.append('total_amount', cleanNum(document.getElementById('saleTotal').value));

        const receiptInput = document.getElementById('saleReceipt');
        if (receiptInput && receiptInput.files[0]) {
            formData.append('receipt', receiptInput.files[0]);
        }

        try {
            const res = await fetch(`${API_BASE}/sales`, {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                hideModals();
                loadSales();
                if (typeof loadProfit === 'function') loadProfit();
            } else {
                const errData = await res.json();
                alert('Error saving sale: ' + (errData.error || 'Unknown error'));
            }
        } catch (err) {
            console.error(err);
            alert('System Error: ' + err.message);
        }
    }

    // deleteSale moved to top


    function resetSaleModal() {
        document.getElementById('saleDate').value = today;
        document.getElementById('saleLoad').value = '';
        document.getElementById('saleQty').value = '';
        document.getElementById('saleWeight').value = '';
        document.getElementById('salePrice').value = '';
        document.getElementById('saleTotal').value = '';
        const receiptInput = document.getElementById('saleReceipt');
        if (receiptInput) receiptInput.value = '';
        const currentReceipt = document.getElementById('saleCurrentReceipt');
        if (currentReceipt) currentReceipt.classList.add('hidden');
    }

    // --- Profit (Updated with Accordion) ---
    // --- Profit (Updated with Accordion) ---
    async function loadProfit() {
        if (!currentBatch) return;
        try {
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}/summary`);
            const data = await res.json();

            const container = document.getElementById('profitContent');
            const fmt = (n) => 'Rs. ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const colorClass = (n) => n >= 0 ? 'text-green' : 'text-red';

            // Helper to generate breakdown list items
            const renderBreakdown = (items) => {
                if (!items || Object.keys(items).length === 0) return '<div style="padding:0.5rem; color:var(--text-secondary);">No items recorded</div>';
                return Object.entries(items).map(([cat, amount]) => `
                        <div class="breakdown-item">
                            <span>${cat}</span>
                            <span>${fmt(amount)}</span>
                        </div>
                    `).join('');
            };

            const renderPayables = (list) => {
                if (!list || list.length === 0) return '<div style="padding:0.5rem; color:var(--text-secondary);">No items recorded</div>';
                return list.map(p => `
                        <div class="breakdown-item">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span>${p.name}</span>
                                ${p.receipt_url ? `<button class="btn-icon small-btn" onclick="window.viewReceipt('${p.receipt_url}')" title="View Receipt"><i class="fa-solid fa-receipt" style="color:var(--accent);"></i></button>` : ''}
                            </div>
                            <span>${fmt(p.amount)}</span>
                        </div>
                    `).join('');
            };

            container.innerHTML = `
                <!-- Header Sales -->
                <div class="profit-summary-card">
                    <div class="summary-row header">
                        <span>Total Sales</span>
                        <span class="text-green">${fmt(data.total_sales)}</span>
                    </div>
                </div>

                <!-- Hima Section (Pure Expenses) -->
                <div class="accordion-card expense-card">
                    <div class="accordion-header" onclick="toggleAccordion(this)">
                        <div class="header-info">
                            <span class="badg-red">Hima Expenses</span>
                            <span class="header-total">-${fmt(data.hima_expenses)}</span>
                        </div>
                        <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-inner">
                            ${renderBreakdown(data.hima_breakdown)}
                        </div>
                    </div>
                </div>

                <!-- Gross Profit Flow -->
                <div class="flow-connector small">=</div>
                <div class="flow-step compact">
                    <span>Gross Profit</span>
                    <span class="${colorClass(data.gross_profit)}">${fmt(data.gross_profit)}</span>
                </div>

                <!-- Split Logic -->
                <div class="split-info-card">
                    <div class="split-row">
                        <div class="split-label">
                            <span>Hima Share</span>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span class="fancy-percent" id="currentHimaPercentDisplay" data-value="${data.hima_p}">${data.hima_p}%</span>
                                <button class="btn-icon small-btn edit-hima-btn" onclick="window.editHimaShare(event)" title="Edit Percentage" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); width: 24px; height: 24px; font-size: 0.7rem;">
                                    <i class="fa-solid fa-pen"></i>
                                </button>
                            </div>
                        </div>
                        <span class="split-value text-blue">${fmt(data.hima_share)}</span>
                    </div>
                    <div class="split-row highlight">
                        <div class="split-label">
                            <span>Our Share</span>
                            <span class="fancy-percent">${data.farm_p}%</span>
                        </div>
                        <span class="split-value text-green">${fmt(data.farm_share_gross)}</span>
                    </div>
                </div>

                <!-- Payables Adjustment -->
                <div class="flow-connector small" style="color:var(--text-secondary); font-size:0.8rem;">(Adjustments)</div>
                <div class="accordion-card expense-card" style="border-color: rgba(139, 92, 246, 0.3);">
                    <div class="accordion-header" onclick="toggleAccordion(this)">
                         <div class="header-info">
                            <span class="badg-purple">Hima Payables</span>
                            <span class="header-total" style="color:#a78bfa;">${fmt(data.payables_total)}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <button class="btn-icon small-btn" onclick="event.stopPropagation(); openAddPayableModal(event)">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                    </div>
                     <div class="accordion-content">
                        <div class="accordion-inner">
                            ${renderBreakdown(data.payables_breakdown)}
                            <div style="margin-top:10px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.1); font-size:0.85rem; color:var(--text-secondary); text-align:center;">
                                <span>Note: Added to Hima / Deducted from Farm</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Farm Expenses -->
                <div class="flow-connector small" style="margin-top:1rem;">-</div>
                <div class="accordion-card expense-card">
                    <div class="accordion-header" onclick="toggleAccordion(this)">
                        <div class="header-info">
                            <span class="badg-yellow">Farm Expenses</span>
                            <span class="header-total">-${fmt(data.farm_expenses)}</span>
                        </div>
                        <i class="fa-solid fa-chevron-down"></i>
                    </div>
                    <div class="accordion-content">
                        <div class="accordion-inner">
                            ${renderBreakdown(data.farm_breakdown)}
                        </div>
                    </div>
                </div>

                <!-- Final Profit Summary -->
                <div class="flow-connector small">=</div>
                <div class="glass-panel" style="margin-top:1rem; padding:1.5rem; background: rgba(0,0,0,0.4);">
                    <div style="display:flex; flex-direction:column; gap:1rem;">
                        
                        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:1rem;">
                             <span style="color:var(--text-secondary); font-size:1.1rem;">Hima Final Payout</span>
                             <h2 class="text-green" style="margin:0;">${fmt(data.final_hima_profit)}</h2>
                        </div>

                        <div style="display:flex; justify-content:space-between; align-items:center;">
                             <span style="color:var(--text-secondary); font-size:1.1rem;">Our Final Net Profit</span>
                             <h1 class="${colorClass(data.final_farm_profit)}" style="margin:0; font-size:2rem;">${fmt(data.final_farm_profit)}</h1>
                        </div>

                        <!-- Partner Shares -->
                        <div style="background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 1rem; margin-top: 0.5rem;">
                            <h4 style="color: var(--text-secondary); margin-bottom: 0.8rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">Partner Split (Equal Share)</h4>
                            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                <div style="display: flex; justify-content: space-between;">
                                    <span>Kaleel Share</span>
                                    <span class="${colorClass(data.partner_share)}">${fmt(data.partner_share)}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span>Iqbal Share</span>
                                    <span class="${colorClass(data.partner_share)}">${fmt(data.partner_share)}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span>Farhan Share</span>
                                    <span class="${colorClass(data.partner_share)}">${fmt(data.partner_share)}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Capital Adjustments -->
                        <div style="background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 1rem; margin-top: 0.5rem; border-left: 3px solid #f59e0b;">
                            <h4 style="color: #f59e0b; margin-bottom: 0.8rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px;">
                                <i class="fa-solid fa-scale-balanced" style="margin-right:5px;"></i> Capital Adjustments
                            </h4>
                            <div style="font-size: 0.85rem; color: #ccc; margin-bottom: 0.5rem;">
                                <em>(Reimbursement for personal deposits)</em>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                                <div style="display: flex; justify-content: space-between;">
                                    <span>Kaleel Adj.</span>
                                    <span class="${colorClass(data.capital_adjustments.kaleel)}">
                                        ${data.capital_adjustments.kaleel > 0 ? '+' : ''}${fmt(data.capital_adjustments.kaleel)}
                                    </span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span>Iqbal Adj.</span>
                                    <span class="${colorClass(data.capital_adjustments.iqbal)}">
                                        ${data.capital_adjustments.iqbal > 0 ? '+' : ''}${fmt(data.capital_adjustments.iqbal)}
                                    </span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span>Farhan Adj.</span>
                                    <span class="${colorClass(data.capital_adjustments.farhan)}">
                                        ${data.capital_adjustments.farhan > 0 ? '+' : ''}${fmt(data.capital_adjustments.farhan)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- Final Settlement -->
                        <div style="background: rgba(16, 185, 129, 0.1); border-radius: 8px; padding: 1rem; margin-top: 0.5rem; border: 1px solid rgba(16, 185, 129, 0.3);">
                            <h4 style="color: #4ade80; margin-bottom: 0.8rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 1px; text-align: center;">
                                <i class="fa-solid fa-money-bill-wave" style="margin-right:5px;"></i> Final Take Home
                            </h4>
                            <div style="display: flex; flex-direction: column; gap: 0.8rem;">
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 5px;">
                                    <span style="font-size: 1.1rem; font-weight: 500;">Kaleel</span>
                                    <span style="font-size: 1.1rem; font-weight: 600;" class="${colorClass(data.final_payouts.kaleel)}">${fmt(data.final_payouts.kaleel)}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed rgba(255,255,255,0.1); padding-bottom: 5px;">
                                    <span style="font-size: 1.1rem; font-weight: 500;">Iqbal</span>
                                    <span style="font-size: 1.1rem; font-weight: 600;" class="${colorClass(data.final_payouts.iqbal)}">${fmt(data.final_payouts.iqbal)}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span style="font-size: 1.1rem; font-weight: 500;">Farhan</span>
                                    <span style="font-size: 1.1rem; font-weight: 600;" class="${colorClass(data.final_payouts.farhan)}">${fmt(data.final_payouts.farhan)}</span>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            `;
        } catch (err) { console.error(err); }
    }

    window.editHimaShare = function (e) {
        if (e) e.stopPropagation();
        const current = document.getElementById('currentHimaPercentDisplay').dataset.value;
        document.getElementById('editHimaPercent').value = current;
        document.getElementById('autoFarmPercent').textContent = 100 - parseFloat(current);
        showModal(document.getElementById('himaPercentModal'));
    };

    document.getElementById('editHimaPercent').oninput = function () {
        const val = parseFloat(this.value) || 0;
        document.getElementById('autoFarmPercent').textContent = 100 - val;
    };

    window.saveHimaPercent = async function () {
        const val = parseFloat(document.getElementById('editHimaPercent').value);
        if (isNaN(val) || val < 0 || val > 100) return alert('Invalid Percentage');

        try {
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hima_percent: val })
            });
            if (res.ok) {
                hideModals();
                loadProfit();
            } else {
                alert('Failed to update ratio');
            }
        } catch (e) { console.error(e); }
    };

    // --- Utils ---
    function showModal(m) {
        m.classList.add('show');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling
    }

    function hideModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
        document.body.style.overflow = ''; // Restore background scrolling
    }

    // Exposed for inline call
    window.openAddPayableModal = function (e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        document.getElementById('payableName').value = '';
        document.getElementById('payableAmount').value = '';
        showModal(document.getElementById('payableModal'));
    }

    async function createPayable() {
        if (!currentBatch) return;
        const name = document.getElementById('payableName').value;
        const amount = cleanNum(document.getElementById('payableAmount').value);

        if (!name || isNaN(amount)) {
            alert('Please enter a valid name and amount');
            return;
        }

        const formData = new FormData();
        formData.append('batch_id', currentBatch.id);
        formData.append('name', name);
        formData.append('amount', amount);

        const receiptInput = document.getElementById('payableReceipt');
        if (receiptInput && receiptInput.files[0]) {
            formData.append('receipt', receiptInput.files[0]);
        }

        try {
            const res = await fetch(`${API_BASE}/payables`, {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                hideModals();
                loadProfit();
            } else {
                const err = await res.json();
                alert('Error saving: ' + (err.error || 'Unknown error'));
            }
        } catch (e) {
            console.error(e);
            alert('System Error: ' + e.message);
        }
    }
    window.createPayable = createPayable;

    // --- Salary Manager Logic ---
    async function openSettleInterface() {
        if (!currentBatch) return;
        try {
            // 1. Fetch Data
            const [resExp, resWork] = await Promise.all([
                fetch(`${API_BASE}/batches/${currentBatch.id}/expenses`),
                fetch(`${API_BASE}/workers`)
            ]);
            const expenses = await resExp.json();
            const workers = await resWork.json();

            // 2. Init Dropdown
            const options = workers.map(w => ({ label: w.name, value: w.id }));
            options.unshift({ label: 'Choose Worker...', value: '' });

            const onWorkerSelect = (val) => {
                const wid = parseInt(val);
                if (!wid) {
                    document.getElementById('settleAdvances').value = '0.00';
                    window.updateSettleBalance();
                    return;
                }

                // Calculate Total Advances for this worker
                // Advances = is_advance: true
                // Robust check: is_advance might be 1, true, or 'true' vs 0, false, null
                const workerExpenses = expenses.filter(e => e.worker_id == wid);
                console.log(`[SETTLE DEBUG] Worker ID: ${wid}. Total Expenses: ${workerExpenses.length}`);

                const advancesList = workerExpenses.filter(e => e.is_advance || e.is_advance === 1 || e.is_advance === 'true');
                console.log(`[SETTLE DEBUG] Advances Found: ${advancesList.length}`, advancesList);

                // DEBUG ALERT FOR USER
                // if (workerExpenses.length > 0 && advancesList.length === 0) {
                //    alert(`Debug: For Worker ID ${wid}, found ${workerExpenses.length} expenses but 0 advances. Data check required.`);
                // }

                const adv = advancesList.reduce((sum, e) => sum + e.total, 0);

                document.getElementById('settleAdvances').value = adv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                window.updateSettleBalance();
            };

            initCustomDropdown('settleWorkerSelectContainer', options, onWorkerSelect);

            showModal(document.getElementById('settleModal'));
        } catch (e) { console.error(e); }
    }

    async function confirmSettlement() {
        const workerContainer = document.getElementById('settleWorkerSelectContainer');
        const workerId = workerContainer ? workerContainer.dataset.value : null;
        const balanceVal = document.getElementById('settleBalance').textContent; // String with commas?
        const balance = cleanNum(balanceVal);

        const totalAgreed = cleanNum(document.getElementById('settleTotalSalary').value);
        const advances = cleanNum(document.getElementById('settleAdvances').value);
        const ref = document.getElementById('settleRef').value || 'SETTLE';

        if (!workerId || !totalAgreed) {
            alert('Please select a worker and enter the agreed salary.');
            return;
        }

        // Payload Logic:
        // We want Profit Calculator to see the FULL COST (Agreed Salary).
        // We want the Settlement Table to show Agreed | Advance | Paid.
        // We will store:
        // total = Agreed Amount (So Profit sees full cost).
        // unit_price = Advances Amount (Hack to store metadata).
        // qty = 1
        // ref_no = 'SETTLEMENT-' + ref

        const formData = new FormData();
        formData.append('batch_id', currentBatch.id);
        formData.append('category', 'Labour');
        formData.append('date', today);
        formData.append('ref_no', 'SETTLEMENT');
        formData.append('subject', `Salary Settlement (${ref})`);
        formData.append('qty', 1);
        formData.append('unit_price', advances.toString());
        formData.append('total', totalAgreed.toString());
        formData.append('worker_id', workerId);
        formData.append('is_advance', 'false');

        const receiptInput = document.getElementById('settleReceipt');
        if (receiptInput && receiptInput.files[0]) {
            formData.append('receipt', receiptInput.files[0]);
        }

        try {
            const res = await fetch(`${API_BASE}/expenses`, {
                method: 'POST',
                body: formData
            });
            if (res.ok) {
                hideModals();
                loadExpenses();
                loadProfit();
                if (receiptInput) receiptInput.value = '';
                alert('Settlement Recorded Successfully');
            } else {
                alert('Error recording settlement');
            }
        } catch (err) { console.error(err); }
    }


    // --- Custom Helper: Animated Dropdown ---
    function initCustomDropdown(containerId, options, onSelectCallback, initialValue = null) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.className = 'custom-dropdown-container';

        // 1. Determine Selection
        let selected = options[0];
        if (initialValue !== null) {
            // loose equality for '1' vs 1
            const found = options.find(o => o.value == initialValue);
            if (found) selected = found;
        }

        // Set initial data value for Form reading
        if (selected) container.dataset.value = selected.value;

        const trigger = document.createElement('div');
        trigger.className = 'custom-dropdown-trigger';
        trigger.innerHTML = `
            <span class="selected-text">${selected ? selected.label : 'Select...'}</span>
            <i class="fa-solid fa-chevron-down custom-arrow"></i>
        `;

        const optionsList = document.createElement('div');
        optionsList.className = 'custom-dropdown-options';

        options.forEach(opt => {
            const optDiv = document.createElement('div');
            optDiv.className = `custom-option ${selected && opt.value === selected.value ? 'selected' : ''}`;
            optDiv.textContent = opt.label;

            optDiv.onclick = (e) => {
                e.stopPropagation(); // Prevent bubbling to container click
                // Update State
                selected = opt;
                container.dataset.value = opt.value; // Store value in DOM
                trigger.querySelector('.selected-text').textContent = opt.label;

                // Visual Updates
                optionsList.querySelectorAll('.custom-option').forEach(el => el.classList.remove('selected'));
                optDiv.classList.add('selected');

                // Close
                closeMenu();

                // Callback
                if (onSelectCallback) onSelectCallback(opt.value);
            };
            optionsList.appendChild(optDiv);
        });

        // 2. Logic
        const toggleMenu = () => {
            const isOpen = trigger.classList.contains('open');
            if (isOpen) closeMenu();
            else openMenu();
        };

        const openMenu = () => {
            trigger.classList.add('open');
            optionsList.classList.add('show');
        };

        const closeMenu = () => {
            trigger.classList.remove('open');
            optionsList.classList.remove('show');
        };

        trigger.onclick = (e) => {
            e.stopPropagation();
            toggleMenu();
        };

        // Click outside to close
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) {
                closeMenu();
            }
        });

        container.innerHTML = '';
        container.appendChild(trigger);
        container.appendChild(optionsList);
    }

    async function initWorkerDropdown(containerId, preSelectedId = null) {
        try {
            const res = await fetch(`${API_BASE}/workers`);
            const workers = await res.json();

            const options = workers.map(w => ({
                label: w.name + (w.active ? '' : ' (Inactive)'),
                value: w.id
            }));

            options.unshift({ label: 'Select Worker...', value: '' });

            initCustomDropdown(containerId, options, null, preSelectedId);
        } catch (e) { console.error('Error loading workers dropdown:', e); }
    }
    // --- Bank Balance & Deposits Logic ---
    async function loadBalance() {
        if (!currentBatch) return;

        try {
            // Refresh batch info to get opening balance provider
            const bRes = await fetch(`${API_BASE}/batches/${currentBatch.id}`);
            if (bRes.ok) {
                currentBatch = await bRes.json();
            }

            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}/summary`);
            const summary = await res.json();

            const totalFunds = summary.total_funds || 0;
            const farmExp = summary.farm_expenses || 0;
            const advances = summary.total_advances || 0;
            const combinedFarmExpenses = farmExp + advances;
            const remaining = totalFunds - combinedFarmExpenses;

            const tfEl = document.getElementById('displayTotalFunds');
            if (tfEl) tfEl.textContent = totalFunds.toLocaleString('en-US', { minimumFractionDigits: 2 });

            const farmEl = document.getElementById('displayFarmExpenses');
            if (farmEl) farmEl.textContent = combinedFarmExpenses.toLocaleString('en-US', { minimumFractionDigits: 2 });

            const remainingEl = document.getElementById('displayRemainingBalance');
            if (remainingEl) {
                remainingEl.textContent = remaining.toLocaleString('en-US', { minimumFractionDigits: 2 });
                if (remaining < 0) {
                    remainingEl.style.color = '#ef4444';
                } else {
                    remainingEl.style.color = '#10b981';
                }
            }

            // Also reload the detailed table
            if (typeof loadDepositsTable === 'function') {
                loadDepositsTable();
            }

        } catch (e) { console.error(e); }
    }

    // Expose for index.html calls
    window.loadBalance = loadBalance;

    // Logic moved to top

    // --- Bank Balance Logic ---
    async function loadDepositsTable() {
        const body = document.getElementById('depositsTableBody');
        if (!body) return;
        body.innerHTML = '<tr><td colspan="7" class="text-center">Loading...</td></tr>';

        try {
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}/deposits`);
            currentDeposits = await res.json(); // Global Store
            const deposits = currentDeposits;

            body.innerHTML = '';

            if (deposits.length === 0 && (!currentBatch || currentBatch.opening_balance === 0)) {
                body.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 2rem; color: var(--text-secondary);">No funds recorded.</td></tr>';
                return;
            }

            deposits.forEach(d => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${d.ref_no || '-'}</td>
                    <td>
                        <span class="badge ${d.deposited_by === 'Farm' ? 'badge-farm' :
                        d.deposited_by === 'Kaleel' ? 'badge-hima' :
                            d.deposited_by === 'Iqbal' ? 'badge-iqbal' :
                                d.deposited_by === 'Farhan' ? 'badge-farhan' : ''
                    }">${d.deposited_by || '-'}</span>
                    </td>
                    <td>${d.date}</td>
                    <td>${d.description || '-'}</td>
                    <td class="text-right" style="color:#4ade80; font-weight:600;">${d.amount.toLocaleString()}</td>
                    <td style="text-align:center;">
                        ${d.receipt_url ? `<button class="btn-icon" onclick="window.viewReceipt('${d.receipt_url}')" title="View Receipt"><i class="fa-solid fa-receipt" style="color:var(--accent);"></i></button>` : '-'}
                    </td>
                    <td>
                        <button class="btn-icon" onclick="window.editDeposit(${d.id})" title="Edit" style="color:var(--text-secondary); margin-right:5px;">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button class="btn-icon text-red" onclick="window.deleteDeposit(${d.id})" title="Delete">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                `;
                body.appendChild(tr);
            });
        } catch (e) {
            body.innerHTML = '<tr><td colspan="7" class="text-center text-red">Error loading records</td></tr>';
        }
    }

    // --- Global Exposed Functions ---


    // Removed legacy saveOpeningBalanceModal (now defined globally above)

    // --- Profit Estimator Logic ---
    // --- Helper for Comma Formatting ---
    // --- Helper for Robust Numeric Parsing ---
    function cleanNum(val) {
        if (!val) return 0;
        let str = String(val).replace(/[^0-9.-]/g, '');
        return parseFloat(str) || 0;
    }

    function formatCommaInput(el) {
        if (!el) return;

        // 1. Get current cursor position and count commas before it
        let cursor = el.selectionStart;
        let originalVal = el.value;
        let commasBefore = (originalVal.slice(0, cursor).match(/,/g) || []).length;

        // 2. Format
        let raw = originalVal.replace(/[^0-9.-]/g, '');

        // Allow typing just "-" or empty
        if (raw === '' || raw === '-') {
            el.value = raw;
            return;
        }

        const parts = raw.split('.');
        let integerPart = parts[0];
        let decimalPart = parts.length > 1 ? parts.slice(1).join('') : null;

        let formattedInt = (parseFloat(integerPart) || 0).toLocaleString();

        // Handles "0." case
        if (integerPart === '' && decimalPart !== null) formattedInt = '0';
        // Handles "00" -> "0"
        if (integerPart.match(/^0\d/)) formattedInt = (parseFloat(integerPart) || 0).toLocaleString();

        let finalVal = formattedInt;
        if (decimalPart !== null) {
            finalVal += '.' + decimalPart;
        }

        // 3. Update Value
        el.value = finalVal;

        // 4. Restore Cursor
        // Count new commas before the "logical" cursor position
        // This is complex because formatting changes length.
        // Simple heuristic: Count non-comma chars before cursor in original, find that position in new.

        let digitsBefore = originalVal.slice(0, cursor).replace(/,/g, '').length;
        let newCursor = 0;
        let digitsSeen = 0;

        for (let i = 0; i < finalVal.length; i++) {
            if (finalVal[i] !== ',') digitsSeen++;
            if (digitsSeen > digitsBefore) break; // Should be exact
            newCursor = i + 1;
            if (digitsSeen === digitsBefore) {
                // Special check if we are exactly after digits
                // If original had a comma here we might need to skip?
                // Actually if we just placed the cursor after the Nth digit, good.
                break;
            }
        }

        // Specific case: if we were deleting a comma, we might want to move back?
        // But for now, just placing after the same number of digits is reliable.
        el.setSelectionRange(newCursor, newCursor);

        // window.calculateEstimation(); // Decoupled
    }

    function addExtraExpense() {
        const container = document.getElementById('extraExpensesContainer');
        const div = document.createElement('div');
        div.className = 'extra-expense-row';
        div.innerHTML = `
            <input type="text" placeholder="Description" class="estimate-input" style="text-align:left; flex:1; width:auto;" oninput="window.calculateEstimation(); window.debouncedSave()">
            <input type="text" placeholder="0" class="estimate-input extra-exp-val" oninput="window.formatCommaInput(this); window.calculateEstimation(); window.debouncedSave();" style="width:120px;">
            <button class="rem-btn" onclick="this.parentElement.remove(); window.calculateEstimation(); window.debouncedSave();">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        container.appendChild(div);
        window.calculateEstimation();
        window.debouncedSave();
    }

    function addHimaPayable() {
        const container = document.getElementById('himaPayablesContainer');
        const div = document.createElement('div');
        div.className = 'payable-row';
        div.innerHTML = `
            <input type="text" placeholder="Description (e.g. Transport)" class="estimate-input" style="text-align:left; flex:1; width:auto;" oninput="window.calculateEstimation(); window.debouncedSave()">
            <input type="text" placeholder="0" class="estimate-input payable-val" oninput="window.formatCommaInput(this); window.calculateEstimation(); window.debouncedSave();" style="width:120px;">
            <button class="rem-btn" onclick="this.parentElement.remove(); window.calculateEstimation(); window.debouncedSave();">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        container.appendChild(div);
        window.calculateEstimation();
        window.debouncedSave();
    }

    function resetEstimateUI() {
        console.log('Resetting Estimator UI to 0');
        const ids = [
            'estBirds', 'estWeight', 'estPrice',
            'estChickQty', 'estChickUnitPrice', 'estChickCost',
            'estMedicine', 'estFeedBags', 'estFeedPrice',
            'estLabour', 'estFoodLabour', 'estSawDust', 'estWood', 'estOtherCost'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "0";
        });

        const extraContainer = document.getElementById('extraExpensesContainer');
        if (extraContainer) extraContainer.innerHTML = '';

        const payableContainer = document.getElementById('himaPayablesContainer');
        if (payableContainer) payableContainer.innerHTML = '';

        window.calculateEstimation();
    }

    function initProfitEstimator() {
        console.log('initProfitEstimator starting for batch:', currentBatch?.id);
        if (!currentBatch) {
            console.error('initProfitEstimator: currentBatch is missing!');
            return;
        }

        // 1. Fetch saved estimate
        const url = `${API_BASE}/batches/${currentBatch.id}/estimate`;
        console.log('Fetching estimate from:', url);

        fetch(url)
            .then(res => {
                if (res.status === 404) return null;
                return res.ok ? res.json() : null;
            })
            .then(data => {
                if (data && data.batch_id) {
                    console.log('Loading existing estimate data:', data);
                    loadEstimate(data);
                } else {
                    console.log('No saved estimate found. Resetting UI to 0.');
                    resetEstimateUI();
                }
            })
            .catch(e => {
                console.error('Error loading estimate:', e);
                resetEstimateUI();
            });

        const inputs = [
            'estBirds', 'estWeight', 'estPrice',
            'estChickQty', 'estChickUnitPrice', 'estMedicine', 'estFeedBags', 'estFeedPrice',
            'estLabour', 'estFoodLabour', 'estSawDust', 'estWood', 'estOtherCost'
        ];

        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.oninput = function () {
                    window.formatCommaInput(this);
                    window.calculateEstimation(); // Explicit call
                    window.debouncedSave();
                };
            } else {
                console.warn('Estimator input not found in DOM:', id);
            }
        });
    }

    function loadEstimate(data) {
        // Static fields
        const mapping = {
            'estBirds': data.birds,
            'estWeight': data.weight,
            'estPrice': data.price,
            'estChickQty': data.chick_qty,
            'estChickUnitPrice': data.chick_unit_price,
            'estChickCost': data.chick_cost,
            'estMedicine': data.medicine,
            'estFeedBags': data.feed_bags,
            'estFeedPrice': data.feed_price,
            'estLabour': data.labour,
            'estFoodLabour': data.food_labour,
            'estSawDust': data.saw_dust,
            'estWood': data.wood,
            'estOtherCost': data.other_cost
        };

        for (const [id, val] of Object.entries(mapping)) {
            const el = document.getElementById(id);
            if (el) {
                const numericVal = Number(val) || 0;
                el.value = numericVal.toLocaleString();
            }
        }

        // Dynamic Extra Expenses
        const extraContainer = document.getElementById('extraExpensesContainer');
        extraContainer.innerHTML = '';
        if (data.extra_expenses) {
            data.extra_expenses.forEach(item => {
                const div = document.createElement('div');
                div.className = 'extra-expense-row';
                div.innerHTML = `
                    <input type="text" placeholder="Description" class="estimate-input" value="${item.desc || ''}" style="text-align:left; flex:1; width:auto;" oninput="window.calculateEstimation(); window.debouncedSave()">
                    <input type="text" placeholder="0" class="estimate-input extra-exp-val" value="${(item.val || 0).toLocaleString()}" oninput="window.formatCommaInput(this); window.calculateEstimation(); window.debouncedSave();" style="width:120px;">
                    <button class="rem-btn" onclick="this.parentElement.remove(); window.calculateEstimation(); window.debouncedSave();">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;
                extraContainer.appendChild(div);
            });
        }

        // Hima Payables
        const himaContainer = document.getElementById('himaPayablesContainer');
        himaContainer.innerHTML = '';
        if (data.hima_payables) {
            data.hima_payables.forEach(item => {
                const div = document.createElement('div');
                div.className = 'payable-row';
                div.innerHTML = `
                    <input type="text" placeholder="Description" class="estimate-input" value="${item.desc || ''}" style="text-align:left; flex:1; width:auto;" oninput="window.calculateEstimation(); window.debouncedSave()">
                    <input type="text" placeholder="0" class="estimate-input payable-val" value="${(item.val || 0).toLocaleString()}" oninput="window.formatCommaInput(this); window.calculateEstimation(); window.debouncedSave();" style="width:120px;">
                    <button class="rem-btn" onclick="this.parentElement.remove(); window.calculateEstimation(); window.debouncedSave();">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                `;
                himaContainer.appendChild(div);
            });
        }

        calculateEstimation();
    }

    function debouncedSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveEstimate, 1000);
    }

    async function saveEstimate() {
        console.log('saveEstimate triggered');
        if (!currentBatch) return;

        const getNum = (id) => {
            const el = document.getElementById(id);
            return el ? cleanNum(el.value) : 0;
        };

        const extraExps = [];
        document.querySelectorAll('.extra-expense-row').forEach(row => {
            const inputs = row.querySelectorAll('input');
            if (inputs.length >= 2) {
                extraExps.push({
                    desc: inputs[0].value,
                    val: cleanNum(inputs[1].value)
                });
            }
        });

        const himaPayables = [];
        document.querySelectorAll('.payable-row').forEach(row => {
            const inputs = row.querySelectorAll('input');
            if (inputs.length >= 2) {
                himaPayables.push({
                    desc: inputs[0].value,
                    val: cleanNum(inputs[1].value)
                });
            }
        });

        const payload = {
            birds: getNum('estBirds'),
            weight: getNum('estWeight'),
            price: getNum('estPrice'),
            chick_qty: getNum('estChickQty'),
            chick_unit_price: getNum('estChickUnitPrice'),
            chick_cost: getNum('estChickCost'),
            medicine: getNum('estMedicine'),
            feed_bags: getNum('estFeedBags'),
            feed_price: getNum('estFeedPrice'),
            labour: getNum('estLabour'),
            food_labour: getNum('estFoodLabour'),
            saw_dust: getNum('estSawDust'),
            wood: getNum('estWood'),
            other_cost: getNum('estOtherCost'),
            extra_expenses: extraExps,
            hima_payables: himaPayables
        };

        console.log('Payload:', payload);

        try {
            const res = await fetch(`${API_BASE}/batches/${currentBatch.id}/estimate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                console.log('Saved Estimate successfully');
            } else {
                console.error('Failed to save estimate', res.status);
            }
        } catch (e) {
            console.error('Save failed:', e);
        }
    }

    function calculateEstimation() {
        if (!currentBatch) {
            console.warn('calculateEstimation: No currentBatch');
            return;
        }

        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? cleanNum(el.value) : 0;
        };

        // Sales Details
        const birds = getVal('estBirds');
        const weight = getVal('estWeight');
        const price = getVal('estPrice');

        // Chick Cost Calculation
        const chickQty = getVal('estChickQty');
        const chickUnitPrice = getVal('estChickUnitPrice');
        const chickCostTotal = chickQty * chickUnitPrice;

        const chickCostEl = document.getElementById('estChickCost');
        if (chickCostEl) {
            chickCostEl.value = chickCostTotal.toLocaleString();
        }

        // Static Expenses
        const chickCost = chickCostTotal;
        const medicine = getVal('estMedicine');
        const feedBags = getVal('estFeedBags');
        const feedPrice = getVal('estFeedPrice');
        const labour = getVal('estLabour');
        const foodLabour = getVal('estFoodLabour');
        const sawDust = getVal('estSawDust');
        const wood = getVal('estWood');
        const otherCost = getVal('estOtherCost');

        // Dynamic Extra Expenses
        let extraExpSum = 0;
        document.querySelectorAll('.extra-exp-val').forEach(input => {
            extraExpSum += cleanNum(input.value);
        });

        // Calculations
        const totalSales = birds * weight * price;
        const feedCost = feedBags * feedPrice;
        const totalExpenses = chickCost + medicine + feedCost + labour + foodLabour + sawDust + wood + otherCost + extraExpSum;
        const netProfit = totalSales - totalExpenses;

        // Sharing Logic
        let himaPercent, farmPercent;
        let originalHimaShare, originalFarmShare;

        if (netProfit > 0) {
            himaPercent = currentBatch.hima_percent || 0;
            farmPercent = 100 - himaPercent;
            originalHimaShare = netProfit * (himaPercent / 100);
            originalFarmShare = netProfit * (farmPercent / 100);
        } else {
            himaPercent = 25;
            farmPercent = 75;
            originalHimaShare = netProfit * 0.25;
            originalFarmShare = netProfit * 0.75;
        }

        // Hima Payables Adjustment
        let payablesToHimaSum = 0;
        document.querySelectorAll('.payable-val').forEach(input => {
            payablesToHimaSum += cleanNum(input.value);
        });

        const finalHimaShare = originalHimaShare + payablesToHimaSum;
        const finalFarmShare = originalFarmShare - payablesToHimaSum;

        // Update UI
        const setT = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val.toLocaleString(undefined, { maximumFractionDigits: 0 });
        };

        setT('resTotalSales', totalSales);
        setT('resTotalExpenses', totalExpenses);
        const profitEl = document.getElementById('resNetProfit');
        if (profitEl) {
            profitEl.textContent = netProfit.toLocaleString(undefined, { maximumFractionDigits: 0 });
            profitEl.className = netProfit >= 0 ? 'text-gold' : 'text-red';
        }

        setT('resHimaPercent', himaPercent);
        setT('resFarmPercent', farmPercent);
        setT('resHimaShare', finalHimaShare);
        setT('resFarmShare', finalFarmShare);
    }



    async function submitDepositModal() {
        const ref = document.getElementById('modalDepositRef').value;
        const by = document.getElementById('modalDepositBy').value;
        const date = document.getElementById('modalDepositDate').value;
        const amount = cleanNum(document.getElementById('modalDepositAmount').value);
        const desc = document.getElementById('modalDepositDesc').value;

        if (!date || isNaN(amount)) return alert('Enter date and valid amount');

        const formData = new FormData();
        formData.append('batch_id', currentBatch.id);
        formData.append('ref_no', ref);
        formData.append('deposited_by', by);
        formData.append('date', date);
        formData.append('amount', amount);
        formData.append('description', desc);

        const receiptInput = document.getElementById('modalDepositReceipt');
        if (receiptInput && receiptInput.files[0]) {
            formData.append('receipt', receiptInput.files[0]);
        }

        try {
            const method = editingDepositId ? 'PUT' : 'POST';
            const url = editingDepositId ? `${API_BASE}/deposits/${editingDepositId}` : `${API_BASE}/deposits`;

            const res = await fetch(url, {
                method: method,
                body: formData
            });
            if (res.ok) {
                alert(editingDepositId ? 'Deposit updated' : 'Deposit added');

                // Reset Edit Mode
                editingDepositId = null;
                document.getElementById('depositModalSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Add Deposit';

                // Clear fields
                document.getElementById('modalDepositAmount').value = '';
                document.getElementById('modalDepositDesc').value = '';
                document.getElementById('modalDepositRef').value = '';
                if (receiptInput) receiptInput.value = '';

                loadBalance(); // Refreshes dashboard and table
            } else {
                const err = await res.json();
                alert('Deposit error: ' + (err.error || 'Unknown'));
            }
        } catch (e) { console.error(e); }
    }

}); // Closing DOMContentLoaded

// Global Toggle Function for Accordion
window.toggleAccordion = function (element) {
    const card = element.parentElement;
    card.classList.toggle('active');
};


// --- Settings & User Management ---
// --- Settings & User Management ---
window.openSettingsModal = function () {
    // Legacy name kept for HTML compatibility, now acts as page switcher
    // Close dropdown
    const dd = document.getElementById('userDropdown');
    if (dd) dd.classList.add('hidden');

    // Hide other views
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));

    // Show settings view
    const savedView = document.getElementById('settingsView');
    if (savedView) {
        savedView.classList.remove('hidden');
        window.scrollTo(0, 0); // Reset scroll to top
        window.loadUsers();
    }
};

window.toggleSettingsSection = function (sectionId) {
    const content = document.getElementById(sectionId);
    if (!content) return;

    // Toggle current
    const isVisible = content.style.display !== 'none';
    content.style.display = isVisible ? 'none' : 'block';

    // Update Icon
    const header = content.previousElementSibling;
    const chevron = header.querySelector('.fa-chevron-down');
    if (chevron) {
        chevron.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
        chevron.style.transition = '0.3s';
    }
};

window.loadUsers = async function () {
    try {
        const res = await fetch(`${API_BASE}/users`);
        const users = await res.json();
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;

        tbody.innerHTML = users.map(user => `
            <tr>
                <td style="color: var(--text-primary); font-weight: 500;">${user.name || '---'}</td>
                <td style="color: var(--text-secondary);">${user.email}</td>
                <td>
                    <span class="badg-${user.is_active ? 'green' : 'red'}" style="font-size: 0.75rem; padding: 2px 8px;">
                        ${user.is_active ? 'Active' : 'Disabled'}
                    </span>
                </td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="window.openEditUserModal(${user.id}, '${user.name || ''}', '${user.email}')" 
                                style="background:none; border:none; color:var(--text-secondary); cursor:pointer;" title="Edit">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <label class="switch" title="${user.is_active ? 'Disable' : 'Enable'}">
                            <input type="checkbox" ${user.is_active ? 'checked' : ''} onchange="window.toggleUserStatus(${user.id}, this)">
                            <span class="slider"></span>
                        </label>
                        <button onclick="window.deleteUser(${user.id})" 
                                style="background:none; border:none; color:#f87171; cursor:pointer;" title="Delete">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Failed to load users:', e);
    }
};

window.openAddUserModal = function () {
    document.getElementById('userModalTitle').textContent = 'Add New User';
    document.getElementById('editUserId').value = '';
    document.getElementById('userFullName').value = '';
    document.getElementById('userEmail').value = '';
    document.getElementById('userTempPassword').value = '';
    document.getElementById('tempPasswordGroup').style.display = 'block';
    document.getElementById('userFormSubmitBtn').textContent = 'Create User';
    document.getElementById('userFormModal').classList.add('show');
};

window.openEditUserModal = function (id, name, email) {
    document.getElementById('userModalTitle').textContent = 'Edit User';
    document.getElementById('editUserId').value = id;
    document.getElementById('userFullName').value = name;
    document.getElementById('userEmail').value = email;
    document.getElementById('tempPasswordGroup').style.display = 'none';
    document.getElementById('userFormSubmitBtn').textContent = 'Update User';
    document.getElementById('userFormModal').classList.add('show');
};

window.submitUserForm = async function () {
    const id = document.getElementById('editUserId').value;
    const name = document.getElementById('userFullName').value.trim();
    const email = document.getElementById('userEmail').value.trim();
    const password = document.getElementById('userTempPassword').value;

    if (!email) return alert('Email is required');
    if (!id && !password) return alert('Password is required for new users');

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_BASE}/users/${id}` : `${API_BASE}/users`;
    const payload = { name, email };
    if (!id) payload.password = password;

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await res.json();
        if (res.ok) {
            document.getElementById('userFormModal').classList.remove('show');
            window.loadUsers();
        } else {
            alert(result.error || 'Operation failed');
        }
    } catch (e) {
        console.error(e);
        alert('Network error');
    }
};

window.toggleUserStatus = async function (id, checkbox) {
    const originalState = !checkbox.checked;
    if (!confirm('Are you sure you want to change this user\'s status?')) {
        checkbox.checked = originalState;
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/users/${id}/toggle`, { method: 'PATCH' });
        if (res.ok) {
            window.loadUsers();
        } else {
            const err = await res.json();
            alert(err.error || 'Action failed');
            checkbox.checked = originalState;
        }
    } catch (e) {
        console.error(e);
        checkbox.checked = originalState;
    }
};

window.deleteUser = async function (id) {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
        const res = await fetch(`${API_BASE}/users/${id}`, { method: 'DELETE' });
        if (res.ok) {
            window.loadUsers();
        } else {
            const err = await res.json();
            alert(err.error || 'Delete failed');
        }
    } catch (e) { console.error(e); }
};

window.requestChangePasswordOtp = async function () {
    const btn = document.getElementById('reqChangeOtpBtn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/change-password/request-otp`, { method: 'POST' });
        const data = await res.json();

        if (res.ok) {
            document.getElementById('changePassStep1').style.display = 'none';
            document.getElementById('changePassStep2').style.display = 'block';
            alert('OTP sent to your email.');
        } else {
            alert(data.error || 'Failed to send OTP');
        }
    } catch (e) {
        console.error(e);
        alert('Network error');
    }
    btn.innerHTML = originalText;
    btn.disabled = false;
};

window.resetChangePassUI = function () {
    document.getElementById('changePassStep2').style.display = 'none';
    document.getElementById('changePassStep1').style.display = 'block';
    document.getElementById('changePassOtp').value = '';
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('confirmPasswordInput').value = '';
};

window.submitChangePassword = async function () {
    const otp = document.getElementById('changePassOtp').value;
    const newPass = document.getElementById('newPasswordInput').value;
    const confirmPass = document.getElementById('confirmPasswordInput').value;

    if (!otp) return alert('Please enter the OTP sent to your email');
    if (!newPass) return alert('Enter a new password');
    if (newPass !== confirmPass) return alert('Passwords do not match');
    if (newPass.length < 6) return alert('Password must be at least 6 characters');

    try {
        const res = await fetch(`${API_BASE}/change-password/confirm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp: otp, new_password: newPass })
        });

        if (res.ok) {
            alert('Password updated successfully');
            window.resetChangePassUI();
        } else {
            const err = await res.json();
            alert(err.error || 'Update failed');
        }
    } catch (e) { console.error(e); }
};

