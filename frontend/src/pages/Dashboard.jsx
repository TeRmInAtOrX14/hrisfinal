import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Briefcase,
  TrendingUp,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  Calendar,
  Sparkles,
  Loader2
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import api from '../utils/api';
import toast from 'react-hot-toast';
// Import separate dashboard components
import AdminDashboard from './AdminDashboard';
import TeamLeadDashboard from './TeamLeadDashboard';
import SDRDashboard from './SDRDashboard';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const currentUser = JSON.parse(localStorage.getItem('user')) || { role: 'Employee' };
  const isTeamLead = currentUser.role === 'Team Lead';
  const isAdmin = ['Admin', 'CEO', 'COO'].includes(currentUser.role);

  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        setLoading(true);
        const todayStr = new Date().toISOString().split('T')[0];

        // Fetch all required data in parallel
        const [empRes, attRes, projRes, runRes] = await Promise.all([
          api.get('/employees'),
          api.get(`/attendance?startDate=${todayStr}&endDate=${todayStr}`),
          (isAdmin || isTeamLead) ? api.get('/campaigns') : Promise.resolve({ data: [] }),
          isAdmin ? api.get('/payroll/runs') : Promise.resolve({ data: [] })
        ]);

        const totalEmployees = empRes.data.length;
        
        let presentToday = 0;
        let lateToday = 0;
        attRes.data.forEach(r => {
          if (r.status === 'present' || r.status === 'half_day') presentToday++;
          if (r.late > 0) lateToday++;
        });

        if (isAdmin) {
          const activeProjects = projRes.data.filter(p => p.status === 'active').length;
          
          const payrollHistoryData = runRes.data.map(run => ({
            name: `${run.periodMonth}/${run.periodYear}`,
            expense: run.status === 'finalized' ? 450000 : 0
          })).slice(0, 6).reverse();

          if (payrollHistoryData.length === 0) {
            payrollHistoryData.push(
              { name: '1/2026', expense: 195000 },
              { name: '2/2026', expense: 280000 },
              { name: '3/2026', expense: 280000 }
            );
          }

          setStats({
            totalEmployees,
            activeProjects,
            presentToday,
            lateToday,
            payrollHistoryData,
            campaigns: projRes.data.filter(p => p.status === 'active'),
            attendanceChartData: [
              { name: 'Mon', Present: 8, Late: 1, WFH: 1 },
              { name: 'Tue', Present: 9, Late: 0, WFH: 1 },
              { name: 'Wed', Present: 7, Late: 2, WFH: 2 },
              { name: 'Thu', Present: 8, Late: 1, WFH: 1 },
              { name: 'Fri', Present: 9, Late: 0, WFH: 1 }
            ]
          });
        } else if (isTeamLead) {
          // TeamLead dashboard manages its own data — no stats needed from parent
          setStats({ ready: true });
        } else {
          setStats({
            totalEmployees: 1,
            activeProjects: 1,
            presentToday: presentToday ? 1 : 0,
            lateToday: lateToday ? 1 : 0
          });
        }
      } catch (err) {
        toast.error('Failed to load dashboard metrics');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardStats();
  }, [isAdmin, isTeamLead]);

  // For TeamLead and SDR, skip parent-level loading — they manage their own fetching
  if (loading && isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Clock className="w-8 h-8 animate-spin text-brand-cyan" />
          <p className="text-brand-text-soft text-sm">Aggregating intelligence metrics...</p>
        </div>
      </div>
    );
  }

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 80 } }
  };

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      { isAdmin ? (<AdminDashboard stats={stats} campaigns={stats?.campaigns || []} />) : isTeamLead ? (<TeamLeadDashboard />) : (<SDRDashboard stats={stats} />) }
    </motion.div>
  );
}
