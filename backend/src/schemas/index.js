const { z } = require('zod');

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const uuid = z.string().uuid('Must be a valid id');

/** "09:30" — free-text shift times used to reach the late calculation as NaN. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a 24-hour time like 09:30');

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Must be a valid date');

const money = z.coerce.number().finite().min(0, 'Cannot be negative');
const count = z.coerce.number().int().min(0, 'Cannot be negative');

const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(2000).max(2100);

const ROLES = ['Admin', 'CEO', 'COO', 'Team Lead', 'SDR', 'Employee'];
const EMPLOYMENT_STATUS = ['active', 'on_leave', 'terminated', 'resigned'];
const REVIEW_STATUS = ['approved', 'rejected'];
const ATTENDANCE_STATUS = ['present', 'absent', 'half_day', 'leave', 'wfh', 'holiday', 'weekend'];

/**
 * Password policy for staff-set passwords. Deliberately modest — long enough to
 * matter, not so strict that people write it on a sticky note.
 */
const password = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), 'Include upper and lower case letters')
  .refine((v) => /\d/.test(v), 'Include at least one number');

const optionalText = (max = 500) => z.string().trim().max(max).optional().nullable();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const auth = {
  login: z.object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    password: z.string().min(1, 'Password is required'),
  }),

  refresh: z.object({
    token: z.string().min(1, 'Refresh token is required'),
  }),

  googleLogin: z.object({
    idToken: z.string().min(1, 'Google credential is required'),
  }),

  changePassword: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: password,
  }),
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

const employee = {
  create: z.object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    password,
    role: z.enum(ROLES).default('Employee'),
    employeeCode: z.string().trim().min(1, 'Employee code is required').max(32),
    fullName: z.string().trim().min(1, 'Full name is required').max(120),
    designation: z.string().trim().min(1, 'Designation is required').max(120),
    managerId: uuid.optional().nullable(),
    teamIds: z.array(uuid).optional().default([]),
    teamId: uuid.optional().nullable(),
    baseSalary: money.default(0),
    currency: z.string().trim().length(3).default('PKR'),
    phone: optionalText(40),
    birthday: optionalText(40),
    bankAccount: optionalText(120),
    emergencyContact: optionalText(200),
    shiftStart: timeOfDay.default('09:30'),
    shiftEnd: timeOfDay.default('18:30'),
    graceMinutes: z.coerce.number().int().min(0).max(240).default(15),
    zkUserId: optionalText(32),
  }),

  // Admin update. Every field optional — only what is sent gets written.
  update: z.object({
    email: z.string().trim().toLowerCase().email().optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.coerce.boolean().optional(),
    employeeCode: z.string().trim().min(1).max(32).optional(),
    fullName: z.string().trim().min(1).max(120).optional(),
    designation: z.string().trim().min(1).max(120).optional(),
    managerId: uuid.optional().nullable(),
    teamIds: z.array(uuid).optional(),
    teamId: uuid.optional().nullable(),
    baseSalary: money.optional(),
    currency: z.string().trim().length(3).optional(),
    phone: optionalText(40),
    birthday: optionalText(40),
    bankAccount: optionalText(120),
    emergencyContact: optionalText(200),
    shiftStart: timeOfDay.optional(),
    shiftEnd: timeOfDay.optional(),
    graceMinutes: z.coerce.number().int().min(0).max(240).optional(),
    zkUserId: optionalText(32),
    status: z.enum(EMPLOYMENT_STATUS).optional(),
    salaryChangeReason: optionalText(200),
    salaryChangeEffectiveDate: isoDate.optional().nullable(),
  }),

  // What a non-admin may change on their own profile.
  selfUpdate: z.object({
    phone: optionalText(40),
    birthday: optionalText(40),
    emergencyContact: optionalText(200),
    bankAccount: optionalText(120),
  }),
};

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

const attendance = {
  manualPunch: z
    .object({
      employeeId: uuid,
      date: isoDate,
      status: z.enum(ATTENDANCE_STATUS),
      checkIn: isoDate.optional().nullable(),
      checkOut: isoDate.optional().nullable(),
      note: optionalText(300),
    })
    .refine(
      (v) => !v.checkIn || !v.checkOut || new Date(v.checkOut) > new Date(v.checkIn),
      { message: 'Check-out must be after check-in', path: ['checkOut'] }
    ),

  punches: z.object({
    punches: z
      .array(
        z.object({
          deviceUserId: z.union([z.string(), z.number()]),
          timestamp: isoDate,
        })
      )
      .max(20000, 'Too many punches in one batch'),
  }),
};

// ---------------------------------------------------------------------------
// Requests (leave / half-day / WFH / loans)
// ---------------------------------------------------------------------------

const dateRangeShape = {
  startDate: isoDate,
  endDate: isoDate,
  reason: optionalText(500),
};

const endNotBeforeStart = (v) => new Date(v.endDate) >= new Date(v.startDate);
const endNotBeforeStartError = {
  message: 'End date cannot be before start date',
  path: ['endDate'],
};

const request = {
  leave: z
    .object({
      ...dateRangeShape,
      type: z.enum(['annual', 'sick', 'casual', 'unpaid']),
    })
    .refine(endNotBeforeStart, endNotBeforeStartError),

  halfday: z.object({
    date: isoDate,
    reason: optionalText(500),
  }),

  wfh: z.object(dateRangeShape).refine(endNotBeforeStart, endNotBeforeStartError),

  review: z.object({
    status: z.enum(REVIEW_STATUS),
    reviewNote: optionalText(500),
  }),
};

