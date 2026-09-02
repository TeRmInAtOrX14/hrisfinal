import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  Clock,
  CheckCircle,
  Sparkles,
  DollarSign,
  Zap,
  Award,
  PhoneCall,
  Download,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';

import api, { apiError, openAuthedFile } from '../utils/api';
import { openBrandigadeDialer } from '../utils/openDialer';
import { useTheme } from '../utils/themeContext';
import { money, amount, percent, monthName, shortDate } from '../utils/format';

/**
 * SDR self-service dashboard.
 *
 * Several panels here were reading fields the API never returned, so they were
 * permanently blank or zero:
 *
 *  - "Earned Spiffs" read `employee.spiffs`, which `/employees` does not include
 *    → always PKR 0. Now fetched from `/system/spiffs`.
 *  - "Latest Payslip" read `employee.payslips` → always "no payslips". Now from
 *    `/payroll/my-payslips`.
 *  - "Matched Commission Slab" read `campaignDashboard.campaign.commissionStructures`,
 *    a key the dashboard endpoint never returned → always "no structures loaded".
 *    The endpoint now returns `campaign.activeStructure`.
 *
 * The "Weekly Performance Breakdown" chart has been removed: it invented weekly
 * numbers by multiplying the monthly total by 0.2/0.3/0.25/0.25. No weekly data
 * is stored, so there was nothing real to show.
 */
