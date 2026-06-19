const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;
const DB_PATH = path.join(__dirname, 'erp_db.json');
const LOG_PATH = path.join(__dirname, 'transactions.json');

app.use(cors());
// Global request logger for debugging network connectivity
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - IP: ${req.ip || req.socket.remoteAddress}`);
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Support text/xml and application/xml payloads by loading them as raw text
app.use(express.text({ type: ['*/xml', 'text/xml', 'application/xml'] }));
// Support default paths pushed by Hanvon devices (e.g. /, /post, /receivelog.do, etc.) by rewriting them to /api/scan
app.use((req, res, next) => {
  if (req.method === 'POST') {
    const defaultPaths = ['/', '/post', '/receivelog.do', '/receivelogs.do', '/api/post', '/api/receivelog'];
    if (defaultPaths.includes(req.path)) {
      console.log(`[URL Rewrite] Intercepted POST to ${req.path}. Rewriting URL to /api/scan to accommodate device default push path.`);
      req.url = '/api/scan';
    }
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Helper to read ERP database
function readERPDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return [];
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading ERP database:', error);
    return [];
  }
}

// Helper to write ERP database
function writeERPDatabase(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing ERP database:', error);
  }
}

// Helper to read transactions
function readTransactions() {
  try {
    if (!fs.existsSync(LOG_PATH)) {
      return [];
    }
    const data = fs.readFileSync(LOG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading transactions log:', error);
    return [];
  }
}

// Helper to write transactions
function writeTransactions(data) {
  try {
    fs.writeFileSync(LOG_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing transactions log:', error);
  }
}

// Initialize files if they don't exist
if (!fs.existsSync(LOG_PATH)) {
  writeTransactions([]);
}

// API: Get all employees (for Simulator dropdown)
app.get('/api/employees', (req, res) => {
  const employees = readERPDatabase();
  res.json(employees);
});

// API: Add/Update mock employee
app.post('/api/employees', (req, res) => {
  const { id, name, designation, department, section, unit, shift, salary, ot, dorm_charge } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'ID and Name are required.' });
  }

  const employees = readERPDatabase();
  const index = employees.findIndex(emp => emp.id === id);

  const employeeData = {
    id,
    name,
    designation: designation || 'Employee',
    department: department || 'General',
    section: section || 'General',
    unit: unit || 'Unit-1',
    shift: shift || 'Day',
    salary: parseFloat(salary) || 0.00,
    ot: parseFloat(ot) || 0.00,
    dorm_charge: parseFloat(dorm_charge) || 0.00
  };

  if (index !== -1) {
    employees[index] = employeeData;
  } else {
    employees.push(employeeData);
  }

  writeERPDatabase(employees);
  res.json({ success: true, employee: employeeData });
});

// API: Get transaction log
app.get('/api/transactions', (req, res) => {
  const transactions = readTransactions();
  res.json(transactions);
});

// API: Clear transactions (for testing/resetting)
app.post('/api/transactions/clear', (req, res) => {
  writeTransactions([]);
  res.json({ success: true });
});

// Hanvon Push HTTP POST Endpoint
// Configure the Hanvon device to push to: http://<server-ip>:5000/api/scan
app.post('/api/scan', (req, res) => {
  console.log('--- Received Hanvon Scan Event ---');
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Raw Payload:', req.body);

  let payload = {};

  // Parse payload if it's XML (either content-type matches or the body string starts with XML markup)
  if (typeof req.body === 'string' && (req.body.trim().startsWith('<') || req.headers['content-type']?.includes('xml'))) {
    try {
      const xmlStr = req.body;
      const getXmlTag = (tag) => {
        const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
        const match = xmlStr.match(regex);
        return match ? match[1].trim() : null;
      };

      payload = {
        UserID: getXmlTag('UserID') || getXmlTag('id') || getXmlTag('userid'),
        DeviceID: getXmlTag('DeviceID') || getXmlTag('deviceid'),
        VerifyMode: getXmlTag('VerifyMode') || getXmlTag('verifymode'),
        Time: getXmlTag('Time') || getXmlTag('time')
      };
      console.log('Parsed XML Payload:', payload);
    } catch (err) {
      console.error('Error parsing XML payload:', err);
    }
  } else {
    // Already parsed as JSON or urlencoded object
    payload = req.body || {};
  }

  // Hanvon devices typically send "UserID" or "id". We accommodate both.
  const employeeId = payload.UserID || payload.id || payload.userid;
  const deviceId = payload.DeviceID || payload.deviceid || 'Unknown Device';
  const verifyMode = payload.VerifyMode || payload.verifymode || 'Face';
  const time = payload.Time || payload.time || new Date().toISOString();

  if (!employeeId) {
    console.error('Scan failed: No UserID/employeeId in payload');
    io.emit('scan-error', { message: 'Received empty employee ID from terminal' });
    return res.status(400).json({ result: 'fail', error: 'Missing UserID' });
  }

  const employees = readERPDatabase();
  const employee = employees.find(emp => emp.id.toString() === employeeId.toString());

  if (employee) {
    console.log(`Scan Succeeded: Employee ${employee.name} (${employee.id}) identified.`);
    // Broadcast the scanned employee profile to all connected UI clients in real-time
    io.emit('employee-scanned', {
      employee,
      meta: {
        deviceId,
        verifyMode,
        time
      }
    });
    res.status(200).json({ result: 'success' });
  } else {
    console.warn(`Scan Warning: Employee ID ${employeeId} not found in ERP database.`);
    io.emit('employee-not-found', {
      id: employeeId,
      meta: {
        deviceId,
        verifyMode,
        time
      }
    });
    res.status(200).json({ result: 'success', message: 'Employee ID not in local DB' });
  }
});

// API: Execute payout
app.post('/api/pay', (req, res) => {
  const { employeeId, type } = req.body;

  if (!employeeId || !type) {
    return res.status(400).json({ error: 'employeeId and type are required' });
  }

  const allowedTypes = ['salary', 'ot', 'dorm_charge'];
  if (!allowedTypes.includes(type)) {
    return res.status(400).json({ error: `Invalid payout type. Must be one of ${allowedTypes.join(', ')}` });
  }

  const employees = readERPDatabase();
  const employee = employees.find(emp => emp.id.toString() === employeeId.toString());

  if (!employee) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  // Securely get the amount from ERP database on backend, do not rely on client values
  const amount = employee[type];

  // In a real application, you would connect to the ERP SOAP/REST API to register the payout here.
  console.log(`Executing payment for ${employee.name}: Type: ${type}, Amount: ${amount}`);

  // Log the transaction
  const transactions = readTransactions();
  const newTransaction = {
    transactionId: `TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
    timestamp: new Date().toISOString(),
    employeeId: employee.id,
    employeeName: employee.name,
    type,
    amount,
    status: 'SUCCESS'
  };

  transactions.unshift(newTransaction); // Add to beginning of log
  writeTransactions(transactions);

  // Optionally update employee balance (e.g. set OT to 0 after paying, or reduce balance)
  // For demonstration, let's keep them as is or reset OT/dorm_charge to 0, which is logical!
  if (type === 'ot' || type === 'dorm_charge') {
    employee[type] = 0.00;
    writeERPDatabase(employees);
    // Broadcast updated profile to UI if the employee is still active
    io.emit('employee-updated', { employee });
  }

  res.json({
    success: true,
    transaction: newTransaction
  });
});

// Socket connection management
io.on('connection', (socket) => {
  console.log(`Socket client connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`Socket client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Hanvon FaceID Payroll Integration Middleware Running  `);
  console.log(` Server local address: http://localhost:${PORT}        `);
  console.log(` Hanvon API push endpoint: http://localhost:${PORT}/api/scan`);
  console.log(`=======================================================`);
});
