# FaceGo / Hanvon FaceID Payroll Integration System

This project is a middleware and kiosk frontend dashboard that integrates a physical **Hanvon FaceID (FaceGo) Facial Recognition Terminal** with an **ERP Payroll Database** to enable real-time base salary, overtime (OT), and dormitory charge review and payment confirmations.

It includes a built-in **Terminal Simulator Panel** on the right side of the interface, allowing you to mock hardware push events, manage mock ERP profiles, and monitor payout logs in real time.

---

## Getting Started

### 1. Installation

Ensure you have [Node.js](https://nodejs.org) (v16+) installed.

Clone or copy the directory, and run the following command in your terminal to install dependencies:
```bash
npm install
```

### 2. Running the Server

Start the local server in development mode (auto-reloads on file changes):
```bash
npm run dev
```
Or start in standard production mode:
```bash
npm start
```

This starts the application on **Port 5000**.
* **Kiosk Web Dashboard**: `http://localhost:5000`
* **Hanvon API Push Endpoint**: `http://localhost:5000/api/scan`

---

## Hanvon FaceID Device Setup Guide

To connect your physical Hanvon hardware unit to this system, the device must be on the same local area network (LAN) as the computer running this code.

1. **Get your Server's IP Address**:
   * Open a command prompt/powershell on your computer and run `ipconfig`.
   * Find your IPv4 address (e.g., `192.168.1.50`).

2. **Access Device Settings**:
   * Go to the physical Hanvon device.
   * Press the physical **[MENU]** key and verify your admin credentials to open the management menu.
   * Navigate to **System Settings > Network Settings**.

3. **Configure the Cloud / HTTP Server Connection**:
   * Locate the option named **Server Config**, **Cloud Server**, or **HTTP Push Protocol**.
   * Toggle it **ON** (enabled).
   * Input the following parameters:
     * **Server Address (IP)**: Enter your computer's IP address (e.g., `192.168.1.50`).
     * **Port**: Set it to `5000`.
     * **URL Path / Post Address**: Set it to `/api/scan`.

4. **Verify Communication**:
   * Stand in front of the device and scan a face.
   * Verify that the device successfully transmits the scan payload, and that the console output in your server logs shows:
     `--- Received Hanvon Scan Event ---`
     `Payload: { UserID: '1042', ... }`

*Note: Make sure the User IDs configured inside the Hanvon device match the Employee IDs in the ERP database (e.g. `1042` for Abdur Rahaman).*

---

## How to Test Using the Built-In Simulator

If you do not have the physical Hanvon terminal on hand, you can simulate its behaviour completely offline.

1. Open `http://localhost:5000` in your web browser.
2. Click the floating **Terminal Simulator** handle on the right side of the page to slide out the dev panel.
3. **Simulate a Hardware Scan**:
   * Select a mock employee from the dropdown list (e.g., "Md. Abdur Rahaman (ID: 1042)").
   * Click **Simulate Face Recognition Scan**.
   * The simulator triggers a mock POST request to the `/api/scan` endpoint.
   * The page will instantly transition to display that employee's profile and actions grid.
4. **Interact with Payouts**:
   * Click **Base Salary**, **Overtime Pay**, or **Dorm Charge**.
   * Review the amount.
   * Click **Confirm Payment** to execute the payout.
   * On success, a checkmark animation displays along with a receipt. The transaction is persisted to `transactions.json` and visible in the **Recent Payouts Log** at the bottom of the simulator.
5. **Add Custom Mock Profiles**:
   * Fill out the form under "Quick Add Employee (ERP)".
   * Click **Save to ERP Database**.
   * This profile is immediately queryable and will appear in the simulator dropdown.
