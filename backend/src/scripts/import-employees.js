require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const prisma = require('../lib/prisma');

/**
 * Bulk employee import from a CSV.
 *
 * Onboarding an existing workforce one form at a time is not realistic, and the
 * API only creates employees singly. This reads the columns the HR sheet uses,
 * validates the whole file first, and only then writes.
 *
 * It is a DRY RUN unless --commit is passed. A dry run reports exactly what it
 * would do and touches nothing, so the sheet can be corrected and re-run until
 * it is clean.
 *
 *   node src/scripts/import-employees.js staff.csv
 *   node src/scripts/import-employees.js staff.csv --commit
 *   node src/scripts/import-employees.js staff.csv --commit --create-campaigns
 *
 * Passwords are generated, never read from the sheet: a shared value such as
 * "1234" fails the password policy and would leave every account with the same
 * credential. Every account is flagged mustChangePassword, and the generated
 * passwords go to a separate CSV for distribution.
 */

const ROLES = ['Admin', 'CEO', 'COO', 'Team Lead', 'SDR', 'Employee'];
const CAMPAIGN_ROLES = ['team_lead', 'sdr'];
const STATUSES = ['active', 'on_leave', 'terminated', 'resigned'];

/**
 * Campaigns for one row. A Team Lead can run more than one, so the column takes
 * a semicolon-separated list: "Logics;Patient Wing" produces a membership in
 * each, with the same campaignRole.
 */
const campaignsOf = (row) =>
  String(row.campaign || '')
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const COMMIT = args.includes('--commit');
const CREATE_CAMPAIGNS = args.includes('--create-campaigns');

if (!file) {
  console.error('Usage: node src/scripts/import-employees.js <file.csv> [--commit] [--create-campaigns]');
  process.exit(1);
}

/** Minimal CSV parser: quoted fields, embedded commas and newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') { continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const header = rows.shift().map((h) => h.replace(/^﻿/, '').trim());
  return rows
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

/** 20 characters of base64url, comfortably clearing the password policy. */
const generatePassword = () => crypto.randomBytes(15).toString('base64url');

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validate(rows) {
  const errors = [];
  const seenCode = new Map();
  const seenEmail = new Map();
  const seenZk = new Map();

  rows.forEach((r, i) => {
    const line = i + 2;
    const at = (msg) => errors.push('line ' + line + ' (' + (r.employeeCode || '?') + '): ' + msg);

    if (!r.employeeCode) at('employeeCode is required');
    if (!r.fullName) at('fullName is required');
    if (!r.email) at('email is required');
    else if (!EMAIL.test(r.email)) at('email "' + r.email + '" is not valid');
    if (!r.designation) at('designation is required');

    if (!r.role) at('role is required');
    else if (!ROLES.includes(r.role)) at('role "' + r.role + '" must be one of: ' + ROLES.join(', '));

    if (r.campaignRole && !CAMPAIGN_ROLES.includes(r.campaignRole)) {
      at('campaignRole "' + r.campaignRole + '" must be team_lead or sdr');
    }
    if (r.campaignRole && !r.campaign) at('campaignRole is set but campaign is empty');

    if (r.status && !STATUSES.includes(r.status)) {
      at('status "' + r.status + '" must be one of: ' + STATUSES.join(', '));
    }

    if (!r.baseSalary) at('baseSalary is empty - payroll cannot run without it');
    else if (Number.isNaN(Number(r.baseSalary))) at('baseSalary "' + r.baseSalary + '" is not a number');

    if (r.shiftStart && !TIME.test(r.shiftStart)) at('shiftStart "' + r.shiftStart + '" must be HH:MM, 24-hour');
    if (r.shiftEnd && !TIME.test(r.shiftEnd)) at('shiftEnd "' + r.shiftEnd + '" must be HH:MM, 24-hour');

    if (!r.zkUserId) at('zkUserId is empty - biometric punches will not match this person');

    const dup = (map, key, label) => {
      if (!key) return;
      if (map.has(key)) at(label + ' "' + key + '" is also on line ' + map.get(key));
      else map.set(key, line);
    };
    dup(seenCode, r.employeeCode, 'employeeCode');
    dup(seenEmail, (r.email || '').toLowerCase(), 'email');
    dup(seenZk, r.zkUserId, 'zkUserId');
  });

  const codes = new Set(rows.map((r) => r.employeeCode));
  rows.forEach((r, i) => {
    if (r.managerCode && r.managerCode === r.employeeCode) {
      errors.push('line ' + (i + 2) + ' (' + r.employeeCode + '): managerCode points at itself');
    } else if (r.managerCode && !codes.has(r.managerCode)) {
      errors.push(
        'line ' + (i + 2) + ' (' + r.employeeCode + '): managerCode "' + r.managerCode + '" is not in this file'
      );
    }
  });

  return errors;
}

