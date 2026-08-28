import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import toast from 'react-hot-toast';

import api, { session, apiError } from '../utils/api';
import { isAdmin, isTeamLead } from '../utils/roles';
import { todayInput } from '../utils/format';

import AdminDashboard from './AdminDashboard';
import TeamLeadDashboard from './TeamLeadDashboard';
import SDRDashboard from './SDRDashboard';

/**
 * Dashboard router.
 *
 * The admin branch used to synthesise its metrics: payroll expense was a literal
 * 450000 per finalized run (falling back to invented figures for Jan–Mar 2026),
 * and the weekly attendance chart was a hard-coded Mon–Fri array. Both are now
 * read from the API — `/payroll/runs` returns a real `totalNetPay` per run, and
 * the attendance trend is aggregated from actual records.
 */
export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const user = session.user || { role: 'Employee' };
  const admin = isAdmin(user);
  const teamLead = isTeamLead(user);

  useEffect(() => {
    if (!admin) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const today = todayInput();
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 6);
        const weekAgoStr = weekAgo.toISOString().slice(0, 10);

        const [empRes, todayRes, weekRes, campRes, runRes] = await Promise.all([
          api.get('/employees'),
          api.get(`/attendance?startDate=${today}&endDate=${today}`),
          api.get(`/attendance?startDate=${weekAgoStr}&endDate=${today}`),
          api.get('/campaigns'),
          api.get('/payroll/runs'),
        ]);

        if (cancelled) return;

        const employees = empRes.data;
        const activeEmployees = employees.filter((e) => e.status === 'active');

        let presentToday = 0;
        let lateToday = 0;
        let onLeaveToday = 0;
        for (const rec of todayRes.data) {
          if (rec.status === 'present' || rec.status === 'wfh') presentToday++;
          else if (rec.status === 'half_day') presentToday++;
          else if (rec.status === 'leave') onLeaveToday++;
          if (rec.late > 0) lateToday++;
        }

        // Real weekly attendance, grouped by day from actual records.
        const byDay = new Map();
        for (const rec of weekRes.data) {
          const key = new Date(rec.date).toISOString().slice(0, 10);
          if (!byDay.has(key)) byDay.set(key, { Present: 0, Late: 0, WFH: 0, Leave: 0 });
          const bucket = byDay.get(key);
          if (rec.status === 'wfh') bucket.WFH++;
          else if (rec.status === 'leave') bucket.Leave++;
          else if (rec.status === 'present' || rec.status === 'half_day') bucket.Present++;
          if (rec.late > 0) bucket.Late++;
        }

        const attendanceChartData = [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, counts]) => ({
            name: new Date(date).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
            ...counts,
          }));

        // Real payroll cost per finalized run.
        const payrollHistoryData = runRes.data
          .filter((run) => run.status === 'finalized')
          .slice(0, 6)
          .reverse()
          .map((run) => ({
            name: `${run.periodMonth}/${run.periodYear}`,
            expense: run.totalNetPay || 0,
          }));

        const campaigns = campRes.data.filter((c) => c.status === 'active');

        setStats({
          totalEmployees: activeEmployees.length,
          activeProjects: campaigns.length,
          presentToday,
          lateToday,
          onLeaveToday,
          absentToday: Math.max(0, activeEmployees.length - presentToday - onLeaveToday),
          attendanceChartData,
          payrollHistoryData,
          campaigns,
          latestRun: runRes.data[0] || null,
        });
      } catch (err) {
        if (!cancelled) toast.error(apiError(err, 'Failed to load dashboard metrics.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [admin]);

  if (admin && loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Clock className="w-8 h-8 animate-spin text-brand-cyan" />
          <p className="text-brand-text-soft text-sm">Aggregating metrics…</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {admin ? (
        <AdminDashboard stats={stats} campaigns={stats?.campaigns || []} />
      ) : teamLead ? (
        <TeamLeadDashboard />
      ) : (
        <SDRDashboard />
      )}
    </motion.div>
  );
}
