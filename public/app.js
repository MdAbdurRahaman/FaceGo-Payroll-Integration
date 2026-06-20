document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let currentEmployee = null;
  let activeState = 'IDLE'; // IDLE, PROFILE, CONFIRM, SUCCESS, ERROR
  let selectedPayoutType = null; // salary, ot, dorm_charge
  let allTransactions = [];
  let allEmployees = [];

  // Timers
  let inactivityTimer = null;
  let warningTimer = null;
  let successCountdownTimer = null;
  const INACTIVITY_LIMIT = 20000; // 20s
  const WARNING_LIMIT = 10; // 10s

  // DOM Elements - Connection & Status
  const connectionStatus = document.getElementById('connection-status');
  const connectionDot = document.getElementById('connection-dot');
  const connectionText = document.getElementById('connection-text');
  const liveClock = document.getElementById('live-clock');
  const currentBreadcrumb = document.getElementById('current-breadcrumb');

  // DOM Elements - Tabs
  const menuItems = document.querySelectorAll('.menu-item');
  const tabContents = document.querySelectorAll('.tab-content');

  // DOM Elements - Kiosk Screens
  const stateIdle = document.getElementById('state-idle');
  const stateProfile = document.getElementById('state-profile');
  const stateConfirm = document.getElementById('state-confirm');
  const stateSuccess = document.getElementById('state-success');
  const stateError = document.getElementById('state-error');

  // DOM Elements - Kiosk Profile Details
  const empName = document.getElementById('emp-name');
  const empId = document.getElementById('emp-id');
  const empDesignation = document.getElementById('emp-designation');
  const empDepartment = document.getElementById('emp-department');
  const empSection = document.getElementById('emp-section');
  const empShift = document.getElementById('emp-shift');
  const empUnit = document.getElementById('emp-unit');
  const scanMetaDevice = document.getElementById('scan-meta-device');

  // DOM Elements - Payout Buttons
  const empSalary = document.getElementById('emp-salary');
  const empOt = document.getElementById('emp-ot');
  const empDorm = document.getElementById('emp-dorm');
  const cardPaySalary = document.getElementById('card-pay-salary');
  const cardPayOt = document.getElementById('card-pay-ot');
  const cardPayDorm = document.getElementById('card-pay-dorm');
  const btnCancelSession = document.getElementById('btn-cancel-session');

  // DOM Elements - Confirm Dialog
  const confPayoutTitle = document.getElementById('conf-payout-title');
  const confAmount = document.getElementById('conf-amount');
  const confEmpName = document.getElementById('conf-emp-name');
  const confEmpId = document.getElementById('conf-emp-id');
  const btnExecutePay = document.getElementById('btn-execute-pay');
  const btnCancelPay = document.getElementById('btn-cancel-pay');
  const paySpinner = document.getElementById('pay-spinner');

  // DOM Elements - Success Screen
  const receiptTxnId = document.getElementById('receipt-txn-id');
  const receiptEmpName = document.getElementById('receipt-emp-name');
  const receiptAmount = document.getElementById('receipt-amount');
  const receiptType = document.getElementById('receipt-type');
  const resetCounter = document.getElementById('reset-counter');
  const btnDonePayout = document.getElementById('btn-done-payout');

  // DOM Elements - Error Screen
  const errorMessage = document.getElementById('error-message');
  const errorScannedId = document.getElementById('error-scanned-id');
  const btnErrorReset = document.getElementById('btn-error-reset');

  // DOM Elements - Inactivity Banner
  const sessionTimeoutBanner = document.getElementById('session-timeout-banner');
  const timeoutSeconds = document.getElementById('timeout-seconds');
  const btnKeepSession = document.getElementById('btn-keep-session');

  // DOM Elements - Filters
  const filterStartDate = document.getElementById('filter-start-date');
  const filterEndDate = document.getElementById('filter-end-date');
  const filterEmpId = document.getElementById('filter-emp-id');
  const filterPayoutType = document.getElementById('filter-payout-type');
  const btnClearFilters = document.getElementById('btn-clear-filters');

  // DOM Elements - Metrics
  const metricTxnCount = document.getElementById('metric-txn-count');
  const metricTotalPaid = document.getElementById('metric-total-paid');
  const metricSalaryPaid = document.getElementById('metric-salary-paid');
  const metricOtPaid = document.getElementById('metric-ot-paid');
  const metricDormPaid = document.getElementById('metric-dorm-paid');

  // DOM Elements - Table Bodies
  const payoutReportBody = document.getElementById('payout-report-body');
  const registryListBody = document.getElementById('registry-list-body');

  // DOM Elements - Employee Register Form
  const regEmpId = document.getElementById('reg-emp-id');
  const regEmpName = document.getElementById('reg-emp-name');
  const regEmpDesig = document.getElementById('reg-emp-desig');
  const regEmpDept = document.getElementById('reg-emp-dept');
  const regEmpSalary = document.getElementById('reg-emp-salary');
  const regEmpOt = document.getElementById('reg-emp-ot');
  const btnRegisterEmployee = document.getElementById('btn-register-employee');

  // DOM Elements - Toast Notifications
  const toastNotification = document.getElementById('toast-notification');
  const toastTitle = document.getElementById('toast-title');
  const toastBody = document.getElementById('toast-body');

  // ==========================================================================
  // SYSTEM CLOCK & FORMATTERS
  // ==========================================================================
  function updateClock() {
    if (liveClock) {
      const now = new Date();
      liveClock.textContent = now.toLocaleTimeString();
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  }

  // Toast Notification Trigger
  function showToast(title, message) {
    toastTitle.textContent = title;
    toastBody.textContent = message;
    toastNotification.style.display = 'flex';
    setTimeout(() => {
      toastNotification.style.display = 'none';
    }, 4000);
  }

  // ==========================================================================
  // TAB NAVIGATION
  // ==========================================================================
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab-target');

      // Update active menu link
      menuItems.forEach(mi => mi.classList.remove('active'));
      item.classList.add('active');

      // Update active content tab
      tabContents.forEach(tc => tc.classList.remove('active'));
      document.getElementById(`tab-${targetTab}`).classList.add('active');

      // Update breadcrumb
      let breadcrumbText = 'FaceGo Kiosk Terminal';
      if (targetTab === 'history') breadcrumbText = 'Payout History Log';
      if (targetTab === 'registry') breadcrumbText = 'ERP Employee Registry';
      currentBreadcrumb.textContent = breadcrumbText;

      // Refresh data
      if (targetTab === 'history') {
        loadTransactions();
      }
      if (targetTab === 'registry') {
        loadEmployees();
      }
    });
  });

  // ==========================================================================
  // STATE MACHINE TRANSITIONS (KIOSK)
  // ==========================================================================
  function transitionTo(stateName) {
    console.log(`Transitioning Kiosk: ${activeState} -> ${stateName}`);
    activeState = stateName;

    // Reset UI visibility
    [stateIdle, stateProfile, stateConfirm, stateSuccess, stateError].forEach(el => {
      el.classList.remove('active');
    });

    // Clear timers
    clearTimeout(inactivityTimer);
    clearInterval(warningTimer);
    clearTimeout(successCountdownTimer);
    sessionTimeoutBanner.style.display = 'none';

    switch (stateName) {
      case 'IDLE':
        stateIdle.classList.add('active');
        currentEmployee = null;
        selectedPayoutType = null;
        if (socket && socket.connected) {
          socket.emit('clear-active-scan');
        }
        break;

      case 'PROFILE':
        stateProfile.classList.add('active');
        startInactivityTimer();
        break;

      case 'CONFIRM':
        stateConfirm.classList.add('active');
        startInactivityTimer();
        break;

      case 'SUCCESS':
        stateSuccess.classList.add('active');
        startSuccessAutoReset(4);
        break;

      case 'ERROR':
        stateError.classList.add('active');
        break;
    }
  }

  // ==========================================================================
  // INACTIVITY TIMEOUT SECURITY FLOW
  // ==========================================================================
  function startInactivityTimer() {
    clearTimeout(inactivityTimer);
    clearInterval(warningTimer);
    sessionTimeoutBanner.style.display = 'none';

    inactivityTimer = setTimeout(() => {
      // Show inactivity banner
      sessionTimeoutBanner.style.display = 'flex';
      let countdown = WARNING_LIMIT;
      timeoutSeconds.textContent = countdown;

      warningTimer = setInterval(() => {
        countdown--;
        timeoutSeconds.textContent = countdown;

        if (countdown <= 0) {
          clearInterval(warningTimer);
          sessionTimeoutBanner.style.display = 'none';
          console.warn('Kiosk session timed out due to inactivity.');
          transitionTo('IDLE');
        }
      }, 1000);

    }, INACTIVITY_LIMIT);
  }

  btnKeepSession.addEventListener('click', () => {
    startInactivityTimer();
  });

  // ==========================================================================
  // SOCKET.IO REAL-TIME LISTENING
  // ==========================================================================
  const socket = io();

  socket.on('connect', () => {
    console.log('Connected to server via WebSocket.');
    connectionDot.className = 'conn-status-dot online';
    connectionText.textContent = 'Live Connected';
  });

  socket.on('disconnect', () => {
    console.warn('Disconnected from server.');
    connectionDot.className = 'conn-status-dot offline';
    connectionText.textContent = 'Reconnecting...';
  });

  // Receive Face Scan Event
  socket.on('employee-scanned', (data) => {
    console.log('Real-time scan received:', data);
    currentEmployee = data.employee;

    // Fill Kiosk profile details
    empName.textContent = currentEmployee.name;
    empId.textContent = currentEmployee.id;
    empDesignation.textContent = currentEmployee.designation;
    empDepartment.textContent = currentEmployee.department;
    empSection.textContent = currentEmployee.section || 'General';
    empShift.textContent = currentEmployee.shift || 'Day';
    empUnit.textContent = currentEmployee.unit || 'Unit-1';

    empSalary.textContent = formatCurrency(currentEmployee.salary);
    empOt.textContent = formatCurrency(currentEmployee.ot);
    empDorm.textContent = formatCurrency(currentEmployee.dorm_charge || 0);

    let timeFormatted = '';
    try {
      const parsedDate = new Date(data.meta.time);
      if (!isNaN(parsedDate.getTime())) {
        timeFormatted = parsedDate.toLocaleTimeString();
      } else {
        const compatDate = new Date(data.meta.time.replace(/-/g, '/'));
        if (!isNaN(compatDate.getTime())) {
          timeFormatted = compatDate.toLocaleTimeString();
        } else {
          const match = data.meta.time.match(/(\d{2}:\d{2}:\d{2})/);
          timeFormatted = match ? match[1] : data.meta.time;
        }
      }
    } catch (e) {
      timeFormatted = new Date().toLocaleTimeString();
    }

    scanMetaDevice.textContent = `Verified by FaceGo terminal (SN: ${data.meta.deviceId}) at ${timeFormatted} via ${data.meta.verifyMode || 'Face'}`;

    showToast('Face Recognition Success', `${currentEmployee.name} scanned successfully.`);
    
    // Switch view
    transitionTo('PROFILE');
  });

  // Receive unregistered employee warning
  socket.on('employee-not-found', (data) => {
    console.warn('Scanned ID not found:', data.id);
    errorMessage.textContent = 'This scanned identifier was not found in the ERP database.';
    errorScannedId.textContent = data.id;
    showToast('Verification Refused', `ID ${data.id} is unregistered.`);
    transitionTo('ERROR');
  });

  // ==========================================================================
  // TRANSACTION FLOW
  // ==========================================================================
  
  // Cancel Session from profile card
  btnCancelSession.addEventListener('click', () => {
    transitionTo('IDLE');
  });

  // Select payout options
  [
    { card: cardPaySalary, type: 'salary', label: 'Base Salary Payout' },
    { card: cardPayOt, type: 'ot', label: 'Overtime Payment' },
    { card: cardPayDorm, type: 'dorm_charge', label: 'Dormitory Charge Payout' }
  ].forEach(option => {
    option.card.addEventListener('click', () => {
      if (!currentEmployee) return;

      selectedPayoutType = option.type;
      const amountVal = currentEmployee[option.type] || 0;

      confPayoutTitle.textContent = option.label;
      confAmount.textContent = formatCurrency(amountVal);
      confEmpName.textContent = currentEmployee.name;
      confEmpId.textContent = currentEmployee.id;

      transitionTo('CONFIRM');
    });
  });

  // Cancel pay confirmation
  btnCancelPay.addEventListener('click', () => {
    transitionTo('PROFILE');
  });

  // Execute payment
  btnExecutePay.addEventListener('click', async () => {
    if (!currentEmployee || !selectedPayoutType) return;

    paySpinner.classList.remove('hidden');
    btnExecutePay.disabled = true;
    btnCancelPay.disabled = true;

    try {
      const response = await fetch('/api/pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          employeeId: currentEmployee.id,
          type: selectedPayoutType
        })
      });

      const result = await response.json();
      paySpinner.classList.add('hidden');
      btnExecutePay.disabled = false;
      btnCancelPay.disabled = false;

      if (response.ok && result.success) {
        // Setup receipt
        receiptTxnId.textContent = result.transaction.transactionId;
        receiptEmpName.textContent = result.transaction.employeeName;
        receiptAmount.textContent = `${formatCurrency(result.transaction.amount)} BDT`;
        
        let typeText = 'Base Salary';
        if (result.transaction.type === 'ot') typeText = 'Overtime Pay';
        if (result.transaction.type === 'dorm_charge') typeText = 'Dorm Charge';
        receiptType.textContent = typeText;

        showToast('Payment Successful', `Paid BDT ${formatCurrency(result.transaction.amount)} to ${result.transaction.employeeName}`);
        transitionTo('SUCCESS');
      } else {
        errorMessage.textContent = result.error || 'The payment could not be executed.';
        errorScannedId.textContent = currentEmployee.id;
        transitionTo('ERROR');
      }

    } catch (err) {
      console.error('Payment API call failed:', err);
      paySpinner.classList.add('hidden');
      btnExecutePay.disabled = false;
      btnCancelPay.disabled = false;
      errorMessage.textContent = 'Failed to connect to ERP API Gateway.';
      errorScannedId.textContent = currentEmployee.id;
      transitionTo('ERROR');
    }
  });

  // Success Reset countdown
  function startSuccessAutoReset(seconds) {
    let count = seconds;
    resetCounter.textContent = count;

    successCountdownTimer = setTimeout(function tick() {
      count--;
      resetCounter.textContent = count;
      if (count <= 0) {
        transitionTo('IDLE');
      } else {
        successCountdownTimer = setTimeout(tick, 1000);
      }
    }, 1000);
  }

  btnDonePayout.addEventListener('click', () => {
    transitionTo('IDLE');
  });

  btnErrorReset.addEventListener('click', () => {
    transitionTo('IDLE');
  });

  // ==========================================================================
  // PAYOUT HISTORY LOG REPORT
  // ==========================================================================
  async function loadTransactions() {
    try {
      const res = await fetch('/api/transactions');
      allTransactions = await res.json();
      applyFilters();
    } catch (err) {
      console.error('Error loading transactions:', err);
      payoutReportBody.innerHTML = `<tr><td colspan="7" class="table-empty" style="color: var(--danger);">Failed to load transactions.</td></tr>`;
    }
  }

  function applyFilters() {
    const startDateVal = filterStartDate.value;
    const endDateVal = filterEndDate.value;
    const empIdVal = filterEmpId.value.trim().toLowerCase();
    const typeVal = filterPayoutType.value;

    let filtered = allTransactions;

    // 1. Filter by start date
    if (startDateVal) {
      const startLimit = new Date(startDateVal + 'T00:00:00');
      filtered = filtered.filter(tx => new Date(tx.timestamp) >= startLimit);
    }

    // 2. Filter by end date
    if (endDateVal) {
      const endLimit = new Date(endDateVal + 'T23:59:59');
      filtered = filtered.filter(tx => new Date(tx.timestamp) <= endLimit);
    }

    // 3. Filter by Employee ID
    if (empIdVal) {
      filtered = filtered.filter(tx => tx.employeeId.toString().toLowerCase().includes(empIdVal));
    }

    // 4. Filter by type
    if (typeVal !== 'ALL') {
      filtered = filtered.filter(tx => tx.type === typeVal);
    }

    renderReportTable(filtered);
    calculateMetrics(filtered);
  }

  function renderReportTable(data) {
    payoutReportBody.innerHTML = '';

    if (data.length === 0) {
      payoutReportBody.innerHTML = `<tr><td colspan="7" class="table-empty">No transactions match the selected filters.</td></tr>`;
      return;
    }

    data.forEach(tx => {
      const tr = document.createElement('tr');
      const dateStr = new Date(tx.timestamp).toLocaleString();
      
      let typeLabel = 'Base Salary';
      if (tx.type === 'ot') typeLabel = 'Overtime';
      if (tx.type === 'dorm_charge') typeLabel = 'Dorm Charge';
      if (tx.payoutType?.includes('OT')) typeLabel = 'Overtime';
      if (tx.payoutType?.includes('DORM')) typeLabel = 'Dorm Charge';

      let statusClass = 'success';
      let statusLabel = 'PAID';
      if (tx.type === 'SCAN_IN') {
        statusClass = 'scan';
        statusLabel = 'SCAN IN';
        typeLabel = 'Attendance Log';
      }

      tr.innerHTML = `
        <td class="font-mono">${tx.transactionId || tx.id}</td>
        <td>${dateStr}</td>
        <td><strong>${tx.employeeId}</strong></td>
        <td>${tx.employeeName}</td>
        <td>${typeLabel}</td>
        <td><strong style="color: ${tx.type === 'SCAN_IN' ? 'inherit' : 'var(--primary-blue)'};">${tx.type === 'SCAN_IN' ? '-' : formatCurrency(tx.amount) + ' BDT'}</strong></td>
        <td><span class="status-tag ${statusClass}">${statusLabel}</span></td>
      `;
      payoutReportBody.appendChild(tr);
    });
  }

  function calculateMetrics(data) {
    // Exclude attendance logs (SCAN_IN) from cash metrics
    const financialTx = data.filter(tx => tx.type !== 'SCAN_IN');

    const totalTxCount = financialTx.length;
    let totalPaid = 0;
    let salaryPaid = 0;
    let otPaid = 0;
    let dormPaid = 0;

    financialTx.forEach(tx => {
      const amt = parseFloat(tx.amount) || 0;
      totalPaid += amt;

      const normType = (tx.type || '').toLowerCase();
      const rawPayoutType = (tx.payoutType || '').toUpperCase();

      if (normType === 'salary' || rawPayoutType.includes('SALARY')) {
        salaryPaid += amt;
      } else if (normType === 'ot' || rawPayoutType.includes('OT')) {
        otPaid += amt;
      } else if (normType === 'dorm_charge' || rawPayoutType.includes('DORM')) {
        dormPaid += amt;
      }
    });

    metricTxnCount.textContent = totalTxCount;
    metricTotalPaid.textContent = formatCurrency(totalPaid);
    metricSalaryPaid.textContent = formatCurrency(salaryPaid);
    metricOtPaid.textContent = formatCurrency(otPaid);
    metricDormPaid.textContent = formatCurrency(dormPaid);
  }

  // Filter Listeners
  [filterStartDate, filterEndDate, filterPayoutType].forEach(el => {
    el.addEventListener('change', applyFilters);
  });
  filterEmpId.addEventListener('input', applyFilters);

  // Clear filters
  btnClearFilters.addEventListener('click', () => {
    filterStartDate.value = '';
    filterEndDate.value = '';
    filterEmpId.value = '';
    filterPayoutType.value = 'ALL';
    applyFilters();
  });

  // ==========================================================================
  // ERP EMPLOYEE REGISTRY
  // ==========================================================================
  async function loadEmployees() {
    try {
      const res = await fetch('/api/employees');
      allEmployees = await res.json();
      renderEmployeesTable(allEmployees);
    } catch (err) {
      console.error('Error loading employees:', err);
      registryListBody.innerHTML = `<tr><td colspan="8" class="table-empty" style="color: var(--danger);">Failed to load registry records.</td></tr>`;
    }
  }

  function renderEmployeesTable(data) {
    registryListBody.innerHTML = '';

    if (data.length === 0) {
      registryListBody.innerHTML = `<tr><td colspan="8" class="table-empty">No registered records in the ERP database.</td></tr>`;
      return;
    }

    data.forEach(emp => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${emp.id}</strong></td>
        <td><strong>${emp.name}</strong></td>
        <td>${emp.designation}</td>
        <td>${emp.department}</td>
        <td>${formatCurrency(emp.salary)} BDT</td>
        <td>${formatCurrency(emp.ot)} BDT</td>
        <td>${formatCurrency(emp.dorm_charge || 0)} BDT</td>
        <td>
          <button class="erp-btn btn-secondary trigger-mock-scan" data-id="${emp.id}" style="height: 28px; font-size: 0.75rem; padding: 0 10px;">
            Simulate Scan
          </button>
        </td>
      `;
      registryListBody.appendChild(tr);
    });

    // Add trigger action event listener
    document.querySelectorAll('.trigger-mock-scan').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const empId = btn.getAttribute('data-id');
        btn.disabled = true;
        btn.textContent = 'Scanning...';

        try {
          const res = await fetch('/api/scan', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              UserID: empId.toString(),
              DeviceID: 'ERP-Web-Simulator',
              VerifyMode: 'Simulated Face',
              Time: new Date().toISOString()
            })
          });

          if (res.ok) {
            showToast('Scan Triggered', `Scan command issued for Employee ID ${empId}.`);
            // Switch menu item automatically to Dashboard Kiosk Tab
            document.querySelector('[data-tab-target="kiosk"]').click();
          } else {
            alert('Failed to simulate scan.');
          }
        } catch (e) {
          console.error(e);
          alert('Network error during scan simulation.');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Simulate Scan';
        }
      });
    });
  }

  // Register Employee handler
  btnRegisterEmployee.addEventListener('click', async () => {
    const id = regEmpId.value.trim();
    const name = regEmpName.value.trim();
    const designation = regEmpDesig.value.trim();
    const department = regEmpDept.value.trim();
    const salary = parseFloat(regEmpSalary.value) || 0;
    const ot = parseFloat(regEmpOt.value) || 0;

    if (!id || !name) {
      alert('Employee ID and Name are required.');
      return;
    }

    btnRegisterEmployee.disabled = true;
    btnRegisterEmployee.textContent = 'Saving...';

    try {
      const response = await fetch('/api/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id,
          name,
          designation,
          department,
          salary,
          ot,
          dorm_charge: 1200.00
        })
      });

      if (response.ok) {
        // Reset form
        regEmpId.value = '';
        regEmpName.value = '';
        
        showToast('Database Synchronized', `Employee "${name}" has been registered.`);
        await loadEmployees();
      } else {
        alert('Failed to save employee profile.');
      }
    } catch (err) {
      console.error(err);
      alert('Network error saving profile.');
    } finally {
      btnRegisterEmployee.disabled = false;
      btnRegisterEmployee.textContent = 'Save Profile';
    }
  });

  // Initial Data Load
  loadTransactions();
  loadEmployees();
});
