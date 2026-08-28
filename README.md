# Brandigade HRIS & Biometric Attendance System

**Brandigade HRIS** is an enterprise-grade, full-stack Human Resource Information System and Biometric Sync suite built for Brandigade. It manages employee lifecycles, org charts, request workflows, campaign & SDR performance tracking, dynamic commission slabs, spiffs, loans, biometric attendance, and automated payroll with PDF payslips.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Office_LAN["Office Local Network (LAN)"]
        ZK["ZKTeco Biometric Device\n(UFace 800 / Face & Fingerprint)"]
        Agent["Biometric Sync Agent\n(sync-agent Node.js CLI)"]
        TaskSch["Windows Task Scheduler / Cron\n(Runs every 5-15 mins)"]
        
        TaskSch --> Agent
        Agent -- "Reads punches via TCP 4370 (node-zklib)" --> ZK
    end

    subgraph Hosting_Cloud["Cloud Hosting (Namecheap / Vercel / VPS)"]
        API["Brandigade HRIS Backend API\n(Express.js Node 22+)"]
        AuthMiddleware["Sync Agent Auth\n(x-sync-token validation)"]
        DB[(Database\nPostgreSQL / Supabase / Namecheap MySQL)]
        Frontend["Brandigade HRIS Frontend\n(React / Modern Web Interface)"]
        
        API <--> DB
        Frontend <--> API
    end

    Agent -- "HTTP POST /api/attendance/punches (HTTPS)" --> AuthMiddleware --> API
```

---

## Key Modules & Features

### 1. Authentication & Security
- **Multi-Tenant Auth**: JWT Bearer authentication with short-lived access tokens and refresh tokens.
- **Google SSO**: One-click Google Sign-In (`Sign in with Google`).
- **First-Time Login Security**: Enforced password change upon initial account creation.
- **Sync Agent Auth**: Dedicated `x-sync-token` security layer for off-site biometric log ingestion.

### 2. Employee Records & Org Chart
- **360° Employee Profiles**: Full name, employee code (`EMP-001`), designation, phone, bank details, emergency contacts, photo, and shift parameters.
- **Biometric Linking**: `zkUserId` / `employeeCode` automatic mapping to biometric hardware IDs.
- **Hierarchical Org Chart**: Built automatically from manager-subordinate relations.
- **Compensation History**: Full audit trail of salary increments with effective dates and reasons.

### 3. Biometric Attendance & Shift Management
- **Remote Biometric Ingestion**: Office-side `sync-agent` reads hardware attendance logs and pushes them to cloud/Namecheap API over HTTPS.
- **Smart Punch Deduplication & Merging**: Earliest punch recorded as `checkIn`.
- **Late Minutes & Grace Period**: Automatic late minute calculation against employee shift start (`09:30`) and custom grace periods (`15 mins`).
- **Summary Metrics**: Monthly present days, late count, total late minutes, half-days, and leave totals.

### 4. Employee Self-Service & Request Workflows
- **Leave Requests**: Annual, Sick, Casual, Unpaid leave applications with manager approval/rejection workflow.
- **Half-Day Requests**: Single-click half-day applications.
- **Work From Home (WFH) Requests**: Date range WFH requests with approval status tracking.

### 5. SDR & Campaign Performance Tracking
- **Campaign Management**: Active/inactive campaigns with monthly show-up targets.
- **Team Allocation**: Assign Team Leads and SDRs to campaigns (`CampaignMember`).
- **Performance Logging**: Monthly performance metrics per SDR (Meetings Booked, Show-ups, No-shows, Cancelled Meetings).

### 6. Dynamic Commission Slabs & Spiffs
- **Slab-Based Commissions**: Tiered show-up commission rates (e.g., 1–10 showups @ $10/ea, 11–20 @ $15/ea, 21+ @ $20/ea).
- **Spiff Incentives**: Manager/Admin awarded one-off cash spiffs with audit reasons.

### 7. Loans & Salary Advances
- **Employee Loan Requests**: Request salary advances or loans with specified repayment target month/year.
- **Automated Deduction Engine**: Automatically deducts approved loan repayments during monthly payroll processing.

### 8. Payroll Engine & PDF Payslips
- **Automated Monthly Payroll**: Computes base salary, pro-rated attendance deductions, late penalties, loan repayments, spiffs, and commissions.
- **Automated PDF Payslips**: Generates downloadable PDF payslips using `PDFKit`.

### 9. Integrated Brandigade Dialer Launcher
- **Desktop & Web Integration**: One-click **"Brandigade Dialer"** button embedded in the main navigation header and SDR dashboard.
- **Smart Protocol Fallback**: Attempts to launch the native desktop application (`brandigadedialer://`). If the desktop app is not installed, it automatically opens `https://dialer.brandigade.com` in Google Chrome / browser tab.

