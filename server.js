const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const net = require('net'); // Native Node.js TCP module
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Port configuration
const WEB_PORT = process.env.PORT || 5000;
const HANVON_TCP_PORT = 9920; // Dedicated port for the Hanvon Device

const DB_PATH = path.join(__dirname, 'erp_db.json');
const LOG_PATH = path.join(__dirname, 'transactions.json');

let activeScanSession = null; // Stores the latest scan to sync clients who connect shortly after the scan

// --- INITIALIZE FILE DATABASES ---
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify([], null, 2), 'utf8');
}
if (!fs.existsSync(LOG_PATH)) {
  fs.writeFileSync(LOG_PATH, JSON.stringify([], null, 2), 'utf8');
}

// --- HELPER FUNCTIONS ---
function readERPDatabase() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading ERP database:', error);
    return [];
  }
}

function writeERPDatabase(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing ERP database:', error);
  }
}

function readTransactions() {
  try {
    const data = fs.readFileSync(LOG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading transactions log:', error);
    return [];
  }
}

function writeTransactions(data) {
  try {
    fs.writeFileSync(LOG_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error writing transactions log:', error);
  }
}

// --- EXPRESS MIDDLEWARES ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: ['*/xml', 'text/xml', 'application/xml'] }));
app.use(express.static(path.join(__dirname, 'public')));

// Global Request Logger for HTTP/Express routes
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] HTTP: ${req.method} ${req.url} - IP: ${req.ip || req.socket.remoteAddress}`);
  next();
});

// URL Rewrite Middleware for backup HTTP pushes
app.use((req, res, next) => {
  if (req.method === 'POST') {
    const defaultPaths = ['/', '/post', '/receivelog.do', '/receivelogs.do', '/api/post', '/api/receivelog'];
    if (defaultPaths.includes(req.path)) {
      console.log(`[URL Rewrite] Intercepted POST to ${req.path}. Rewriting to /api/scan`);
      req.url = '/api/scan';
    }
  }
  next();
});

// --- HTTP ENDPOINTS (WEB FRONTEND & MISC) ---

// API: Get all employees
app.get('/api/employees', (req, res) => {
  res.json(readERPDatabase());
});

// API: Add/Update mock employee
app.post('/api/employees', (req, res) => {
  const { id, name, designation, department, section, unit, shift, salary, ot, dorm_charge } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'ID and Name are required.' });
  }

  const employees = readERPDatabase();
  const index = employees.findIndex(emp => emp.id.toString() === id.toString());

  const employeeData = {
    id: id.toString(),
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
  res.json(readTransactions());
});

// API: Clear transactions
app.post('/api/transactions/clear', (req, res) => {
  writeTransactions([]);
  res.json({ success: true });
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

  const amount = employee[type];
  console.log(`Executing payment for ${employee.name}: Type: ${type}, Amount: ${amount}`);

  // Create a structured transaction object compatible with both the frontend UI and database
  const transactionId = `TXN-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const timestamp = new Date().toISOString();
  const newTransaction = {
    id: Date.now().toString(),
    transactionId,
    employeeId: employee.id,
    employeeName: employee.name,
    type, // keep standard type ('salary', 'ot', 'dorm_charge') for frontend log UI parsing
    payoutType: `PAYOUT_${type.toUpperCase()}`,
    amount: amount,
    timestamp
  };

  // Save payout event to transactions
  const transactions = readTransactions();
  transactions.push(newTransaction);
  writeTransactions(transactions);

  // Clear active scan session since payment is done
  activeScanSession = null;

  res.json({
    success: true,
    employeeName: employee.name,
    type,
    amount,
    transaction: newTransaction // Returned to prevent browser client TypeError
  });
});

