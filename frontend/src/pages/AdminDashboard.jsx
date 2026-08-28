import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Users,
  Briefcase,
  CalendarCheck,
  TrendingUp,
  UserCheck,
  UserX,
  Wallet,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

import { useTheme } from '../utils/themeContext';
import { money, amount, monthName } from '../utils/format';

function StatCard({ label, value, hint, icon: Icon, accent, glow }) {
  return (
    <div className={`p-6 rounded-2xl glass-panel ${glow} text-left border border-brand-border/40`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-bold text-brand-text-soft uppercase tracking-widest font-display">
          {label}
        </span>
        <Icon className={`w-5 h-5 ${accent}`} />
      </div>
      <p className={`text-3xl font-extrabold font-display tabular-nums ${accent}`}>{value}</p>
      <p className="text-[9px] text-brand-text-mute mt-2 font-bold">{hint}</p>
    </div>
  );
}

export default function AdminDashboard({ stats, campaigns = [] }) {
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

  const attendanceData = stats?.attendanceChartData || [];
  const payrollData = stats?.payrollHistoryData || [];

  return (
    <motion.div
      className="space-y-6"
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }}
      initial="hidden"
      animate="show"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="Total Headcount"
          value={amount(stats?.totalEmployees || 0)}
          hint="Active employee profiles"
          icon={Users}
          accent="text-brand-blue"
          glow="hover-glow-blue"
        />
        <StatCard
          label="Active Campaigns"
          value={amount(stats?.activeProjects || 0)}
          hint="Running commission structures"
          icon={Briefcase}
          accent="text-brand-violet"
          glow="hover-glow-violet"
        />
        <StatCard
          label="Present Today"
          value={amount(stats?.presentToday || 0)}
          hint={`${stats?.onLeaveToday || 0} on leave · ${stats?.absentToday || 0} unaccounted`}
          icon={UserCheck}
          accent="text-brand-green"
          glow="hover-glow-green"
        />
        <StatCard
          label="Late Arrivals Today"
          value={amount(stats?.lateToday || 0)}
          hint="Past shift start plus grace"
          icon={CalendarCheck}
          accent="text-brand-amber"
          glow="hover-glow-amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Attendance — real records, not the hard-coded Mon–Fri array this
            panel used to display. */}
        <section className="p-6 rounded-2xl glass-panel border border-brand-border/40 space-y-4">
          <div className="flex items-center justify-between border-b border-brand-border/40 pb-2">
            <h2 className="text-sm font-extrabold text-brand-text uppercase font-display flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-brand-cyan" />
              Attendance — last 7 days
            </h2>
            <Link
              to="/dashboard/attendance"
              className="text-[10px] font-bold text-brand-blue hover:underline uppercase"
            >
              View all
            </Link>
          </div>

          <div className="h-64 w-full">
            {attendanceData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={attendanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="name" stroke={axisStroke} fontSize={10} tickLine={false} />
                  <YAxis stroke={axisStroke} fontSize={10} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: gridStroke }} />
                  <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Present" fill="#34d399" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="WFH" fill="#3e6cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Late" fill="#f5b942" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-brand-text-mute italic py-20 text-center">
                No attendance records in the last 7 days.
              </p>
            )}
          </div>
        </section>

        {/* Payroll cost — summed from real payslips per finalized run. */}
        <section className="p-6 rounded-2xl glass-panel border border-brand-border/40 space-y-4">
          <div className="flex items-center justify-between border-b border-brand-border/40 pb-2">
            <h2 className="text-sm font-extrabold text-brand-text uppercase font-display flex items-center gap-2">
              <Wallet className="w-4 h-4 text-brand-green" />
              Payroll cost by period
            </h2>
            <Link
              to="/dashboard/payroll"
              className="text-[10px] font-bold text-brand-blue hover:underline uppercase"
            >
              Manage payroll
            </Link>
          </div>

          <div className="h-64 w-full">
            {payrollData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={payrollData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="name" stroke={axisStroke} fontSize={10} tickLine={false} />
                  <YAxis
                    stroke={axisStroke}
                    fontSize={10}
                    tickLine={false}
                    tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: gridStroke }}
                    formatter={(value) => [money(value), 'Net payout']}
                  />
                  <Bar dataKey="expense" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Net payout" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-brand-text-mute italic py-20 text-center">
                No finalized payroll runs yet.
              </p>
            )}
          </div>

          {stats?.latestRun && (
            <p className="text-[10px] text-brand-text-mute font-mono border-t border-brand-border/40 pt-3">
              Latest run: {monthName(stats.latestRun.periodMonth)} {stats.latestRun.periodYear} ·{' '}
              {stats.latestRun.status} · {stats.latestRun.payslipCount} payslips ·{' '}
              {money(stats.latestRun.totalNetPay)}
            </p>
          )}
        </section>
      </div>

      <section className="p-6 rounded-2xl glass-panel border border-brand-border/40 text-left space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-brand-border/40">
          <h2 className="text-sm font-extrabold text-brand-text uppercase font-display flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-cyan" />
            Active campaigns
          </h2>
          <Link
            to="/dashboard/campaigns"
            className="text-[10px] font-bold text-brand-blue hover:underline uppercase"
          >
            Manage campaigns
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {campaigns.map((camp) => {
            const lead = camp.members?.find((m) => m.role === 'team_lead');
            const sdrs = camp.members?.filter((m) => m.role === 'sdr') || [];

            return (
              <div
                key={camp.id}
                className="p-4 rounded-xl bg-brand-bg/40 border border-brand-border flex flex-col justify-between gap-3 card-hover"
              >
                <div>
                  <h3 className="text-xs font-bold text-brand-text uppercase tracking-wider">
                    {camp.name}
                  </h3>
                  <p className="text-[11px] text-brand-text-soft mt-1 leading-relaxed line-clamp-2">
                    {camp.description || 'No description.'}
                  </p>
                </div>

                <div className="flex justify-between text-[10px] text-brand-text-mute font-mono pt-2 border-t border-brand-border/40">
                  <span>
                    Lead:{' '}
                    <strong className="text-brand-text font-sans">
                      {lead?.employee?.fullName || 'Unassigned'}
                    </strong>
                  </span>
                  <span>
                    SDRs: <strong className="text-brand-text font-sans">{sdrs.length}</strong>
                  </span>
                </div>
              </div>
            );
          })}

          {campaigns.length === 0 && (
            <div className="col-span-full py-8 text-center border border-dashed border-brand-border rounded-xl">
              <UserX className="w-6 h-6 text-brand-text-mute mx-auto mb-2" />
              <p className="text-xs text-brand-text-soft">No active campaigns.</p>
            </div>
          )}
        </div>
      </section>
    </motion.div>
  );
}
