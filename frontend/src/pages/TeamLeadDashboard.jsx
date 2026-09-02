import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Users,
  Clock,
  TrendingUp,
  Award,
  DollarSign,
  UserCheck,
  Info,
  Save,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts';
import toast from 'react-hot-toast';

import api, { session, apiError } from '../utils/api';
import { useTheme } from '../utils/themeContext';
import { money, percent, todayInput } from '../utils/format';

const COLORS = ['#3e6cf6', '#8b5cf6', '#22d3ee', '#34d399', '#f5b942', '#ef4444'];

/**
 * Team Lead dashboard.
 *
 * Previously this picked `campaigns.find(c => c.status === 'active')` — the
 * first active campaign in the whole company, which the unrestricted
 * /campaigns endpoint happily returned. A lead could end up staring at another
 * team's numbers. The API now scopes /campaigns to the caller's memberships, and
 * this picks the campaign the user actually leads.
 *
 * The "Team Attendance Rate" tile also used to fall back to a literal 90% when
 * there were no records. An empty state is shown instead of an invented number.
 */
export default function TeamLeadDashboard() {
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

  const [attendance, setAttendance] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Inline performance entry for the team the lead runs.
  const [campaignId, setCampaignId] = useState(null);
  const [drafts, setDrafts] = useState({}); // { [employeeId]: { meetingsBooked, showups } }
  const [savingId, setSavingId] = useState(null);

  const currentUser = session.user;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const today = new Date();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();
        const tenDaysAgo = new Date();
        tenDaysAgo.setDate(today.getDate() - 10);

        const [campRes, attRes, leaveRes, halfRes, wfhRes] = await Promise.all([
          api.get('/campaigns'),
          api.get(
            `/attendance?startDate=${tenDaysAgo.toISOString().slice(0, 10)}&endDate=${todayInput()}`
          ),
          api.get('/requests/leave?status=pending'),
          api.get('/requests/halfday?status=pending'),
          api.get('/requests/wfh?status=pending'),
        ]);

        if (cancelled) return;

        setAttendance(attRes.data);
        setPendingCount(leaveRes.data.length + halfRes.data.length + wfhRes.data.length);

        // The campaign this user actually leads, not just any active one.
        const myEmployeeId = currentUser?.employee?.id;
        const led = campRes.data.find((c) =>
          c.members?.some(
            (m) => m.employeeId === myEmployeeId && m.role === 'team_lead' && m.status === 'active'
          )
        );

        if (led) {
          if (!cancelled) setCampaignId(led.id);
          const dash = await api.get(`/campaigns/${led.id}/dashboard?month=${month}&year=${year}`);
          if (!cancelled) setDashboard(dash.data);
        }
      } catch (err) {
        if (!cancelled) toast.error(apiError(err, 'Failed to load team metrics.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.employee?.id]);

  // Seed the editable roster from whatever is currently logged, so the lead
  // edits live figures rather than starting blank.
  useEffect(() => {
    if (!dashboard) return;
    const fresh = {};
    for (const row of dashboard.leaderboard || []) {
      fresh[row.employeeId] = {
        meetingsBooked: row.meetingsBooked ?? 0,
        showups: row.showups ?? 0,
      };
    }
    // The lead's own row — not in the leaderboard (SDRs only), but the lead
    // may log their own numbers too.
    const leadId = dashboard.campaign?.teamLeadId;
    if (leadId) {
      fresh[leadId] = {
        meetingsBooked: dashboard.campaign?.teamLeadPerformance?.meetingsBooked ?? 0,
        showups: dashboard.campaign?.teamLeadPerformance?.showups ?? 0,
      };
    }
    // Merge, don't replace: saving one row refetches the dashboard, and a
    // wholesale reseed would discard unsaved edits typed into other rows.
    setDrafts((prev) => {
      const next = {};
      for (const id of Object.keys(fresh)) next[id] = prev[id] ?? fresh[id];
      return next;
    });
  }, [dashboard]);

  const saveMemberPerformance = async (employeeId) => {
    if (!campaignId) return;
    const draft = drafts[employeeId] || {};
    // Whole numbers only — the API rejects decimals for counts.
    const toCount = (v) => Math.trunc(Number(v)) || 0;
    const meetingsNum = toCount(draft.meetingsBooked);
    const showupsNum = toCount(draft.showups);
    if (showupsNum < 0 || meetingsNum < 0) {
      toast.error('Metrics cannot be negative.');
      return;
    }
    if (showupsNum > meetingsNum) {
      toast.error('Show-ups cannot exceed meetings booked.');
      return;
    }
    try {
      setSavingId(employeeId);
      const today = new Date();
      const month = today.getMonth() + 1;
      const year = today.getFullYear();
      await api.post('/campaigns/performance', {
        employeeId,
        campaignId,
        month,
        year,
        meetingsBooked: meetingsNum,
        showups: showupsNum,
      });
      toast.success('Metrics saved.');
      const dash = await api.get(`/campaigns/${campaignId}/dashboard?month=${month}&year=${year}`);
      setDashboard(dash.data);
    } catch (err) {
      toast.error(apiError(err, 'Could not save metrics.'));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <Clock className="w-8 h-8 animate-spin text-brand-cyan" />
          <p className="text-brand-text-soft text-sm">Loading team performance…</p>
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="p-10 text-center border border-dashed border-brand-border rounded-2xl">
        <Users className="w-7 h-7 text-brand-text-mute mx-auto mb-3" />
        <p className="text-sm text-brand-text-soft">You are not currently leading a campaign.</p>
        <p className="text-xs text-brand-text-mute mt-2">
          Ask an administrator to assign you as team lead on a campaign.
        </p>
      </div>
    );
  }

  const { campaign, stats, leaderboard } = dashboard;

  const todayStr = todayInput();
  const todayAttendance = attendance.filter(
    (a) => new Date(a.date).toISOString().slice(0, 10) === todayStr
  );

  const sdrIds = new Set(leaderboard.map((l) => l.employeeId));
  const teamAttendanceToday = todayAttendance.filter((a) => sdrIds.has(a.employeeId));

  const presentToday = teamAttendanceToday.filter((a) =>
    ['present', 'half_day', 'wfh'].includes(a.status)
  ).length;
  const onLeaveToday = teamAttendanceToday.filter((a) => a.status === 'leave').length;
  const teamSize = leaderboard.length;
  const unaccountedToday = Math.max(0, teamSize - presentToday - onLeaveToday);

  const teamAttendance = attendance.filter((a) => sdrIds.has(a.employeeId));
  const workedRecords = teamAttendance.filter((a) =>
    ['present', 'half_day', 'wfh'].includes(a.status)
  ).length;
  const attendanceRate = teamAttendance.length > 0 ? (workedRecords / teamAttendance.length) * 100 : null;

  const averageShowups = teamSize > 0 ? stats.showups / teamSize : 0;
  const target = campaign.monthlyShowupTarget || 0;
  const progress = target > 0 ? Math.min(100, (stats.showups / target) * 100) : 0;

  const showupsByMember = leaderboard.map((sdr) => ({
    name: sdr.fullName.split(' ')[0],
    'Show-ups': sdr.showups,
    'Meetings Booked': sdr.meetingsBooked,
  }));

  const byDay = new Map();
  for (const log of teamAttendance) {
    const key = new Date(log.date).toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, { present: 0, total: 0 });
    const b = byDay.get(key);
    b.total++;
    if (['present', 'half_day', 'wfh'].includes(log.status)) b.present++;
  }
  const attendanceTrend = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, m]) => ({
      date: new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      Rate: Number(((m.present / (m.total || 1)) * 100).toFixed(0)),
    }));

  const commissionShares = leaderboard
    .map((sdr) => ({ name: sdr.fullName.split(' ')[0], value: sdr.commissionEarned }))
    .filter((d) => d.value > 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 text-left">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl glass-panel border border-brand-border/40">
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold text-brand-text font-display uppercase tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-cyan shrink-0" />
            Team Lead Hub
          </h2>
          <p className="text-xs text-brand-text-soft mt-1">
            Managing {teamSize} SDR{teamSize === 1 ? '' : 's'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block">
            Campaign
          </span>
          <span className="text-sm font-extrabold text-brand-text uppercase font-display bg-brand-cyan/10 border border-brand-cyan/25 px-3.5 py-1 rounded-full mt-1 inline-block">
            {campaign.name}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl glass-panel hover-glow-blue">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Team Size</span>
            <Users className="w-4 h-4 text-brand-blue" />
          </div>
          <p className="text-2xl font-extrabold text-brand-text font-display tabular-nums">{teamSize}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase block">Active SDRs</span>
        </div>

        <div className="p-4 rounded-xl glass-panel hover-glow-green">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Present Today</span>
            <UserCheck className="w-4 h-4 text-brand-green" />
          </div>
          <p className="text-2xl font-extrabold text-brand-green font-display tabular-nums">{presentToday}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase block">
            {onLeaveToday} on leave · {unaccountedToday} unaccounted
          </span>
        </div>

        <div className="p-4 rounded-xl glass-panel hover-glow-cyan">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Monthly Show-ups</span>
            <TrendingUp className="w-4 h-4 text-brand-cyan" />
          </div>
          <p className="text-2xl font-extrabold text-brand-text font-display tabular-nums">{stats.showups}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase block">
            {stats.meetingsBooked} booked · {percent(stats.conversionRate)} conversion
          </span>
        </div>

        <div className="p-4 rounded-xl glass-panel hover-glow-violet">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Your Commission</span>
            <DollarSign className="w-4 h-4 text-brand-violet" />
          </div>
          <p className="text-xl font-extrabold text-brand-text font-display tabular-nums">
            {money(stats.teamLeadCommission)}
          </p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase block">
            Team payout {money(stats.sdrCommission)}
          </span>
        </div>
      </div>

      {/* How the lead's own commission was reached — the dashboard and payroll
          used to compute this two different ways and silently disagree. */}
      {stats.teamLeadCommissionBasis && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-brand-border bg-brand-bg-soft/40 text-[11px] text-brand-text-soft">
          <Info className="w-3.5 h-3.5 text-brand-blue shrink-0 mt-0.5" />
          <span>{stats.teamLeadCommissionBasis}</span>
        </div>
      )}

      {target > 0 && (
        <div className="p-6 rounded-2xl glass-panel border border-brand-border/40">
          <div className="flex justify-between items-center text-xs font-bold text-brand-text-soft mb-3">
            <span className="uppercase tracking-wider">Campaign target progress</span>
            <span className="font-mono text-brand-text tabular-nums">
              {stats.showups} / {target} ({progress.toFixed(0)}%)
            </span>
          </div>
          <div className="w-full bg-brand-bg-soft rounded-full h-3 border border-brand-border overflow-hidden">
            <div
              className="brandigade-gradient h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display">
              Show-ups by team member
            </h3>
            <div className="h-64 w-full">
              {showupsByMember.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={showupsByMember}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="name" stroke={axisStroke} fontSize={10} tickLine={false} />
                    <YAxis stroke={axisStroke} fontSize={10} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: gridStroke }} />
                    <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Meetings Booked" fill="#3e6cf6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Show-ups" fill="#34d399" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-brand-text-mute italic py-20 text-center">
                  No performance logged for this campaign yet.
                </p>
              )}
            </div>
          </div>

          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display">
              Daily attendance rate
            </h3>
            <div className="h-56 w-full">
              {attendanceTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={attendanceTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" stroke={axisStroke} fontSize={10} tickLine={false} />
                    <YAxis stroke={axisStroke} fontSize={10} tickLine={false} domain={[0, 100]} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`, 'Attendance']} />
                    <Line
                      type="monotone"
                      dataKey="Rate"
                      stroke="#22d3ee"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-brand-text-mute italic py-16 text-center">
                  No attendance logged for your team yet.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="p-6 rounded-2xl glass-panel space-y-4 text-xs">
            <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display">
              Team insights
            </h3>
            <dl className="space-y-3.5">
              <div className="flex justify-between items-center gap-3">
                <dt className="text-brand-text-soft">Top performer</dt>
                <dd className="font-bold text-brand-text uppercase tracking-wide flex items-center gap-1.5 min-w-0">
                  <Award className="w-3.5 h-3.5 text-brand-cyan shrink-0" />
                  <span className="truncate">{leaderboard[0]?.fullName || '—'}</span>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-brand-text-soft">Team attendance rate</dt>
                <dd className="font-mono font-bold text-brand-green tabular-nums">
                  {attendanceRate === null ? '—' : percent(attendanceRate)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-brand-text-soft">Average show-ups / SDR</dt>
                <dd className="font-mono font-bold text-brand-cyan tabular-nums">
                  {averageShowups.toFixed(1)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-brand-text-soft">No-shows this month</dt>
                <dd className="font-mono font-bold text-brand-amber tabular-nums">{stats.noShows}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-brand-text-soft">Pending team requests</dt>
                <dd className="font-mono font-bold text-brand-amber tabular-nums">
                  <Link to="/dashboard/requests" className="hover:underline">
                    {pendingCount}
                  </Link>
                </dd>
              </div>
            </dl>
          </div>

          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display">
              Commission shares
            </h3>
            <div className="h-48 w-full flex justify-center items-center">
              {commissionShares.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={commissionShares}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent: p }) => `${name} ${(p * 100).toFixed(0)}%`}
                      outerRadius={60}
                      dataKey="value"
                      style={{ fontSize: 10 }}
                    >
                      {commissionShares.map((entry, index) => (
                        <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(v)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-brand-text-mute italic">No commission earned yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 rounded-2xl glass-panel border border-brand-border/40 space-y-4">
        <div>
          <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider font-display">
            Team roster &amp; performance entry
          </h3>
          <p className="text-[10px] text-brand-text-mute mt-1">
            Edit each member's booked meetings and show-ups for {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} and press save. These figures drive commission on the next payroll run.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-brand-border bg-brand-bg-elevated/40 text-[9px] uppercase font-extrabold tracking-widest text-brand-text-soft">
                <th scope="col" className="py-3 px-4">Name</th>
                <th scope="col" className="py-3 px-4">Today</th>
                <th scope="col" className="py-3 px-4 text-center">Booked</th>
                <th scope="col" className="py-3 px-4 text-center">Show-ups</th>
                <th scope="col" className="py-3 px-4 text-center">No-shows</th>
                <th scope="col" className="py-3 px-4 text-right">Commission</th>
                <th scope="col" className="py-3 px-4 text-right">Save</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((sdr) => {
                const log = todayAttendance.find((a) => a.employeeId === sdr.employeeId);
                const status = log?.status;

                const badge =
                  status === 'present'
                    ? ['Present', 'text-brand-green border-brand-green/25 bg-brand-green/10']
                    : status === 'half_day'
                    ? ['Half day', 'text-brand-amber border-brand-amber/25 bg-brand-amber/10']
                    : status === 'wfh'
                    ? ['WFH', 'text-brand-blue border-brand-blue/25 bg-brand-blue/10']
                    : status === 'leave'
                    ? ['Leave', 'text-brand-violet border-brand-violet/25 bg-brand-violet/10']
                    : ['No record', 'text-brand-text-mute border-brand-border bg-brand-bg-elevated'];

                return (
                  <tr
                    key={sdr.employeeId}
                    className="border-b border-brand-border/30 hover:bg-brand-bg-elevated/20 transition-colors"
                  >
                    <td className="py-3 px-4 font-bold text-brand-text">{sdr.fullName}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full border text-[8px] font-bold uppercase tracking-widest ${badge[1]}`}
                      >
                        {badge[0]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <input
                        type="number"
                        min="0"
                        aria-label={`Meetings booked for ${sdr.fullName}`}
                        value={drafts[sdr.employeeId]?.meetingsBooked ?? ''}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [sdr.employeeId]: { ...d[sdr.employeeId], meetingsBooked: e.target.value },
                          }))
                        }
                        className="w-16 px-2 py-1 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text text-center focus:outline-none focus:border-brand-blue tabular-nums"
                      />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <input
                        type="number"
                        min="0"
                        aria-label={`Show-ups for ${sdr.fullName}`}
                        value={drafts[sdr.employeeId]?.showups ?? ''}
                        onChange={(e) =>
                          setDrafts((d) => ({
                            ...d,
                            [sdr.employeeId]: { ...d[sdr.employeeId], showups: e.target.value },
                          }))
                        }
                        className="w-16 px-2 py-1 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-green font-bold text-center focus:outline-none focus:border-brand-blue tabular-nums"
                      />
                    </td>
                    <td className="py-3 px-4 text-center font-mono text-brand-amber tabular-nums">
                      {sdr.noShows}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-brand-text tabular-nums">
                      {money(sdr.commissionEarned)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => saveMemberPerformance(sdr.employeeId)}
                        disabled={savingId === sdr.employeeId}
                        title="Save metrics"
                        aria-label={`Save metrics for ${sdr.fullName}`}
                        className="p-1.5 rounded-lg border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* The lead's own metrics. Kept out of the leaderboard and the team
                  totals — it informs, it does not feed the ladder payout. */}
              {campaign.teamLeadId && (
                <tr className="border-t-2 border-brand-border/60 bg-brand-bg-elevated/20">
                  <td className="py-3 px-4 font-bold text-brand-text">
                    You
                    <span className="text-[8px] text-brand-text-mute uppercase tracking-widest ml-1.5">Team Lead</span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-[8px] text-brand-text-mute uppercase tracking-widest">Own metrics</span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <input
                      type="number"
                      min="0"
                      aria-label="Your meetings booked"
                      value={drafts[campaign.teamLeadId]?.meetingsBooked ?? ''}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [campaign.teamLeadId]: { ...d[campaign.teamLeadId], meetingsBooked: e.target.value },
                        }))
                      }
                      className="w-16 px-2 py-1 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-text text-center focus:outline-none focus:border-brand-blue tabular-nums"
                    />
                  </td>
                  <td className="py-3 px-4 text-center">
                    <input
                      type="number"
                      min="0"
                      aria-label="Your show-ups"
                      value={drafts[campaign.teamLeadId]?.showups ?? ''}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [campaign.teamLeadId]: { ...d[campaign.teamLeadId], showups: e.target.value },
                        }))
                      }
                      className="w-16 px-2 py-1 rounded-lg bg-brand-bg border border-brand-border text-xs text-brand-green font-bold text-center focus:outline-none focus:border-brand-blue tabular-nums"
                    />
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-brand-text-mute">—</td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-brand-text tabular-nums">
                    {money(stats.teamLeadCommission)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => saveMemberPerformance(campaign.teamLeadId)}
                      disabled={savingId === campaign.teamLeadId}
                      title="Save your metrics"
                      aria-label="Save your metrics"
                      className="p-1.5 rounded-lg border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue/40 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )}

              {leaderboard.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-brand-text-mute italic">
                    No SDRs assigned to your campaign yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