const loan = {
  create: z.object({
    type: z.enum(['loan', 'advance_salary']),
    amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
    reason: optionalText(500),
    repaymentMonth: month.optional().nullable(),
    repaymentYear: year.optional().nullable(),
  }),

  review: z.object({
    status: z.enum(REVIEW_STATUS),
    repaymentMonth: month.optional().nullable(),
    repaymentYear: year.optional().nullable(),
  }),
};

// ---------------------------------------------------------------------------
// Campaigns & commissions
// ---------------------------------------------------------------------------

const slab = z.object({
  minShowups: count,
  maxShowups: count.optional().nullable(),
  rate: money,
  type: z.enum(['per_showup', 'fixed_monthly', 'percentage', 'hybrid']).default('per_showup'),
});

const campaign = {
  create: z.object({
    name: z.string().trim().min(1, 'Campaign name is required').max(120),
    description: optionalText(1000),
    startDate: isoDate.optional().nullable(),
    endDate: isoDate.optional().nullable(),
    monthlyShowupTarget: count.optional(),
    notes: optionalText(1000),
    teamLeadId: uuid.optional().nullable(),
    sdrIds: z.array(uuid).optional().default([]),
  }),

  update: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: optionalText(1000),
    status: z.enum(['active', 'inactive', 'archived']).optional(),
    startDate: isoDate.optional().nullable(),
    endDate: isoDate.optional().nullable(),
    monthlyShowupTarget: count.optional(),
    notes: optionalText(1000),
  }),

  assignMember: z.object({
    employeeId: uuid,
    role: z.enum(['team_lead', 'sdr']),
  }),

  memberStatus: z.object({
    status: z.enum(['active', 'inactive']),
  }),

  structure: z.object({
    name: z.string().trim().min(1, 'Structure name is required').max(120),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    startDate: isoDate.optional().nullable(),
    endDate: isoDate.optional().nullable(),
    // Optional and NOT defaulted: the controller must be able to tell "slabs
    // omitted, leave them alone" from "slabs explicitly []". A default of [] let
    // a rename silently wipe a live structure's bands.
    slabs: z.array(slab).optional(),
  }),

  previewCommission: z.object({
    campaignId: uuid,
    showups: count,
  }),

  performance: z.object({
    employeeId: uuid,
    campaignId: uuid,
    month,
    year,
    meetingsBooked: count.optional(),
    showups: count.optional(),
    noShows: count.optional(),
    cancelledMeetings: count.optional(),
  }),
};

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

// A payroll-run performance field. A blank ('') or null value means "not
// supplied" and is normalised to undefined, so the run leaves the logged
// CampaignPerformance value in place instead of overriding it. Only a real
// number (including a deliberate 0) counts as an override. Without this, the
// client's default-0 for every employee silently paid commission on zero
// show-ups regardless of what was logged.
const runMetric = z.preprocess((v) => (v === '' || v === null ? undefined : v), count.optional());
const runMoney = z.preprocess((v) => (v === '' || v === null ? undefined : v), money.optional());

const payroll = {
  run: z.object({
    month,
    year,
    performance: z
      .array(
        z.object({
          employeeId: uuid,
          showups: runMetric,
          meetingsScheduled: runMetric,
          noShows: runMetric,
          bonus: runMoney,
          bonusNotes: optionalText(300),
          otherDeductions: runMoney,
          deductionNotes: optionalText(300),
        })
      )
      .optional()
      .default([]),
  }),

  manualPdf: z.object({
    fullName: z.string().trim().min(1, 'Employee name is required').max(120),
    employeeCode: z.string().trim().min(1).max(32),
    designation: optionalText(120),
    campaignName: optionalText(120),
    bankAccount: optionalText(120),
    periodMonth: month,
    periodYear: year,
    baseSalary: money,
    attendanceAllowance: money.optional().default(0),
    punctualityAllowance: money.optional().default(0),
    spiff: money.optional().default(0),
    commission: money.optional().default(0),
    bonus: money.optional().default(0),
    bonusNotes: optionalText(300),
    absentsLatesDeduction: money.optional().default(0),
    loansDeduction: money.optional().default(0),
    otherDeductions: money.optional().default(0),
    deductionNotes: optionalText(300),
    isTeamLead: z.coerce.boolean().optional().default(false),
  }),
};

// ---------------------------------------------------------------------------
// Documents & spiffs
// ---------------------------------------------------------------------------

const document = {
  upload: z.object({
    employeeId: uuid,
    name: z.string().trim().min(1, 'Document name is required').max(200),
    type: z.enum(['contract', 'id', 'medical', 'receipt', 'certificate', 'other']),
  }),
};

const spiff = {
  create: z.object({
    employeeId: uuid,
    amount: money.refine((v) => v > 0, 'Amount must be greater than zero'),
    reason: optionalText(300),
    date: isoDate.optional().nullable(),
  }),
};

module.exports = {
  ROLES,
  ADMIN_ROLES: ['Admin', 'CEO', 'COO'],
  SELF_ONLY_ROLES: ['Employee', 'SDR'],
  EMPLOYMENT_STATUS,
  ATTENDANCE_STATUS,
  auth,
  employee,
  attendance,
  request,
  loan,
  campaign,
  payroll,
  document,
  spiff,
};