async function main() {
  const rows = parseCsv(fs.readFileSync(path.resolve(file), 'utf8'));
  console.log('\nRead ' + rows.length + ' rows from ' + file + '\n');

  const errors = validate(rows);
  if (errors.length > 0) {
    console.error('Validation failed - ' + errors.length + ' problem(s). Nothing was written.\n');
    errors.forEach((e) => console.error('  ' + e));
    console.error('\nFix the sheet and run again.');
    process.exitCode = 1;
    return;
  }
  console.log('Validation passed.\n');

  const wanted = [...new Set(rows.flatMap(campaignsOf))];
  const existingCampaigns = await prisma.campaign.findMany({ where: { name: { in: wanted } } });
  const campaignByName = new Map(existingCampaigns.map((c) => [c.name, c]));
  const missing = wanted.filter((n) => !campaignByName.has(n));

  if (missing.length > 0 && !CREATE_CAMPAIGNS) {
    console.error('These campaigns do not exist yet:');
    missing.forEach((m) => console.error('  - ' + m));
    console.error('\nCreate them first with their commission structures, or pass');
    console.error('--create-campaigns to create them empty and add structures afterwards.');
    process.exitCode = 1;
    return;
  }

  const existingByCode = await prisma.employee.findMany({
    where: { employeeCode: { in: rows.map((r) => r.employeeCode) } },
    select: { employeeCode: true },
  });
  const already = new Set(existingByCode.map((e) => e.employeeCode));
  const toCreate = rows.filter((r) => !already.has(r.employeeCode));

  console.log(toCreate.length + ' employee(s) to create, ' + already.size + ' already present (skipped).\n');

  if (!COMMIT) {
    console.log('DRY RUN - nothing written. Re-run with --commit to apply.\n');
    if (missing.length > 0) console.log('Would create campaigns: ' + missing.join(', ') + '\n');
    toCreate.forEach((r) => {
      console.log(
        '  ' +
          r.employeeCode.padEnd(10) +
          r.fullName.padEnd(22) +
          r.role.padEnd(11) +
          (r.campaign || '-').padEnd(24) +
          'salary=' + r.baseSalary + ' zk=' + r.zkUserId
      );
    });
    return;
  }

  for (const name of missing) {
    const created = await prisma.campaign.create({ data: { name } });
    campaignByName.set(name, created);
    console.log('  created campaign ' + name);
  }

  const credentials = [];
  const createdByCode = new Map();

  for (const r of toCreate) {
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(12));

    const employee = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: r.email.toLowerCase(),
          passwordHash,
          role: r.role,
          mustChangePassword: true,
        },
      });

      return tx.employee.create({
        data: {
          userId: user.id,
          employeeCode: r.employeeCode,
          fullName: r.fullName,
          designation: r.designation,
          status: r.status || 'active',
          baseSalary: Number(r.baseSalary),
          currency: r.currency || 'PKR',
          phone: r.phone || null,
          birthday: r.birthday || null,
          bankAccount: r.bankAccount || null,
          emergencyContact: r.emergencyContact || null,
          shiftStart: r.shiftStart || '09:30',
          shiftEnd: r.shiftEnd || '18:30',
          graceMinutes: r.graceMinutes ? Number(r.graceMinutes) : 15,
          zkUserId: r.zkUserId || null,
        },
      });
    });

    createdByCode.set(r.employeeCode, employee);
    credentials.push({ employeeCode: r.employeeCode, fullName: r.fullName, email: r.email, password });
    console.log('  created ' + r.employeeCode + ' ' + r.fullName);
  }

  // Managers second, so a manager listed later in the file still resolves.
  for (const r of toCreate) {
    if (!r.managerCode) continue;
    const self = createdByCode.get(r.employeeCode);
    let manager = createdByCode.get(r.managerCode);
    if (!manager) manager = await prisma.employee.findUnique({ where: { employeeCode: r.managerCode } });
    if (self && manager) {
      await prisma.employee.update({ where: { id: self.id }, data: { managerId: manager.id } });
    }
  }

  // Campaign membership last, and it never writes User.role: assigning someone
  // to a campaign used to overwrite their account role and lock admins out.
  for (const r of toCreate) {
    const employee = createdByCode.get(r.employeeCode);
    if (!employee) continue;

    for (const name of campaignsOf(r)) {
      const campaign = campaignByName.get(name);
      if (!campaign) continue;

      await prisma.campaignMember.upsert({
        where: { campaignId_employeeId: { campaignId: campaign.id, employeeId: employee.id } },
        update: { role: r.campaignRole || 'sdr', status: 'active' },
        create: {
          campaignId: campaign.id,
          employeeId: employee.id,
          role: r.campaignRole || 'sdr',
          status: 'active',
        },
      });
      console.log('  ' + r.employeeCode + ' -> ' + name + ' (' + (r.campaignRole || 'sdr') + ')');
    }
  }

  const out = path.resolve('import-credentials.csv');
  const lines = credentials.map(
    (c) => c.employeeCode + ',"' + c.fullName + '",' + c.email + ',' + c.password
  );
  fs.writeFileSync(out, 'employeeCode,fullName,email,password\n' + lines.join('\n') + '\n');

  console.log('\nCreated ' + credentials.length + ' employee(s).');
  console.log('Passwords written to ' + out + ' - distribute them, then delete the file.');
  console.log('Every account must change its password at first sign-in.');
}

main()
  .catch((err) => {
    console.error('\nImport failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
