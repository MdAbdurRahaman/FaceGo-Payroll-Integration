// ==========================================================================
// APPLICATION INITIALIZATION & STATE MANAGEMENT
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // App variables
  let currentEmployee = null;
  let activeState = 'IDLE'; // IDLE, PROFILE, CONFIRM, SUCCESS, ERROR
  let selectedPayoutType = null; // salary, ot, dorm_charge
  
  // Timers
  let inactivityTimer = null;
  let warningTimer = null;
  let successCountdownTimer = null;
  
  const INACTIVITY_LIMIT = 20000; // 20 seconds before alert
  const WARNING_LIMIT = 10; // 10 seconds warning countdown

  // DOM Elements - Navigation & Connection
  const connectionStatus = document.getElementById('connection-status');
  const liveClock = document.getElementById('live-clock');

  // DOM Elements - Kiosk State Screens
  const stateIdle = document.getElementById('state-idle');
  const stateProfile = document.getElementById('state-profile');
  const stateConfirm = document.getElementById('state-confirm');
  const stateSuccess = document.getElementById('state-success');
  const stateError = document.getElementById('state-error');

  // DOM Elements - Employee Profile Card
  const empInitials = document.getElementById('emp-initials');
  const empName = document.getElementById('emp-name');
  const empIdBadge = document.getElementById('emp-id');
  const empDesignation = document.getElementById('emp-designation');
  const empDepartment = document.getElementById('emp-department');
  const empSection = document.getElementById('emp-section');
  const empUnit = document.getElementById('emp-unit');
  const empShift = document.getElementById('emp-shift');
  const scanMetaDevice = document.getElementById('scan-meta-device');

  // DOM Elements - Confirm Dialog
  const confPayoutTitle = document.getElementById('conf-payout-title');
  const confAmount = document.getElementById('conf-amount');
  const confEmpName = document.getElementById('conf-emp-name');
  const confEmpIdBadge = document.getElementById('conf-emp-id');
  const btnExecutePay = document.getElementById('btn-execute-pay');
  const btnCancelPay = document.getElementById('btn-cancel-pay');

  // DOM Elements - Success Feedback
  const receiptTxnId = document.getElementById('receipt-txn-id');
  const receiptEmpName = document.getElementById('receipt-emp-name');
  const receiptAmount = document.getElementById('receipt-amount');
  const receiptType = document.getElementById('receipt-type');
  const resetCounter = document.getElementById('reset-counter');
  const btnDonePayout = document.getElementById('btn-done-payout');

  // DOM Elements - Error Feedback
  const errorMessage = document.getElementById('error-message');
  const errorScannedId = document.getElementById('error-scanned-id');
  const btnErrorReset = document.getElementById('btn-error-reset');

  // DOM Elements - Inactivity Banner
  const sessionTimeoutBanner = document.getElementById('session-timeout-banner');
  const timeoutSeconds = document.getElementById('timeout-seconds');
  const btnKeepSession = document.getElementById('btn-keep-session');
  
  // DOM Elements - Simulator Panel
  const simulatorSidebar = document.getElementById('simulator-sidebar');
  const btnToggleSim = document.getElementById('btn-toggle-sim');
  const simEmployeeSelect = document.getElementById('sim-employee-select');
  const simDeviceId = document.getElementById('sim-device-id');
  const btnSimScan = document.getElementById('btn-sim-scan');
  const simTransactionList = document.getElementById('sim-transaction-list');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  
  // DOM Elements - Simulator ERP Registry
  const newEmpId = document.getElementById('new-emp-id');
  const newEmpName = document.getElementById('new-emp-name');
  const newEmpDesig = document.getElementById('new-emp-desig');
  const newEmpDept = document.getElementById('new-emp-dept');
  const newEmpSalary = document.getElementById('new-emp-salary');
  const newEmpOt = document.getElementById('new-emp-ot');
  const btnAddEmployee = document.getElementById('btn-add-employee');

  // ==========================================================================
  // SYSTEM CLOCK & FORMATTERS
  // ==========================================================================
  function updateClock() {
    const now = new Date();
    liveClock.textContent = now.toLocaleTimeString();
  }
  setInterval(updateClock, 1000);
  updateClock();

  function formatCurrency(val) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(val);
  }

  function getInitials(name) {
    if (!name) return '??';
    return name.split(' ')
               .map(word => word[0])
               .filter(char => /[a-zA-Z]/.test(char))
               .slice(0, 2)
               .join('')
               .toUpperCase();
  }

  // ==========================================================================
  // STATE MACHINE TRANSITIONS
  // ==========================================================================
  function transitionTo(stateName) {
    console.log(`Transitioning: ${activeState} -> ${stateName}`);
    activeState = stateName;

    // Reset UI visibility
    [stateIdle, stateProfile, stateConfirm, stateSuccess, stateError].forEach(el => {
      el.classList.remove('active');
    });

    // Clear timers
    clearTimeout(inactivityTimer);
    clearInterval(warningTimer);
    clearTimeout(successCountdownTimer);
    sessionTimeoutBanner.classList.add('hidden');

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
    sessionTimeoutBanner.classList.add('hidden');

    // Start primary countdown
    inactivityTimer = setTimeout(() => {
      // Trigger warning banner
      sessionTimeoutBanner.classList.remove('hidden');
      let countdown = WARNING_LIMIT;
      timeoutSeconds.textContent = countdown;

      // Decrement countdown each second
      warningTimer = setInterval(() => {
        countdown--;
        timeoutSeconds.textContent = countdown;

        if (countdown <= 0) {
          clearInterval(warningTimer);
          sessionTimeoutBanner.classList.add('hidden');
          console.warn('Session timed out due to inactivity.');
          transitionTo('IDLE');
        }
      }, 1000);

    }, INACTIVITY_LIMIT);
  }

  // Reset timer on user clicks/activity inside the interactive zones
  btnKeepSession.addEventListener('click', () => {
    startInactivityTimer();
  });

  // ==========================================================================
  // SOCKET.IO REAL-TIME LISTENING
  // ==========================================================================
  const socket = io();

  socket.on('connect', () => {
    console.log('Connected to server via WebSocket.');
    connectionStatus.className = 'status-indicator online';
    connectionStatus.querySelector('.status-text').textContent = 'Live Connected';
  });

  socket.on('disconnect', () => {
    console.warn('Disconnected from server.');
    connectionStatus.className = 'status-indicator offline';
    connectionStatus.querySelector('.status-text').textContent = 'Reconnecting...';
  });

  // Catch face scan event pushed by device
  socket.on('employee-scanned', (data) => {
    console.log('Real-time scan received:', data);
    currentEmployee = data.employee;
    
    // Fill profile card
    empInitials.textContent = getInitials(currentEmployee.name);
    empName.textContent = currentEmployee.name;
    empIdBadge.textContent = currentEmployee.id;
    empDesignation.textContent = currentEmployee.designation;
    empDepartment.textContent = currentEmployee.department;
    empSection.textContent = currentEmployee.section;
    empUnit.textContent = currentEmployee.unit;
    empShift.textContent = currentEmployee.shift;

    let timeFormatted = '';
    try {
      const parsedDate = new Date(data.meta.time);
      if (!isNaN(parsedDate.getTime())) {
        timeFormatted = parsedDate.toLocaleTimeString();
      } else {
        // Fallback for space/dash formatting issues (e.g. Safari compatibility)
        const compatDate = new Date(data.meta.time.replace(/-/g, '/'));
        if (!isNaN(compatDate.getTime())) {
          timeFormatted = compatDate.toLocaleTimeString();
        } else {
          // Just extract the time part: "17:42:30"
          const match = data.meta.time.match(/(\d{2}:\d{2}:\d{2})/);
          timeFormatted = match ? match[1] : data.meta.time;
        }
      }
    } catch (e) {
      timeFormatted = new Date().toLocaleTimeString();
    }

    scanMetaDevice.textContent = `Verified by terminal: ${data.meta.deviceId} at ${timeFormatted}`;

    // Switch view
    transitionTo('PROFILE');
  });

  // Catch unregistered employee scan
  socket.on('employee-not-found', (data) => {
    console.warn('Employee ID scanned not found in ERP:', data.id);
    errorMessage.textContent = 'This employee record could not be located in the central payroll ERP database.';
    errorScannedId.textContent = data.id;
    transitionTo('ERROR');
  });

  // Catch live update of employee (after payout reset)
  socket.on('employee-updated', (data) => {
    if (currentEmployee && currentEmployee.id === data.employee.id) {
      console.log('Employee values updated in real time.');
      currentEmployee = data.employee;
    }
  });

  // ==========================================================================
  // TRANSACTION SELECTION & CONFIRMATION
  // ==========================================================================
  
  // Exit Profile Session
  document.getElementById('btn-cancel-session').addEventListener('click', () => {
    transitionTo('IDLE');
  });

  // Click handler for Transaction type selectors
  const actionButtons = document.querySelectorAll('.action-btn');
  actionButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (!currentEmployee) return;

      const type = btn.getAttribute('data-payout-type');
      selectedPayoutType = type;

      let typeLabel = '';
      let amountVal = 0;
      let icon = '';

      switch (type) {
        case 'salary':
          typeLabel = 'Base Salary Payout';
          amountVal = currentEmployee.salary;
          icon = '💰';
          break;
        case 'ot':
          typeLabel = 'Overtime Payment';
          amountVal = currentEmployee.ot;
          icon = '⚡';
          break;
        case 'dorm_charge':
          typeLabel = 'Dormitory Charge Payout';
          amountVal = currentEmployee.dorm_charge;
          icon = '🏢';
          break;
      }

      // Configure Confirm Page
      document.getElementById('conf-type-icon').textContent = icon;
      confPayoutTitle.textContent = typeLabel;
      confAmount.textContent = formatCurrency(amountVal);
      confEmpName.textContent = currentEmployee.name;
      confEmpIdBadge.textContent = `ID: ${currentEmployee.id}`;

      transitionTo('CONFIRM');
    });
  });

  // Cancel Confirmation
  btnCancelPay.addEventListener('click', () => {
    transitionTo('PROFILE');
  });

  // Execute Payout Confirmation (Send to API Backend)
  btnExecutePay.addEventListener('click', async () => {
    if (!currentEmployee || !selectedPayoutType) return;
    
    // Show spinner inside button
    const spinner = btnExecutePay.querySelector('.btn-spinner');
    spinner.classList.remove('hidden');
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
      spinner.classList.add('hidden');
      btnExecutePay.disabled = false;
      btnCancelPay.disabled = false;

      if (response.ok && result.success) {
        // Configure receipt details
        receiptTxnId.textContent = result.transaction.transactionId;
        receiptEmpName.textContent = result.transaction.employeeName;
        receiptAmount.textContent = `BDT ${formatCurrency(result.transaction.amount)}`;
        
        let typeText = 'Base Salary';
        if (result.transaction.type === 'ot') typeText = 'Overtime Pay';
        if (result.transaction.type === 'dorm_charge') typeText = 'Dorm Charge';
        receiptType.textContent = typeText;

        // Fetch logs for simulator
        refreshTransactions();

        // Switch to Success screen
        transitionTo('SUCCESS');
      } else {
        errorMessage.textContent = result.error || 'The payment gateway returned an execution failure.';
        errorScannedId.textContent = currentEmployee.id;
        transitionTo('ERROR');
      }

    } catch (err) {
      console.error('API Payment request failed:', err);
      spinner.classList.add('hidden');
      btnExecutePay.disabled = false;
      btnCancelPay.disabled = false;
      errorMessage.textContent = 'Failed to establish network request to ERP API Gateway.';
      errorScannedId.textContent = currentEmployee.id;
      transitionTo('ERROR');
    }
  });

  // Success Auto-Reset timer
  function startSuccessAutoReset(seconds) {
    let countdown = seconds;
    resetCounter.textContent = countdown;

    successCountdownTimer = setTimeout(function tick() {
      countdown--;
      resetCounter.textContent = countdown;
      if (countdown <= 0) {
        transitionTo('IDLE');
      } else {
        successCountdownTimer = setTimeout(tick, 1000);
      }
    }, 1000);
  }

  btnDonePayout.addEventListener('click', () => {
    transitionTo('IDLE');
  });

  // Error screen dismissal
  btnErrorReset.addEventListener('click', () => {
    transitionTo('IDLE');
  });

  // ==========================================================================
  // HARDWARE TERMINAL SIMULATOR CONTROLLERS
  // ==========================================================================
  
  // Sidebar Slide Toggle
  btnToggleSim.addEventListener('click', () => {
    simulatorSidebar.classList.toggle('open');
  });

  // Fetch employees list to populate simulator dropdown
  async function loadSimulatorEmployees() {
    try {
      const res = await fetch('/api/employees');
      const data = await res.json();
      
      simEmployeeSelect.innerHTML = '';
      if (data.length === 0) {
        simEmployeeSelect.innerHTML = '<option value="">No employees in database</option>';
        return;
      }

      data.forEach(emp => {
        const option = document.createElement('option');
        option.value = emp.id;
        option.textContent = `${emp.name} (ID: ${emp.id})`;
        simEmployeeSelect.appendChild(option);
      });
    } catch (err) {
      console.error('Error loading employees list:', err);
    }
  }

  // Trigger Mock FaceID Scan Event (HTTP POST request mimicking terminal)
  btnSimScan.addEventListener('click', async () => {
    const userId = simEmployeeSelect.value;
    const devId = simDeviceId.value || 'Simulator-Node-1';
    
    if (!userId) {
      alert('Please select or add a mock employee first!');
      return;
    }

    try {
      // Mimic exactly the Hanvon push protocol
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          UserID: userId,
          DeviceID: devId,
          VerifyMode: 'Face',
          Time: new Date().toISOString()
        })
      });

      if (!response.ok) {
        console.error('Simulator push failed:', response.status);
      }
    } catch (err) {
      console.error('Simulator post failed:', err);
    }
  });

  // Create new mock employee in database
  btnAddEmployee.addEventListener('click', async () => {
    const id = newEmpId.value.trim();
    const name = newEmpName.value.trim();
    const designation = newEmpDesig.value.trim();
    const department = newEmpDept.value.trim();
    const salary = parseFloat(newEmpSalary.value) || 0;
    const ot = parseFloat(newEmpOt.value) || 0;

    if (!id || !name) {
      alert('Employee ID and Name are required!');
      return;
    }

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
          dorm_charge: 1200.00 // standard default
        })
      });

      if (response.ok) {
        // Clear input form
        newEmpId.value = '';
        newEmpName.value = '';
        newEmpDesig.value = '';
        newEmpDept.value = '';
        
        // Reload list
        await loadSimulatorEmployees();
        
        // Auto select the newly added user
        simEmployeeSelect.value = id;
        
        alert('Employee profile added to local ERP mock database!');
      } else {
        const errData = await response.json();
        alert(`Error saving employee: ${errData.error}`);
      }
    } catch (err) {
      console.error('Error creating employee:', err);
    }
  });

  // Refresh recent payouts history list
  async function refreshTransactions() {
    try {
      const res = await fetch('/api/transactions');
      const txs = await res.json();

      simTransactionList.innerHTML = '';
      if (txs.length === 0) {
        simTransactionList.innerHTML = '<div class="tx-empty-state">No payments processed in this session.</div>';
        return;
      }

      txs.forEach(tx => {
        const item = document.createElement('div');
        item.className = 'tx-log-item';

        let typeLabel = 'Salary';
        if (tx.type === 'ot') typeLabel = 'Overtime';
        if (tx.type === 'dorm_charge') typeLabel = 'Dorm';

        const date = new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        item.innerHTML = `
          <div class="tx-log-header">
            <span>${tx.employeeName}</span>
            <span class="tx-log-amount">+${formatCurrency(tx.amount)} BDT</span>
          </div>
          <div class="tx-log-meta">
            <span>${typeLabel} (${tx.employeeId})</span>
            <span>${date}</span>
          </div>
        `;
        simTransactionList.appendChild(item);
      });
    } catch (err) {
      console.error('Error fetching transactions:', err);
    }
  }

  // Clear Logs trigger
  btnClearLogs.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear the transaction log history?')) return;
    try {
      const res = await fetch('/api/transactions/clear', { method: 'POST' });
      if (res.ok) {
        refreshTransactions();
      }
    } catch (err) {
      console.error('Error clearing transaction logs:', err);
    }
  });

  // Initialize Simulator Dropdowns and Logs
  loadSimulatorEmployees();
  refreshTransactions();
});
