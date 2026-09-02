import React, { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import {
  Plus,
  Play,
  Download,
  X,
  Loader2
} from 'lucide-react';
import api, { session, apiError, openAuthedFile } from '../utils/api';
import toast from 'react-hot-toast';
import { isAdmin as isAdminRole } from '../utils/roles';
import { money, amount, MONTH_NAMES, payrollYears, longDate } from '../utils/format';

export default function Payroll() {
  const [runs, setRuns] = useState([]);
  const [draftPayslips, setDraftPayslips] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);

  const currentUser = session.user || { role: 'Employee' };
  const isAdmin = isAdminRole(currentUser);
  
  const { register, handleSubmit, control, reset } = useForm({
    defaultValues: {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      performance: []
    }
  });

  const manualForm = useForm({
    defaultValues: {
      fullName: '',
      employeeCode: '',
      designation: '',
      campaignName: '',
      bankAccount: '',
      periodMonth: new Date().getMonth() + 1,
      periodYear: new Date().getFullYear(),
      baseSalary: '',
      attendanceAllowance: 2500,
      punctualityAllowance: 2500,
      spiff: 0,
      commission: 0,
      bonus: 0,
      bonusNotes: '',
      absentsLatesDeduction: 0,
      loansDeduction: 0,
      otherDeductions: 0,
      deductionNotes: '',
      isTeamLead: false
    }
  });

  const handleGenerateManual = async (data) => {
    try {
      toast.loading('Generating manual payslip...', { id: 'manual-gen' });
      const res = await api.post('/payroll/generate-manual-pdf', data, { responseType: 'blob' });
      const fileURL = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      window.open(fileURL, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(fileURL), 60_000);
      toast.success('Payslip generated.', { id: 'manual-gen' });
      setManualModalOpen(false);
      manualForm.reset();
    } catch (e) {
      toast.error(apiError(e, 'Failed to generate the payslip.'), { id: 'manual-gen' });
    }
  };

  const { fields, replace } = useFieldArray({
    control,
    name: 'performance'
  });

  const fetchPayrollData = async () => {
    try {
      setLoading(true);
      if (isAdmin) {
        const runsRes = await api.get('/payroll/runs');
        setRuns(runsRes.data);
        
        const empRes = await api.get('/employees');

        // Prep the performance array. Fields start BLANK, not 0: a blank field
        // means "use the show-ups/meetings already logged for this month" — the
        // run only overrides a metric the admin actually types in. Seeding 0s
        // here used to override the logged CampaignPerformance with zero, paying
        // commission on no show-ups.
        const perfDefaults = empRes.data.map(emp => ({
          employeeId: emp.id,
          fullName: emp.fullName,
          showups: '',
          meetingsScheduled: '',
          noShows: '',
          bonus: '',
          bonusNotes: '',
          otherDeductions: '',
          deductionNotes: ''
        }));
        replace(perfDefaults);
      } else {
        const res = await api.get('/payroll/my-payslips');
        setRuns(res.data);
      }
    } catch (e) {
      toast.error(apiError(e, 'Failed to load payroll data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayrollData();
    // Intentional mount-once fetch. These callbacks are recreated on every
    // render, so listing them here would re-fetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunPayroll = async (data) => {
    try {
      toast.loading('Computing payroll parameters...', { id: 'payroll-run' });
      // Send blank fields as null (not 0) so the backend keeps the logged
      // performance figure instead of overriding it with zero. Only a value the
      // admin actually typed becomes an override.
      const numOrNull = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      // Counts are whole numbers on the API; truncate so "5.5" typed into a
      // show-ups box becomes 5 instead of a validation error. Negatives are
      // left alone so the API's clear "must be >= 0" error surfaces.
      const intOrNull = (v) => {
        const n = numOrNull(v);
        return n === null ? null : Math.trunc(n);
      };
      const res = await api.post('/payroll/run', {
        month: parseInt(data.month),
        year: parseInt(data.year),
        performance: data.performance.map(p => ({
          employeeId: p.employeeId,
          showups: intOrNull(p.showups),
          meetingsScheduled: intOrNull(p.meetingsScheduled),
          noShows: intOrNull(p.noShows),
          bonus: numOrNull(p.bonus),
          bonusNotes: p.bonusNotes,
          otherDeductions: numOrNull(p.otherDeductions),
          deductionNotes: p.deductionNotes
        }))
      });

      toast.success('Payroll calculated! Reviewing draft payslips.', { id: 'payroll-run' });
      setSelectedRun(res.data.payrollRun);
      setDraftPayslips(res.data.payslips);
      setRunModalOpen(false);
      reset();
      fetchPayrollData();
    } catch (e) {
      // The API returns 409 when the period is already finalized; surfacing
      // its message is far more useful than a generic failure toast.
      toast.error(apiError(e, 'Failed to calculate payroll.'), { id: 'payroll-run' });
    }
  };

  const handleFinalize = async (runId) => {
    // Finalizing issues payslips and locks the period against recalculation.
    if (
      !window.confirm(
        'Finalize this payroll run?\n\nPayslips will be issued to employees and this period can no longer be recalculated.'
      )
    ) {
      return;
    }

    try {
      toast.loading('Finalizing payroll and generating PDFs...', { id: 'payroll-finalize' });
      const res = await api.put(`/payroll/runs/${runId}/finalize`);
      const failures = res.data.storageFailures || [];
      if (failures.length > 0) {
        toast.error(
          `Payroll finalized, but ${failures.length} payslip PDF(s) could not be archived.`,
          { id: 'payroll-finalize', duration: 8000 }
        );
      } else {
        toast.success('Payroll run finalized.', { id: 'payroll-finalize' });
      }
      
      setSelectedRun(null);
      setDraftPayslips([]);
      fetchPayrollData();
    } catch (e) {
      toast.error(apiError(e, 'Failed to finalize payroll.'), { id: 'payroll-finalize' });
    }
  };

  const fetchPayslipsOfRun = async (run) => {
    try {
      setSelectedRun(run);
      const res = await api.get(`/payroll/runs/${run.id}/payslips`);
      setDraftPayslips(res.data);
    } catch (e) {
      toast.error(apiError(e, 'Failed to load payslips for this run.'));
    }
  };

  const handleDownloadPdf = async (payslipId) => {
    try {
      // Fetched with the Authorization header and opened as a blob, so the
      // access token never appears in a URL.
      await openAuthedFile(`/payroll/payslips/${payslipId}/pdf`);
    } catch (err) {
      toast.error(apiError(err, 'Could not open the payslip.'));
    }
  };

  // MONTH_NAMES now comes from utils/format so every screen agrees.

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase">Payroll & Payslips</h2>
          <p className="text-xs text-brand-text-soft mt-1">Review finalized monthly payroll payouts or process target campaign data.</p>
        </div>
        {isAdmin && (
          <div className="flex gap-3">
            <button
              onClick={() => setManualModalOpen(true)}
              className="px-5 py-2.5 rounded-full border border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan hover:scale-[1.02] active:scale-[0.98] font-bold font-display text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Generate Manual Payslip
            </button>
            <button
              onClick={() => setRunModalOpen(true)}
              className="px-5 py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg hover:scale-[1.02] active:scale-[0.98] font-bold font-display text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-blue/20"
            >
              <Play className="w-4 h-4" />
              Process New Month
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
        </div>
      ) : !isAdmin ? (
        /* ---------------- Employee View ---------------- */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {runs.map(payslip => (
            <div key={payslip.id} className="p-5 rounded-2xl glass-panel space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-[10px] font-bold text-brand-text-soft uppercase tracking-widest">Finalized Payslip</h3>
                  <p className="text-lg font-extrabold text-brand-text font-display mt-2">
                    {MONTH_NAMES[payslip.payrollRun?.periodMonth - 1]} {payslip.payrollRun?.periodYear}
                  </p>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold border bg-brand-green/10 text-brand-green border-brand-green/20 uppercase tracking-wider">
                  Paid
                </span>
              </div>

              <div className="border-t border-brand-border pt-3 flex justify-between items-center">
                <div>
                  <span className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Net Salary Payout</span>
                  <p className="text-base font-extrabold text-brand-text mt-1 font-mono tabular-nums">{money(payslip.netPay)}</p>
                </div>

                <button
                  onClick={() => handleDownloadPdf(payslip.id)}
                  className="p-2.5 rounded-xl border border-brand-border hover:border-brand-blue-soft text-brand-text-soft hover:text-brand-text transition-colors cursor-pointer"
                  title="View / Print PDF"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ---------------- Admin View ---------------- */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* History Lists */}
          <div className="lg:col-span-1 space-y-4">
            <h3 className="text-xs font-bold text-brand-text uppercase tracking-widest font-display border-b border-brand-border pb-2">Payroll Runs History</h3>
            <div className="space-y-3">
              {runs.map(run => (
                <div
                  key={run.id}
                  onClick={() => fetchPayslipsOfRun(run)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer text-left ${
                    selectedRun?.id === run.id
                      ? 'border-brand-blue/50 bg-brand-blue/5'
                      : 'border-brand-border bg-brand-bg-soft/40 hover:border-brand-border-strong'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <p className="text-sm font-extrabold text-brand-text font-display">
                      {MONTH_NAMES[run.periodMonth - 1]} {run.periodYear}
                    </p>
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-extrabold border uppercase tracking-wider ${
                      run.status === 'finalized'
                        ? 'bg-brand-green/10 text-brand-green border-brand-green/20'
                        : 'bg-brand-blue/10 text-brand-cyan border-brand-blue/20'
                    }`}>
                      {run.status}
                    </span>
                  </div>
                  <p className="text-[9px] text-brand-text-mute font-mono mt-1">
                    {longDate(run.createdAt)}
                    {run.payslipCount !== undefined && ` · ${run.payslipCount} payslips`}
                    {run.totalNetPay ? ` · ${money(run.totalNetPay)}` : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Detailed Run View */}
          <div className="lg:col-span-2 space-y-6">
            {selectedRun ? (
              <div className="p-6 rounded-2xl glass-panel space-y-5">
                <div className="flex justify-between items-center border-b border-brand-border pb-4">
                  <div>
                    <h3 className="text-base font-extrabold text-brand-text font-display">
                      Run Details: {MONTH_NAMES[selectedRun.periodMonth - 1]} {selectedRun.periodYear}
                    </h3>
                    <p className="text-xs text-brand-text-soft mt-1">Includes {draftPayslips.length} calculated payslips.</p>
                  </div>

                  {selectedRun.status === 'draft' && (
                    <button
                      onClick={() => handleFinalize(selectedRun.id)}
                      className="px-5 py-2 rounded-full bg-brand-green hover:bg-brand-green/80 text-xs font-bold text-brand-bg transition-colors cursor-pointer shadow-lg shadow-brand-green/15"
                    >
                      Finalize & Generate PDFs
                    </button>
                  )}
                </div>

                {/* Payslip Sub-table */}
                <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                  {draftPayslips.map(payslip => (
                    <div key={payslip.id} className="p-4 rounded-xl border border-brand-border bg-brand-bg-soft/40 flex flex-col sm:flex-row justify-between sm:items-center gap-4 text-xs text-brand-text-soft">
                      <div>
                        <p className="font-bold text-brand-text">{payslip.employee?.fullName}</p>
                        <p className="text-[10px] text-brand-text-mute mt-0.5">{payslip.employee?.designation}</p>
                      </div>

                      <div className="flex items-center gap-4 justify-between sm:justify-end w-full sm:w-auto">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-left sm:text-right font-mono text-[11px]">
                          <div>
                            <span className="text-[8px] text-brand-text-mute uppercase block font-semibold">Base pay</span>
                            <span className="text-brand-text font-medium">{amount(payslip.baseSalary)}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-brand-text-mute uppercase block font-semibold">Incentives</span>
                            <span className="text-brand-green font-bold">{amount(payslip.commission + payslip.spiffs + payslip.bonus)}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-brand-text-mute uppercase block font-semibold">Deductions</span>
                            <span className="text-brand-amber font-bold">{amount(payslip.unpaidLeaveDeduction + payslip.lateDeduction + payslip.loansDeduction + payslip.otherDeductions)}</span>
                          </div>
                          <div>
                            <span className="text-[8px] text-brand-text-mute uppercase block font-semibold font-sans">Net Pay</span>
                            <span className="text-brand-text font-extrabold text-xs">{amount(payslip.netPay)}</span>
                          </div>
                        </div>

                        {selectedRun.status === 'finalized' && (
                          <button
                            onClick={() => handleDownloadPdf(payslip.id)}
                            className="p-2 rounded-xl border border-brand-border hover:border-brand-blue-soft text-brand-text-soft hover:text-brand-text transition-all cursor-pointer shrink-0"
                            title="Download PDF"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-8 text-center border border-dashed border-brand-border rounded-2xl">
                <p className="text-xs text-brand-text-soft">Select a payroll run from the history panel to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Run Payroll Modal ---------------- */}
      {runModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setRunModalOpen(false)} />
          <div className="bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 w-full max-w-4xl shadow-glow relative z-50 text-left max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-brand-border pb-3 mb-6">
              <h3 className="text-sm font-extrabold text-brand-text uppercase font-display">Compute Monthly Payroll Payouts</h3>
              <button onClick={() => setRunModalOpen(false)} className="p-1 rounded text-brand-text-soft hover:text-brand-text cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            
            <form onSubmit={handleSubmit(handleRunPayroll)} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Select Month</label>
                  <select {...register('month')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer">
                    {MONTH_NAMES.map((m, idx) => (
                      <option key={m} value={idx + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Select Year</label>
                  <select {...register('year')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer">
                    {payrollYears().map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Performance fields */}
              <div className="space-y-4">
                <h4 className="text-xs font-bold text-brand-text uppercase tracking-widest font-display">Input SDR Campaign Metrics</h4>
                <p className="text-[10px] text-brand-text-mute leading-relaxed -mt-1">
                  Leave a field <b>blank</b> to use the show-ups &amp; meetings already logged for this month
                  (by the SDR or their Team Lead). Enter a number only to override the logged figure.
                </p>
                <div className="space-y-3.5 max-h-80 overflow-y-auto pr-2">
                  {fields.map((field, index) => (
                    <div key={field.id} className="p-4 rounded-xl border border-brand-border bg-brand-bg/40 space-y-4">
                      <div className="flex justify-between items-center border-b border-brand-border pb-2">
                        <span className="text-xs font-bold text-brand-text">{field.fullName}</span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                        <div>
                          <label className="block text-[9px] text-brand-text-mute uppercase font-bold tracking-wider mb-1">Showups</label>
                          <input type="number" min="0" placeholder="logged" {...register(`performance.${index}.showups`)} className="w-full px-2.5 py-1.5 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue placeholder:text-brand-text-mute/50" />
                        </div>
                        <div>
                          <label className="block text-[9px] text-brand-text-mute uppercase font-bold tracking-wider mb-1">Scheduled</label>
                          <input type="number" min="0" placeholder="logged" {...register(`performance.${index}.meetingsScheduled`)} className="w-full px-2.5 py-1.5 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue placeholder:text-brand-text-mute/50" />
                        </div>
                        <div>
                          <label className="block text-[9px] text-brand-text-mute uppercase font-bold tracking-wider mb-1">No-Shows</label>
                          <input type="number" min="0" placeholder="logged" {...register(`performance.${index}.noShows`)} className="w-full px-2.5 py-1.5 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue placeholder:text-brand-text-mute/50" />
                        </div>
                        <div>
                          <label className="block text-[9px] text-brand-text-mute uppercase font-bold tracking-wider mb-1">Bonus Amount</label>
                          <input type="number" {...register(`performance.${index}.bonus`)} className="w-full px-2.5 py-1.5 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue" />
                        </div>
                        <div>
                          <label className="block text-[9px] text-brand-text-mute uppercase font-bold tracking-wider mb-1">Bonus Note</label>
                          <input type="text" {...register(`performance.${index}.bonusNotes`)} placeholder="e.g. Sales winner" className="w-full px-2.5 py-1.5 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button type="submit" className="w-full py-3 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow-md shadow-brand-blue/15">Calculate Draft Run</button>
            </form>
          </div>
        </div>
      )}
      {/* ---------------- Manual Payslip Generator Modal ---------------- */}
      {manualModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setManualModalOpen(false)} />
          <div className="bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 w-full max-w-2xl shadow-glow relative z-50 text-left max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-brand-border pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-brand-text uppercase font-display">Manual Payslip Generator</h3>
              <button onClick={() => setManualModalOpen(false)} className="p-1 rounded text-brand-text-soft hover:text-brand-text cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            
            <form onSubmit={manualForm.handleSubmit(handleGenerateManual)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Employee Name</label>
                  <input type="text" {...manualForm.register('fullName', { required: true })} placeholder="e.g. Muhammad Ali" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Employee Code</label>
                  <input type="text" {...manualForm.register('employeeCode', { required: true })} placeholder="e.g. BG-0012" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Designation</label>
                  <input type="text" {...manualForm.register('designation')} placeholder="e.g. SDR Outreach Agent" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Department / Campaign</label>
                  <input type="text" {...manualForm.register('campaignName')} placeholder="e.g. Cleo HR" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Bank Details</label>
                  <input type="text" {...manualForm.register('bankAccount')} placeholder="e.g. Meezan Bank - 02341234" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Month (1-12)</label>
                    <input type="number" {...manualForm.register('periodMonth', { required: true, min: 1, max: 12 })} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Year</label>
                    <input type="number" {...manualForm.register('periodYear', { required: true })} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Base Salary (PKR)</label>
                  <input type="number" {...manualForm.register('baseSalary', { required: true })} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Attendance Allowance</label>
                  <input type="number" {...manualForm.register('attendanceAllowance')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Punctuality Allowance</label>
                  <input type="number" {...manualForm.register('punctualityAllowance')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Spiff (PKR)</label>
                  <input type="number" {...manualForm.register('spiff')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Commission (PKR)</label>
                  <input type="number" {...manualForm.register('commission')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-brand-text-soft mt-8 select-none cursor-pointer">
                    <input type="checkbox" {...manualForm.register('isTeamLead')} className="w-4 h-4 rounded border-brand-border text-brand-blue bg-brand-bg focus:ring-0 focus:ring-offset-0 cursor-pointer" />
                    <span>Is Team Lead?</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Bonus (PKR)</label>
                  <input type="number" {...manualForm.register('bonus')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Bonus Notes</label>
                  <input type="text" {...manualForm.register('bonusNotes')} placeholder="e.g. Performance award" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Absents & Lates Deduction</label>
                  <input type="number" {...manualForm.register('absentsLatesDeduction')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Advance Salary / Loan</label>
                  <input type="number" {...manualForm.register('loansDeduction')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Penalty / Other Deductions</label>
                  <input type="number" {...manualForm.register('otherDeductions')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Deduction Notes</label>
                <input type="text" {...manualForm.register('deductionNotes')} placeholder="e.g. Lates penalty details" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
              </div>

              <button type="submit" className="w-full py-3 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow-md shadow-brand-blue/15">Generate & Print PDF</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