// API Fallback: Handle standard HTTP POST scans (if device uses HTTP engine)
app.post('/api/scan', (req, res) => {
  console.log('--- Received HTTP Hanvon Scan Event ---');
  let payload = typeof req.body === 'string' ? {} : (req.body || {});

  if (typeof req.body === 'string') {
    const xmlStr = req.body;
    const getXmlTag = (tag) => {
      const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
      const match = xmlStr.match(regex);
      return match ? match[1].trim() : null;
    };
    payload = {
      UserID: getXmlTag('UserID') || getXmlTag('id'),
      DeviceID: getXmlTag('DeviceID'),
      VerifyMode: getXmlTag('VerifyMode'),
      Time: getXmlTag('Time')
    };
  }

  const employeeId = payload.UserID || payload.id;
  if (!employeeId) {
    return res.status(400).json({ result: 'fail', error: 'Missing UserID' });
  }

  processLogData(employeeId, payload.DeviceID || 'HTTP-Device', payload.VerifyMode || 'Face', payload.Time || new Date().toISOString());
  res.status(200).json({ result: 'success' });
});


// --- NEW: DEDICATED HANVON TCP SOCKET SERVER ---
// const hanvonTcpServer = net.createServer((socket) => {
//   console.log(`[TCP] Hanvon Device Connected from: ${socket.remoteAddress}:${socket.remotePort}`);

//   socket.on('data', (data) => {
//     const rawString = data.toString('utf8');
//     console.log('[TCP] Raw String Received from Device:\n', rawString);

//     // 1. Process Heartbeat Ping immediately to maintain live uplink
//     if (rawString.includes('<HeartBeat>') || rawString.toLowerCase().includes('heartbeat')) {
//       console.log('[TCP] Device Heartbeat detected. Acknowledging client link...');
//       socket.write('Return(Result="Success")\r\n');
//       return;
//     }

//     // 2. Parse out XML payload variables from the text frame
//     try {
//       const getXmlTag = (tag) => {
//         const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
//         const match = rawString.match(regex);
//         return match ? match[1].trim() : null;
//       };

//       const employeeId = getXmlTag('UserID') || getXmlTag('id') || getXmlTag('userid');
//       const deviceId = getXmlTag('DeviceID') || 'FaceGo-Terminal';
//       const verifyMode = getXmlTag('VerifyMode') || 'Face';
//       const timestamp = getXmlTag('Time') || new Date().toISOString();

//       if (employeeId) {
//         console.log(`[TCP] Processing validation packet for Employee ID: ${employeeId}`);
//         processLogData(employeeId, deviceId, verifyMode, timestamp);

//         // CRITICAL: Tells Hanvon device that log was saved so it can clear its buffer memory
//         socket.write('Return(Result="Success")\r\n');
//       } else {
//         socket.write('Return(Result="Success")\r\n');
//       }
//     } catch (err) {
//       console.error('[TCP] Error Parsing Frame Data:', err);
//       socket.write('Return(Result="Fail")\r\n');
//     }
//   });

//   socket.on('error', (err) => {
//     console.error('[TCP] Device Connection Interrupted:', err.message);
//   });
// });
// --- UPDATED: HANVON TCP SOCKET SERVER ---
// const hanvonTcpServer = net.createServer((socket) => {
//   console.log(`[TCP] Hanvon Device Connected from: ${socket.remoteAddress}:${socket.remotePort}`);

//   socket.on('data', (data) => {
//     const rawString = data.toString('utf8').trim();
//     console.log('[TCP] Raw String Received from Device:\n', rawString);

//     // 1. Process Heartbeat Ping immediately to maintain live uplink
//     if (rawString.includes('<HeartBeat>') || rawString.toLowerCase().includes('heartbeat')) {
//       console.log('[TCP] Device Heartbeat detected. Acknowledging client link...');
//       socket.write('Return(Result="Success")\r\n');
//       return;
//     }

//     // 2. Handle Custom Hanvon Function Pushes (PostRecord / PostEmployee)
//     try {
//       // Regular expression to catch key="value" pattern inside functions
//       const extractParam = (paramName) => {
//         const regex = new RegExp(`${paramName}="([^"]+)"`, 'i');
//         const match = rawString.match(regex);
//         return match ? match[1].trim() : null;
//       };

//       const serialNumber = extractParam('sn');
//       const employeeId = extractParam('id') || extractParam('UserID');
//       const timeString = extractParam('time') || new Date().toISOString();

