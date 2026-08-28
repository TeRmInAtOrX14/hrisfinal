const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMoney(amount) {
  const n = Math.round(Number(amount)) || 0;
  return `PKR ${n.toLocaleString('en-US')}`;
}

function maskBankAccount(accountStr) {
  if (!accountStr) return 'Not Provided';
  const str = String(accountStr).trim();
  if (str.length <= 4) return str;
  const lastFour = str.slice(-4);
  return '*'.repeat(Math.max(8, str.length - 4)) + lastFour;
}

/**
 * Generates a redesigned, professional payslip PDF and pipes it to a writable stream.
 * Fits on a single A4 page.
 */
function generatePayslipPdf(stream, payslip, company = { name: 'Brandigade', address: 'Karachi, Pakistan' }) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.pipe(stream);

  // ---------------- HEADER SECTION ----------------
  const logoPath = path.join(__dirname, '..', 'public', 'logo.png');
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 48, { width: 175 });
  } else {
    // High-quality modern geometric fallback logo
    doc.save();
    doc.circle(75, 70, 20).fill('#1E3A8A');
    doc.circle(75, 70, 16).fill('#2563EB');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text('B', 69, 63);
    doc.restore();
    doc.fontSize(22).fillColor('#1E3A8A').font('Helvetica-Bold').text('Brandigade', 105, 53);
  }

  // Payslip title & metadata on the right
  doc.fontSize(16).fillColor('#1F2937').font('Helvetica-Bold').text('EMPLOYEE PAYSLIP', 300, 50, { align: 'right', width: 245 });
  doc.fontSize(9).fillColor('#4B5563').font('Helvetica').text(`Payslip for the Month of: ${MONTH_NAMES[payslip.periodMonth - 1]} ${payslip.periodYear}`, 300, 70, { align: 'right', width: 245 });
  doc.fontSize(8).fillColor('#9CA3AF').text(`Generated Date: ${new Date(payslip.generatedAt || Date.now()).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })}`, 300, 85, { align: 'right', width: 245 });

  // Deep Blue accent line
  doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#2563EB').lineWidth(2).stroke();

  // ---------------- EMPLOYEE INFO CARD ----------------
  let y = 120;
  doc.rect(50, y, 495, 80).fill('#F9FAFB').strokeColor('#E5E7EB').lineWidth(1).stroke();

  doc.fillColor('#1F2937').font('Helvetica').fontSize(9);
  
  // Left Column inside card
  doc.font('Helvetica-Bold').text('Name:', 65, y + 12).font('Helvetica').text(payslip.employee.fullName, 140, y + 12);
  doc.font('Helvetica-Bold').text('Designation:', 65, y + 32).font('Helvetica').text(payslip.employee.designation || '-', 140, y + 32);
  const campaignName = payslip.employee.campaignMembers?.[0]?.campaign?.name || 'Operations';
  doc.font('Helvetica-Bold').text('Department:', 65, y + 52).font('Helvetica').text(campaignName, 140, y + 52);

  // Right Column inside card
  doc.font('Helvetica-Bold').text('Employee ID:', 310, y + 12).font('Helvetica').text(payslip.employee.employeeCode, 395, y + 12);
  
  let bankName = 'Meezan Bank';
  let accountNumber = '********1234';
  if (payslip.employee.bankAccount) {
    const parts = payslip.employee.bankAccount.split('-');
    if (parts.length > 1) {
      bankName = parts[0].trim();
      accountNumber = maskBankAccount(parts[1].trim());
    } else {
      accountNumber = maskBankAccount(payslip.employee.bankAccount);
    }
  }
  doc.font('Helvetica-Bold').text('Bank:', 310, y + 32).font('Helvetica').text(bankName, 395, y + 32);
  doc.font('Helvetica-Bold').text('Account No:', 310, y + 52).font('Helvetica').text(accountNumber, 395, y + 52);

  y += 95;

  // ---------------- LINE ITEM DRAWER SETUP ----------------
  function drawSectionHeader(title) {
    doc.fontSize(10).fillColor('#1E3A8A').font('Helvetica-Bold').text(title.toUpperCase(), 50, y);
    y += 13;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#E5E7EB').lineWidth(1).stroke();
    y += 8;
  }

  function drawLineItem(label, amount, isTotal = false) {
    doc.fontSize(9);
    if (isTotal) {
      doc.font('Helvetica-Bold').fillColor('#111827');
      doc.text(label, 50, y);
      doc.text(formatMoney(amount), 50, y, { align: 'right', width: 495 });
      y += 14;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#1E3A8A').lineWidth(1.5).stroke();
      y += 10;
    } else {
      doc.font('Helvetica').fillColor('#4B5563');
      doc.text(label, 50, y);
      doc.font('Helvetica-Bold').fillColor('#111827');
      doc.text(formatMoney(amount), 50, y, { align: 'right', width: 495 });
      y += 14;
    }
  }

  // ---------------- PRE-CALCULATIONS ----------------
  const isTeamLead = payslip.employee.campaignMembers?.[0]?.role === 'team_lead' || 
                     payslip.employee.user?.role === 'Team Lead' ||
                     String(payslip.employee.designation).toLowerCase().includes('team lead');

  const basicSalary = payslip.baseSalary;
  const attendanceAllowance = payslip.attendanceAllowance !== undefined ? payslip.attendanceAllowance : 0;
  const punctualityAllowance = payslip.punctualityAllowance !== undefined ? payslip.punctualityAllowance : 0;
  const spiff = payslip.spiffs || 0;
  const bonus = payslip.bonus || 0;
  
  let sdrCommission = 0;
  let teamCommission = 0;
  
  if (isTeamLead) {
    teamCommission = payslip.commission || 0;
  } else {
    sdrCommission = payslip.commission || 0;
  }
  
  // Formula: Total Additions = Attendance Allowance + Punctuality Allowance + Spiff + Commission + Team Commission + Bonus
  const totalAdditions = attendanceAllowance + punctualityAllowance + spiff + sdrCommission + teamCommission + bonus;
  
  // Formula: Total Deductions = Absents & Lates + Loans + Other Deductions
  const absentsLatesDeduction = (payslip.unpaidLeaveDeduction || 0) + (payslip.lateDeduction || 0);
  const loansDeduction = payslip.loansDeduction || 0;
  const otherDeductions = payslip.otherDeductions || 0;
  const totalDeductions = absentsLatesDeduction + loansDeduction + otherDeductions;
  
  // Formula: Net Payment = (Basic Salary + Total Additions) - Total Deductions
  const netPayment = (basicSalary + totalAdditions) - totalDeductions;

  // ---------------- PAYMENTS SECTION ----------------
  drawSectionHeader('Payments');
  drawLineItem('Basic Salary', basicSalary);
  drawLineItem('Attendance Allowance', attendanceAllowance);
  drawLineItem('Punctuality Allowance', punctualityAllowance);
  y += 8;

  // ---------------- ADDITIONS SECTION ----------------
  drawSectionHeader('Additions');
  drawLineItem('Attendance Allowance', attendanceAllowance);
  drawLineItem('Punctuality Allowance', punctualityAllowance);
  
  if (spiff > 0) {
    drawLineItem('Spiff (Individual Incentive)', spiff);
  }
  
  if (isTeamLead) {
    // Show Team Commission always for Team Lead
    drawLineItem('Team Commission', teamCommission);
  } else if (sdrCommission > 0) {
    // Show Campaign Commission for SDR only if > 0
    drawLineItem('Commission (Campaign Success)', sdrCommission);
  }

  if (bonus > 0) {
    const bonusLabel = 'Bonus' + (payslip.bonusNotes ? ` (${payslip.bonusNotes})` : '');
    drawLineItem(bonusLabel, bonus);
  }
  
  drawLineItem('Total Additions', totalAdditions, true);
  y += 5;

  // ---------------- DEDUCTIONS SECTION ----------------
  drawSectionHeader('Deductions');
  let hasDeductions = false;
  
  if (absentsLatesDeduction > 0) {
    drawLineItem('Absents & Lates Deduction', absentsLatesDeduction);
    hasDeductions = true;
  }
  
  if (loansDeduction > 0) {
    drawLineItem('Advance Salary & Loan Repayment', loansDeduction);
    hasDeductions = true;
  }
  
  if (otherDeductions > 0) {
    const dedLabel = 'Penalty / Other Deductions' + (payslip.deductionNotes ? ` (${payslip.deductionNotes})` : '');
    drawLineItem(dedLabel, otherDeductions);
    hasDeductions = true;
  }
  
  if (!hasDeductions) {
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#9CA3AF').text('No deductions for this period', 50, y);
    y += 14;
  }
  
  drawLineItem('Total Deductions', totalDeductions, true);
  y += 5;

  // ---------------- SALARY SUMMARY CARD ----------------
  doc.rect(50, y, 495, 55).fill('#EFF6FF').strokeColor('#BFDBFE').lineWidth(1).stroke();
  
  doc.fontSize(8).font('Helvetica').fillColor('#1E40AF');
  doc.text('Total Salary & Allowances:', 65, y + 10);
  doc.text(formatMoney(basicSalary + attendanceAllowance + punctualityAllowance), 65, y + 10, { align: 'right', width: 465 });

  doc.text('Total Additions:', 65, y + 22);
  doc.text(formatMoney(totalAdditions), 65, y + 22, { align: 'right', width: 465 });

  doc.text('Total Deductions:', 65, y + 34);
  doc.text(formatMoney(totalDeductions), 65, y + 34, { align: 'right', width: 465 });

  y += 65;

  // Prominent Net Payment bar
  doc.rect(50, y, 495, 32).fill('#1E3A8A');
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#FFFFFF');
  doc.text('NET PAYMENT PAYOUT', 65, y + 10);
  doc.fontSize(12);
  doc.text(formatMoney(netPayment), 65, y + 10, { align: 'right', width: 465 });

  y += 50;

  // ---------------- FOOTER & NOTES ----------------
  doc.fontSize(8).font('Helvetica').fillColor('#9CA3AF');
  doc.text('This is a system-generated payslip and does not require a signature.', 50, y, { align: 'center', width: 495 });
  y += 11;
  doc.font('Helvetica-Bold').fillColor('#4B5563');
  doc.text('Brandigade HR Department', 50, y, { align: 'center', width: 495 });
  y += 10;
  doc.font('Helvetica').fillColor('#9CA3AF');
  doc.text('Generated Automatically by Brandigade HRIS', 50, y, { align: 'center', width: 495 });

  doc.end();
}

module.exports = { generatePayslipPdf };