---

## Role-Based Access Control (RBAC) Matrix

| Feature / Module | Admin / CEO / COO | Team Lead | SDR / Regular Employee |
| :--- | :---: | :---: | :---: |
| **Manage Employees & Salaries** | Full Access | Read-Only | Read Self Only |
| **View Org Chart** | Full Access | Full Access | Full Access |
| **Approve / Reject Requests** | Full Access | Team Members Only | Self Only (Submit) |
| **Biometric Attendance** | View All / Manual Override | Team Members Only | Self Only |
| **Campaign & Performance Management** | Full Access | Assigned Campaigns | Self Performance |
| **Manage Commission Slabs** | Full Access | Read-Only | No Access |
| **Award Spiffs** | Full Access | Team Members | No Access |
| **Payroll & Payslip Generation** | Full Access | No Access | View Own Payslip |
| **Audit Logs & System Settings** | Full Access | No Access | No Access |

---

## Database Architecture

The system uses **Prisma ORM** for type-safe database access.

### Supported Databases
1. **PostgreSQL / Supabase** (Default): Configured in `prisma/schema.prisma` with connection pooling (`DATABASE_URL` & `DIRECT_URL`).
2. **Namecheap MySQL / MariaDB**: If deploying to standard cPanel hosting with MySQL, change the provider in `prisma/schema.prisma` to `"mysql"`.

```prisma
datasource db {
  provider  = "postgresql" // or "mysql" for Namecheap cPanel MySQL
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

---

## Deploying to Namecheap & Setup Guide

### Step 1: Upload & Install HRIS Backend on Namecheap
1. Log into **cPanel** on Namecheap.
2. Open **Setup Node.js App** and create a new Node application:
   - **Node.js Version**: 20.x or 22.x
   - **Application Root**: `backend`
   - **Application Startup File**: `src/server.js`
3. Upload the `backend` code directory to your Namecheap server.
4. Create a database in Namecheap cPanel (**MySQL Databases** or **PostgreSQL Databases**).
5. In your Node App dashboard on cPanel, add Environment Variables:
   ```env
   PORT=4000
   DATABASE_URL="postgresql://user:pass@localhost:5432/brandigade_hris"
   JWT_SECRET="your_generated_jwt_secret"
   SYNC_AGENT_TOKEN="your_strong_sync_secret_token"
   OFFICE_START_TIME="09:30"
   COMPANY_NAME="Brandigade"
   ```
6. Run `npm install` and `npx prisma db push` via cPanel terminal.

---

### Step 2: Setting Up the Office `sync-agent`
The `sync-agent` runs on a machine located in your office network that can reach the ZKTeco device IP.

1. Open `sync-agent/.env` on the office machine:
   ```env
   HRIS_API_URL=https://hris.brandigade.com/api
   SYNC_AGENT_TOKEN=your_strong_sync_secret_token
   ZKTECO_IP=192.168.1.100
   ZKTECO_PORT=4370
   LOOKBACK_DAYS=3
   ```
2. Install dependencies:
   ```bash
   cd sync-agent
   npm install
   ```
3. Test sync execution:
   ```bash
   npm start
   ```
4. **Automate Execution**:
   - **Windows**: Add a Task in **Task Scheduler** to run `node index.js` every 10 minutes.
   - **Linux**: Add a `cron` job: `*/10 * * * * cd /path/to/sync-agent && node index.js >> sync.log 2>&1`.

---

## Seeding Employee Data

To seed or import initial employee records:
1. Provide your CSV/Excel employee sheet.
2. Run the importer:
   ```bash
   npm run seed
   ```

---

## License & Support
Built for internal use at **Brandigade**. All rights reserved.