//       // If it's a structural request missing an ID, acknowledge it so the buffer clears
//       if (rawString.startsWith('PostRecord') || rawString.startsWith('PostEmployee')) {
//         console.log(`[TCP] Intercepted Hanvon Device Hook (SN: ${serialNumber || 'Unknown'})`);

//         if (employeeId) {
//           console.log(`[TCP] Processing data for Employee ID: ${employeeId}`);
//           processLogData(employeeId, serialNumber || 'FaceGo-Terminal', 'Face', timeString);
//         } else {
//           console.log('[TCP] Structural packet metadata acknowledged without active payload ID.');
//         }

//         // CRITICAL: Tells Hanvon device that function block was received so it clears device buffer memory
//         socket.write('Return(Result="Success")\r\n');
//         return;
//       }

//       // 3. Fallback: Parse out standard XML structures if the device changes format
//       const getXmlTag = (tag) => {
//         const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
//         const match = rawString.match(regex);
//         return match ? match[1].trim() : null;
//       };

//       const xmlEmployeeId = getXmlTag('UserID') || getXmlTag('id');
//       const xmlDeviceId = getXmlTag('DeviceID') || 'FaceGo-Terminal';
//       const xmlTime = getXmlTag('Time') || new Date().toISOString();

//       if (xmlEmployeeId) {
//         console.log(`[TCP] Processing XML validation packet for Employee ID: ${xmlEmployeeId}`);
//         processLogData(xmlEmployeeId, xmlDeviceId, 'Face', xmlTime);
//         socket.write('Return(Result="Success")\r\n');
//       } else {
//         // Fallback catch-all to prevent terminal processing loops
//         socket.write('Return(Result="Success")\r\n');
//       }

//     } catch (err) {
//       console.error('[TCP] Error Parsing Frame Data:', err);
//       socket.write('Return(Result="Fail")\r\n');
//     }
//   });

//   socket.on('error', (err) => {
//     console.error('[TCP] Device Connection Interrupted:', err.message);
//   });
// });
// --- UPDATED FIXED: HANVON TCP SOCKET SERVER ---
const hanvonTcpServer = net.createServer((socket) => {
  console.log(`[TCP] Hanvon Device Connected from: ${socket.remoteAddress}:${socket.remotePort}`);

  socket.on('data', (data) => {
    const rawString = data.toString('utf8').trim();
    console.log('[TCP] Raw String Received from Device:\n', rawString);

    // 1. Process Heartbeat Ping immediately to maintain live uplink
    if (rawString.includes('<HeartBeat>') || rawString.toLowerCase().includes('heartbeat')) {
      console.log('[TCP] Device Heartbeat detected. Acknowledging client link...');
      socket.write('Return(result="success")\r\n');
      return;
    }

    try {
      // Regular expression to catch key="value" pattern inside standard strings
      const extractParam = (paramName) => {
        const regex = new RegExp(`${paramName}="([^"]+)"`, 'i');
        const match = rawString.match(regex);
        return match ? match[1].trim() : null;
      };

      // A. Handle "PostRecord" Handshake (Initial Device Connection Check)
      if (rawString.startsWith('PostRecord')) {
        const serialNumber = extractParam('sn');
        console.log(`[TCP] Handshake Received: PostRecord from Device SN: ${serialNumber}`);
        // CRITICAL FIX: Explicitly tell device if you want it to push verification photos
        socket.write('Return(result="success" postphoto="false")\r\n');
        return;
      }

      // B. Handle "PostEmployee" Handshake
      if (rawString.startsWith('PostEmployee')) {
        const serialNumber = extractParam('sn');
        console.log(`[TCP] Handshake Received: PostEmployee from Device SN: ${serialNumber}`);
        socket.write('Return(result="success")\r\n');
        return;
      }

      // C. Handle Incoming Attendance "Record" Upload strings
      if (rawString.startsWith('Record') || rawString.includes('id=')) {
        const employeeId = extractParam('id') || extractParam('UserID');
        const timeString = extractParam('time') || new Date().toISOString();
        const serialNumber = extractParam('sn') || 'FaceGo-Terminal';

        if (employeeId) {
          console.log(`[TCP] Processing log record for Employee ID: ${employeeId}`);
          processLogData(employeeId, serialNumber, 'Face', timeString);
        }

        socket.write('Return(result="success")\r\n');
        return;
      }

      // 3. Fallback: Parse out standard XML structures if device falls back to XML text formatting
      const getXmlTag = (tag) => {
        const regex = new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i');
        const match = rawString.match(regex);
        return match ? match[1].trim() : null;
      };

      const xmlEmployeeId = getXmlTag('UserID') || getXmlTag('id');
      const xmlDeviceId = getXmlTag('DeviceID') || 'FaceGo-Terminal';
      const xmlTime = getXmlTag('Time') || new Date().toISOString();

      if (xmlEmployeeId) {
        console.log(`[TCP] Processing XML validation packet for Employee ID: ${xmlEmployeeId}`);
        processLogData(xmlEmployeeId, xmlDeviceId, 'Face', xmlTime);
        socket.write('Return(result="success")\r\n');
      } else {
        // Universal lowercase fallback reply to keep loop clear
        socket.write('Return(result="success")\r\n');
      }

    } catch (err) {
      console.error('[TCP] Error Parsing Frame Data:', err);
      socket.write('Return(result="fail")\r\n');
    }
  });

  socket.on('error', (err) => {
    console.error('[TCP] Device Connection Interrupted:', err.message);
  });
});


