require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Security & Parsing Middlewares
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    // Check if the origin matches localhost, 127.0.0.1, or local subnets
    const isLocal = origin.startsWith('http://localhost') || 
                    origin.startsWith('http://127.0.0.1') || 
                    /^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin);
                    
    const allowedOrigins = [
      'https://hris.brandigade.com',
      process.env.FRONTEND_URL
    ].filter(Boolean);

    if (isLocal || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Import Routes
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employee');
const attendanceRoutes = require('./routes/attendance');
const requestRoutes = require('./routes/request');
const campaignRoutes = require('./routes/campaign');
const loanRoutes = require('./routes/loan');
const payrollRoutes = require('./routes/payroll');
const documentRoutes = require('./routes/document');
const systemRoutes = require('./routes/system');

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/system', systemRoutes);

// Global Error Handler
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`HRIS Backend running on port ${PORT}`);
  console.log(`[Biometric Agent] Ingestion endpoint ready at /api/attendance/punches`);

  // Direct TCP pull scheduler (only runs if explicitly enabled, e.g., when server runs on office LAN)
  if (process.env.ENABLE_DIRECT_ZK_SYNC === 'true') {
    const { syncZKTeco } = require('./utils/zkteco');
    const AUTO_SYNC_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours in ms

    console.log(`[Scheduler] Direct ZKTeco TCP auto-sync active (Interval: 2 hours)`);
    setInterval(async () => {
      console.log('[Scheduler] Initiating automatic biometric direct TCP sync...');
      try {
        const result = await syncZKTeco();
        if (result.synced > 0 || result.errors.length > 0) {
          console.log(`[Scheduler] Auto-sync finished. Synced: ${result.synced}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`);
        }
      } catch (err) {
        console.error('[Scheduler] Auto-sync encountered an error:', err.message);
      }
    }, AUTO_SYNC_INTERVAL);
  }
});