export default function SDRDashboard() {
  const { isDark } = useTheme();

  const axisStroke = isDark ? '#6b7287' : '#94a3b8';
  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)';
  const tooltipStyle = {
    backgroundColor: isDark ? '#0d101c' : '#ffffff',
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.10)',
    color: isDark ? '#f4f6fb' : '#0f172a',
    borderRadius: 12,
    fontSize: 12,
  };

  const [employee, setEmployee] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [summary, setSummary] = useState(null);
  const [campaignDashboard, setCampaignDashboard] = useState(null);
  const [spiffs, setSpiffs] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [requestCounts, setRequestCounts] = useState({ leave: 0, halfday: 0, wfh: 0 });
  const [loading, setLoading] = useState(true);

  // Self-service performance entry (meetings scheduled + show-ups). These feed
  // the commission calculation on the next payroll run.
  const [perfDraft, setPerfDraft] = useState({ meetingsScheduled: '', showups: '' });
  const [savingPerf, setSavingPerf] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const today = new Date();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);

        const [empRes, attRes, spiffRes, payslipRes, leaveRes, halfRes, wfhRes] = await Promise.all([
          api.get('/employees'),
          api.get(
            `/attendance?startDate=${thirtyDaysAgo.toISOString().slice(0, 10)}&endDate=${today
              .toISOString()
              .slice(0, 10)}`
          ),
          api.get(`/system/spiffs?month=${month}&year=${year}`),
          api.get('/payroll/my-payslips'),
          api.get('/requests/leave/mine'),
          api.get('/requests/halfday/mine'),
          api.get('/requests/wfh/mine'),
        ]);

        if (cancelled) return;

        const me = empRes.data[0];
        if (!me) throw new Error('Employee profile not found');

        setEmployee(me);
        setAttendance(attRes.data);
        setSpiffs(spiffRes.data);
        setPayslips(payslipRes.data);
        setRequestCounts({
          leave: leaveRes.data.filter((r) => r.status === 'approved').length,
          halfday: halfRes.data.filter((r) => r.status === 'approved').length,
          wfh: wfhRes.data.filter((r) => r.status === 'approved').length,
        });

        const [summaryRes, campaignId] = [
          api.get(`/attendance/summary?employeeId=${me.id}&year=${year}&month=${month}`),
          me.campaignMembers?.find((m) => m.status === 'active')?.campaignId,
        ];

        const summaryData = await summaryRes;
        if (!cancelled) setSummary(summaryData.data);

        if (campaignId) {
          const dash = await api.get(`/campaigns/${campaignId}/dashboard?month=${month}&year=${year}`);
          if (!cancelled) setCampaignDashboard(dash.data);
        }
      } catch (err) {
        if (!cancelled) toast.error(apiError(err, 'Failed to load your performance metrics.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Seed the entry form from whatever is already logged this month, so the SDR
  // edits the current figures rather than starting from blank.
  useEffect(() => {
    if (!campaignDashboard || !employee) return;
    const mine = (campaignDashboard.leaderboard || []).find((s) => s.employeeId === employee.id);
    setPerfDraft({
      meetingsScheduled: mine?.meetingsBooked ?? '',
      showups: mine?.showups ?? '',
    });
  }, [campaignDashboard, employee]);

  const saveMyPerformance = async (e) => {
    e.preventDefault();
    const campaignId = employee?.campaignMembers?.find((m) => m.status === 'active')?.campaignId;
    if (!campaignId) {
      toast.error('You are not assigned to an active campaign.');
      return;
    }
    // Whole numbers only — the API rejects decimals for counts.
    const toCount = (v) => Math.trunc(Number(v)) || 0;
    const showupsNum = toCount(perfDraft.showups);
    const meetingsNum = toCount(perfDraft.meetingsScheduled);
    if (showupsNum < 0 || meetingsNum < 0) {
      toast.error('Metrics cannot be negative.');
      return;
    }
    if (showupsNum > meetingsNum) {
      toast.error('Show-ups cannot exceed meetings scheduled.');
      return;
    }
    try {
      setSavingPerf(true);
      const today = new Date();
      const month = today.getMonth() + 1;
      const year = today.getFullYear();
      await api.post('/campaigns/performance', {
        employeeId: employee.id,
        campaignId,
        month,
        year,
        meetingsBooked: meetingsNum,
        showups: showupsNum,
      });
      toast.success('Metrics saved. Your commission updates on the next payroll run.');
      const dash = await api.get(`/campaigns/${campaignId}/dashboard?month=${month}&year=${year}`);
      setCampaignDashboard(dash.data);
    } catch (err) {
      toast.error(apiError(err, 'Could not save your metrics.'));
    } finally {
      setSavingPerf(false);
    }
  };

  const downloadPayslip = async (payslip) => {
    try {
      await openAuthedFile(`/payroll/payslips/${payslip.id}/pdf`);
    } catch (err) {
      toast.error(apiError(err, 'Could not open your payslip.'));
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <Clock className="w-8 h-8 animate-spin text-brand-cyan" />
          <p className="text-brand-text-soft text-sm">Loading your outreach stats…</p>
        </div>
      </div>
    );
  }

  const activeMember = employee?.campaignMembers?.find((m) => m.status === 'active');
  const campaignName = activeMember?.campaign?.name || 'Unassigned';

  const leaderboard = campaignDashboard?.leaderboard || [];
  const self = leaderboard.find((s) => s.employeeId === employee?.id);
  const rank = leaderboard.findIndex((s) => s.employeeId === employee?.id) + 1;

  const showups = self?.showups || 0;
  const meetingsBooked = self?.meetingsBooked || 0;
  const commission = self?.commissionEarned || 0;
  const spiffTotal = spiffs.reduce((sum, s) => sum + s.amount, 0);

  // The campaign's own configured target, not a hard-coded 25.
  const target = campaignDashboard?.campaign?.monthlyShowupTarget || 0;
  const progress = target > 0 ? Math.min(100, (showups / target) * 100) : 0;

  const daysWorked = summary?.daysWorked || 0;
  const evaluatedDays = summary?.totalRecords || 0;
  const attendanceRate = evaluatedDays > 0 ? (daysWorked / evaluatedDays) * 100 : 0;

  const slabs = campaignDashboard?.campaign?.activeStructure?.slabs || [];
  const latestPayslip = payslips[0];

  const attendanceTrend = attendance
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(-14)
    .map((log) => ({
      date: shortDate(log.date).replace(/^\w+, /, ''),
      'Late (mins)': log.late,
      'Overtime (mins)': log.overtime,
    }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-6 text-left"
    >
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-6 rounded-2xl glass-panel relative overflow-hidden border border-brand-border/40">
        <div className="z-10 min-w-0">
          <h2 className="text-2xl font-extrabold text-brand-text font-display uppercase tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-brand-cyan shrink-0" />
            SDR Outreach Hub
          </h2>
          <p className="text-xs text-brand-text-soft mt-1 truncate">
            {employee?.fullName} · {monthName(new Date().getMonth() + 1)} {new Date().getFullYear()}
          </p>
        </div>

        <div className="flex items-center gap-3 z-10 flex-wrap">
          <button
            onClick={openBrandigadeDialer}
            className="flex items-center gap-2 px-4 py-2 rounded-xl brandigade-gradient text-white font-extrabold text-xs uppercase tracking-wider font-display shadow-lg hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer"
          >
            <PhoneCall className="w-4 h-4" />
            Launch Dialer
          </button>

          <div className="text-right">
            <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block">
              Campaign
            </span>
            <span className="text-xs font-bold text-brand-text uppercase font-display bg-brand-blue/10 border border-brand-blue/20 px-3 py-1 rounded-full mt-1 inline-block">
              {campaignName}
            </span>
          </div>

          {rank > 0 && (
            <div className="px-4 py-2.5 rounded-2xl bg-brand-violet/10 border border-brand-violet/20 flex flex-col items-center">
              <span className="text-[8px] font-bold text-brand-violet uppercase tracking-widest">Rank</span>
              <span className="text-lg font-extrabold text-brand-text font-mono tabular-nums">#{rank}</span>
            </div>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl glass-panel hover-glow-blue flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-3">
            <span className="text-[9px] font-bold uppercase tracking-wider">Monthly Show-ups</span>
            <TrendingUp className="w-4 h-4 text-brand-blue" />
          </div>
          <p className="text-3xl font-extrabold text-brand-text font-display tabular-nums">{showups}</p>
          <p className="text-[9px] text-brand-text-mute mt-1.5 font-bold uppercase">
            {meetingsBooked} meetings booked
          </p>
        </div>

        <div className="p-5 rounded-2xl glass-panel hover-glow-green flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-3">
            <span className="text-[9px] font-bold uppercase tracking-wider">Commission</span>
            <DollarSign className="w-4 h-4 text-brand-green" />
          </div>
          <p className="text-2xl font-extrabold text-brand-green font-display tabular-nums">
            {money(commission)}
          </p>
          <p className="text-[9px] text-brand-text-mute mt-1.5 font-bold uppercase">This month, est.</p>
        </div>

        <div className="p-5 rounded-2xl glass-panel hover-glow-violet flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-3">
            <span className="text-[9px] font-bold uppercase tracking-wider">Earned Spiffs</span>
            <Award className="w-4 h-4 text-brand-violet" />
          </div>
          <p className="text-2xl font-extrabold text-brand-text font-display tabular-nums">
            {money(spiffTotal)}
          </p>
          <p className="text-[9px] text-brand-text-mute mt-1.5 font-bold uppercase">
            {spiffs.length} award{spiffs.length === 1 ? '' : 's'} this month
          </p>
        </div>

        <div className="p-5 rounded-2xl glass-panel hover-glow-cyan flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-3">
            <span className="text-[9px] font-bold uppercase tracking-wider">Attendance Rate</span>
            <CheckCircle className="w-4 h-4 text-brand-cyan" />
          </div>
          <p className="text-3xl font-extrabold text-brand-text font-display tabular-nums">
            {percent(attendanceRate)}
          </p>
          <p className="text-[9px] text-brand-text-mute mt-1.5 font-bold uppercase">
            {daysWorked} of {evaluatedDays} logged days
          </p>
        </div>
      </div>

      {/* Target progress — only when the campaign actually has a target set. */}
      {target > 0 && (
        <div className="p-6 rounded-2xl glass-panel border border-brand-border/40">
          <div className="flex justify-between items-center text-xs font-bold text-brand-text-soft mb-3">
            <span className="uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-brand-cyan" />
              Progress against campaign target
            </span>
            <span className="font-mono text-brand-text tabular-nums">
              {showups} / {target} ({progress.toFixed(0)}%)
            </span>
          </div>
          <div
            className="w-full bg-brand-bg-soft rounded-full h-3.5 border border-brand-border overflow-hidden"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="brandigade-gradient h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Self-service metric entry — feeds commission on the next payroll run. */}
      {activeMember && (
        <form
          onSubmit={saveMyPerformance}
          className="p-6 rounded-2xl glass-panel border border-brand-border/40 space-y-4"
        >
          <div>
            <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-brand-cyan" />
              Log my metrics — {monthName(new Date().getMonth() + 1)} {new Date().getFullYear()}
            </h3>
            <p className="text-[10px] text-brand-text-mute mt-1">
              Enter this month's totals for {campaignName}. Saving updates the figures your commission is calculated from.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-[9px] text-brand-text-mute uppercase font-bold tracking-wider mb-1">Meetings Scheduled</label>
              <input
                type="number"
                min="0"
                value={perfDraft.meetingsScheduled}
                onChange={(e) => setPerfDraft((d) => ({ ...d, meetingsScheduled: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue tabular-nums"
              />
            </div>
            <div>
              <label className="block text-[9px] text-brand-text-mute uppercase font-bold tracking-wider mb-1">Show-ups</label>
              <input
                type="number"
                min="0"
                value={perfDraft.showups}
                onChange={(e) => setPerfDraft((d) => ({ ...d, showups: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none focus:border-brand-blue tabular-nums"
              />
            </div>
            <button
              type="submit"
              disabled={savingPerf}
              className="py-2 px-4 rounded-xl brandigade-gradient text-white font-bold font-display text-xs uppercase tracking-wider shadow-lg hover:scale-[1.02] active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingPerf ? 'Saving…' : 'Save Metrics'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-2xl glass-panel space-y-4">
          <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display">
            Punctuality — last 14 logged days
          </h3>
          <div className="h-64 w-full">
            {attendanceTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={attendanceTrend}>
                  <defs>
                    <linearGradient id="lateGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f5b942" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#f5b942" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="date" stroke={axisStroke} fontSize={10} tickLine={false} />
                  <YAxis stroke={axisStroke} fontSize={10} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="Late (mins)"
                    stroke="#f5b942"
                    fill="url(#lateGradient)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="Overtime (mins)"
                    stroke="#34d399"
                    fillOpacity={0}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-brand-text-mute italic py-20 text-center">
                No attendance logged in the last 30 days.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="p-6 rounded-2xl glass-panel space-y-4 text-xs">
            <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display">
              Attendance summary
            </h3>
            <dl className="space-y-3">
              {[
                ['Days present', summary?.present || 0, 'text-brand-green'],
                ['Work from home', summary?.wfh || 0, 'text-brand-blue'],
                ['Half days', summary?.halfDays || 0, 'text-brand-amber'],
                ['Approved leave', requestCounts.leave, 'text-brand-violet'],
                ['Late arrivals', summary?.lateCount || 0, 'text-brand-amber'],
                ['Total late minutes', summary?.totalLateMinutes || 0, 'text-brand-red'],
              ].map(([label, value, tone]) => (
                <div key={label} className="flex justify-between">
                  <dt className="text-brand-text-soft">{label}</dt>
                  <dd className={`font-mono font-bold tabular-nums ${tone}`}>{amount(value)}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="p-6 rounded-2xl glass-panel space-y-4 text-xs">
            <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display">
              Commission structure
            </h3>

            <div className="p-3 bg-brand-bg-soft/40 border border-brand-border rounded-xl space-y-2">
              <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block">
                Your active slab table
              </span>

              {slabs.length > 0 ? (
                <ul className="space-y-1 mt-1 font-mono text-[10px]">
                  {slabs.map((s) => {
                    const matched =
                      showups >= s.minShowups &&
                      (s.maxShowups === null || showups <= s.maxShowups);
                    return (
                      <li
                        key={s.id || `${s.minShowups}-${s.maxShowups}`}
                        className={
                          matched
                            ? 'text-brand-blue font-bold px-2 py-1 rounded bg-brand-blue/10 border border-brand-blue/20'
                            : 'text-brand-text-soft px-2 py-1'
                        }
                      >
                        {s.minShowups}–{s.maxShowups ?? '∞'} show-ups · {money(s.rate)}
                        {matched && ' ← you'}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-brand-text-soft italic">
                  No commission structure is active for your campaign.
                </p>
              )}
            </div>

            <div className="pt-2 border-t border-brand-border/40">
              <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block mb-2">
                Latest payslip
              </span>
              {latestPayslip ? (
                <div className="flex justify-between items-center bg-brand-bg-soft/40 border border-brand-border p-2.5 rounded-lg gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-brand-text uppercase font-mono text-[10px]">
                      {monthName(latestPayslip.payrollRun?.periodMonth)}{' '}
                      {latestPayslip.payrollRun?.periodYear}
                    </p>
                    <p className="text-[9px] text-brand-text-soft mt-0.5">
                      Net pay: {money(latestPayslip.netPay)}
                    </p>
                  </div>
                  <button
                    onClick={() => downloadPayslip(latestPayslip)}
                    className="p-2 rounded-lg border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue/40 transition-colors cursor-pointer shrink-0"
                    title="Open payslip PDF"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <p className="text-brand-text-soft italic">No payslips issued yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