// --- SHARED DATA HOOK FOR BROADCASTING & SAVING LOGS ---
function processLogData(employeeId, deviceId, verifyMode, timestamp) {
  const employees = readERPDatabase();
  const employee = employees.find(emp => emp.id.toString() === employeeId.toString());

  if (employee) {
    console.log(`[Success] Identified Employee: ${employee.name} (ID: ${employee.id})`);

    // Add entry to transactions database
    const transactions = readTransactions();
    transactions.push({
      id: Date.now().toString() + Math.floor(Math.random() * 1000),
      employeeId: employee.id,
      employeeName: employee.name,
      type: 'SCAN_IN',
      deviceId,
      verifyMode,
      timestamp
    });
    writeTransactions(transactions);

    // Save active scan session with a millisecond timestamp for reconnection syncing
    activeScanSession = {
      employee,
      meta: { deviceId, verifyMode, time: timestamp },
      timestamp: Date.now()
    };

    // Fire live payload down to connected dashboard browser instances
    io.emit('employee-scanned', {
      employee,
      meta: { deviceId, verifyMode, time: timestamp }
    });
  } else {
    console.warn(`[Warning] Scanned ID ${employeeId} doesn't exist in erp_db.json`);

    io.emit('employee-not-found', {
      id: employeeId,
      meta: { deviceId, verifyMode, time: timestamp }
    });
  }
}

// --- SOCKET.IO CLIENT CONN MANAGER ---
io.on('connection', (socket) => {
  console.log(`[UI Client Connected] Active Socket Token: ${socket.id}`);
  
  // If there is a fresh active scan session (under 30s), send it to the connecting UI client immediately
  if (activeScanSession && (Date.now() - activeScanSession.timestamp < 30000)) {
    console.log(`[UI Client Connected] Syncing active scan session for ${activeScanSession.employee.name}`);
    socket.emit('employee-scanned', activeScanSession);
  }

  socket.on('clear-active-scan', () => {
    console.log(`[UI Client] Cleared active scan session`);
    activeScanSession = null;
  });

  socket.on('disconnect', () => {
    console.log(`[UI Client Disconnected] Left Server context.`);
  });
});

// --- LAUNCH SIMULTANEOUS PORTS ---
server.listen(WEB_PORT, () => {
  console.log(`💻 Web Dashboard Engine online at: http://localhost:${WEB_PORT}`);
});

hanvonTcpServer.listen(HANVON_TCP_PORT, () => {
  console.log(`🚀 Hanvon FaceGo Push Server listening on TCP Port: ${HANVON_TCP_PORT}`);
});
