import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  Clock,
  Calendar,
  CheckCircle,
  AlertCircle,
  Sparkles,
  Briefcase,
  DollarSign,
  User,
  Zap,
  Award,
  Loader2,
  ListCollapse,
  ChevronRight,
  TrendingDown,
  PhoneCall
} from 'lucide-react';
import { openBrandigadeDialer } from '../utils/openDialer';
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
  LineChart,
  Line,
  Legend
} from 'recharts';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useTheme } from '../utils/themeContext';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export default function SDRDashboard() {
  const { theme, isDark } = useTheme();

  const strokeColor = isDark ? '#6b7287' : '#94a3b8';
  const gridStroke = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15, 23, 42, 0.08)';
  const tooltipBg = isDark ? '#0d101c' : '#ffffff';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15, 23, 42, 0.08)';
  const tooltipColor = isDark ? '#f4f6fb' : '#0f172a';

  const [employee, setEmployee] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [campaignDashboard, setCampaignDashboard] = useState(null);
  const [leaves, setLeaves] = useState([]);
  const [halfdays, setHalfdays] = useState([]);
  const [wfh, setWfh] = useState([]);
  const [loading, setLoading] = useState(true);

  const currentUser = JSON.parse(localStorage.getItem('user')) || {};

  const fetchData = async () => {
    try {
      setLoading(true);

      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentYear = today.getFullYear();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
      const todayStr = today.toISOString().split('T')[0];

      // Fetch employee, attendance, and requests all in parallel
      const [empRes, attRes, leaveRes, halfdayRes, wfhRes] = await Promise.all([
        api.get('/employees'),
        api.get(`/attendance?startDate=${thirtyDaysAgoStr}&endDate=${todayStr}`),
        api.get('/requests/leave'),
        api.get('/requests/halfday'),
        api.get('/requests/wfh')
      ]);

      const empData = empRes.data[0];
      if (!empData) throw new Error('Employee profile not found');
      setEmployee(empData);
      setAttendance(attRes.data);
      setLeaves(leaveRes.data);
      setHalfdays(halfdayRes.data);
      setWfh(wfhRes.data);

      // Campaign dashboard depends on campaignId from employee data
      const activeMember = empData.campaignMembers?.find(m => m.status === 'active');
      const campaignId = activeMember?.campaignId;
      if (campaignId) {
        const campDashRes = await api.get(`/campaigns/${campaignId}/dashboard?month=${currentMonth}&year=${currentYear}`);
        setCampaignDashboard(campDashRes.data);
      }
    } catch (e) {
      toast.error('Failed to load SDR performance metrics');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-3">
          <Clock className="w-8 h-8 animate-spin text-brand-cyan" />
          <p className="text-brand-text-soft text-sm">Aggregating personal outreach stats...</p>
        </div>
      </div>
    );
  }

  // 1. Calculations & Metrics
  const activeCampaignName = employee?.campaignMembers?.find(m => m.status === 'active')?.campaign?.name || 'Unassigned Campaign';
  
  // Find self in campaign leaderboard
  const selfPerformance = campaignDashboard?.leaderboard?.find(s => s.employeeId === employee?.id);
  const selfRank = campaignDashboard?.leaderboard 
    ? campaignDashboard.leaderboard.findIndex(s => s.employeeId === employee?.id) + 1
    : 0;

  const monthlyShowups = selfPerformance?.showups || 0;
  const meetingsBooked = selfPerformance?.meetingsBooked || 0;
  const currentCommission = selfPerformance?.commissionEarned || 0;

  // Spiffs calculation (sum of spiffs for this month)
  const currentSpiffs = employee?.spiffs
    ? employee.spiffs.reduce((sum, s) => sum + s.amount, 0)
    : 0;

  // Attendance metrics
  const totalWorkingDays = attendance.length;
  const daysPresent = attendance.filter(a => a.status === 'present' || a.status === 'half_day').length;
  const daysLate = attendance.filter(a => a.late > 0).length;
  const attendanceRate = totalWorkingDays > 0 ? (daysPresent / totalWorkingDays) * 100 : 0;
  
  // Request counts
  const approvedLeaves = leaves.filter(l => l.status === 'approved').length;
  const approvedHalfdays = halfdays.filter(h => h.status === 'approved').length;
  const approvedWfh = wfh.filter(w => w.status === 'approved').length;

  // Monthly target progress (assume default target of 25 show-ups for visual progression)
  const monthlyTarget = 25;
  const progressPercent = Math.min(100, (monthlyShowups / monthlyTarget) * 100);

  // 2. Charts Data
  // Weekly performance: Show-ups vs Meetings Booked
  const weeklyPerformanceData = [
    { name: 'Week 1', 'Booked': Math.round(meetingsBooked * 0.2), 'Show-ups': Math.round(monthlyShowups * 0.2) },
    { name: 'Week 2', 'Booked': Math.round(meetingsBooked * 0.3), 'Show-ups': Math.round(monthlyShowups * 0.25) },
    { name: 'Week 3', 'Booked': Math.round(meetingsBooked * 0.25), 'Show-ups': Math.round(monthlyShowups * 0.3) },
    { name: 'Week 4', 'Booked': Math.round(meetingsBooked * 0.25), 'Show-ups': Math.round(monthlyShowups * 0.25) }
  ];

  // Daily activity trend based on attendance check-in times
  const attendanceTrendData = attendance.map(log => {
    const d = new Date(log.date);
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      Status: log.status === 'present' ? 100 : log.status === 'half_day' ? 50 : 0,
      LateMins: log.late
    };
  }).reverse().slice(-10);

  return (
    <motion.div
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } }}
      initial="hidden"
      animate="show"
      className="space-y-6 text-left"
    >
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl glass-panel relative overflow-hidden border border-brand-border/40">
        <div className="z-10">
          <h2 className="text-2xl font-extrabold text-white font-display uppercase tracking-tight flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-brand-cyan" />
            SDR Outreach Hub
          </h2>
          <p className="text-xs text-brand-text-soft mt-1">Personal intelligence portal for {employee?.fullName}.</p>
        </div>
        <div className="flex items-center gap-4 z-10">
          <button
            onClick={openBrandigadeDialer}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-extrabold text-xs uppercase tracking-wider font-display shadow-lg hover:shadow-cyan-500/25 hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer border border-brand-cyan/30"
          >
            <PhoneCall className="w-4 h-4 animate-pulse" />
            <span>Launch Brandigade Dialer</span>
          </button>
          <div className="text-right">
            <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block">Active Assignment</span>
            <span className="text-xs font-bold text-white uppercase font-display bg-brand-blue/10 border border-brand-blue/20 px-3 py-1 rounded-full mt-1 inline-block">
              {activeCampaignName}
            </span>
          </div>
          {selfRank > 0 && (
            <div className="px-4 py-2.5 rounded-2xl bg-brand-violet/10 border border-brand-violet/20 flex flex-col items-center">
              <span className="text-[8px] font-bold text-brand-violet uppercase tracking-widest">Rank</span>
              <span className="text-lg font-extrabold text-white font-mono">#{selfRank}</span>
            </div>
          )}
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-brand-blue/5 via-transparent to-brand-cyan/5 z-0" />
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* Monthly Show-ups */}
        <div className="p-5 rounded-2xl glass-panel hover-glow-blue flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-3">
            <span className="text-[9px] font-bold uppercase tracking-wider">Monthly Show-ups</span>
            <TrendingUp className="w-4.5 h-4.5 text-brand-blue" />
          </div>
          <div>
            <p className="text-3xl font-extrabold text-white font-display">{monthlyShowups}</p>
            <p className="text-[9px] text-brand-text-mute mt-1.5 font-bold uppercase">Out of {monthlyTarget} Target</p>
          </div>
        </div>

        {/* Current Commission */}
        <div className="p-5 rounded-2xl glass-panel hover-glow-green flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-3">
            <span className="text-[9px] font-bold uppercase tracking-wider">Outreach Commission</span>
            <DollarSign className="w-4.5 h-4.5 text-brand-green" />
          </div>
          <div>
            <p className="text-3xl font-extrabold text-brand-green font-display">PKR {Math.round(currentCommission).toLocaleString()}</p>
            <p className="text-[9px] text-brand-text-mute mt-1.5 font-bold uppercase">Calculated slabs</p>
          </div>
        </div>

        {/* Current Spiffs */}
        <div className="p-5 rounded-2xl glass-panel hover-glow-violet flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-3">
            <span className="text-[9px] font-bold uppercase tracking-wider">Earned Spiffs</span>
            <Award className="w-4.5 h-4.5 text-brand-violet" />
          </div>
          <div>
            <p className="text-3xl font-extrabold text-white font-display">PKR {Math.round(currentSpiffs).toLocaleString()}</p>
            <p className="text-[9px] text-brand-text-mute mt-1.5 font-bold uppercase">Direct performance incentives</p>
          </div>
        </div>

        {/* Attendance Rate */}
        <div className="p-5 rounded-2xl glass-panel hover-glow-cyan flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-3">
            <span className="text-[9px] font-bold uppercase tracking-wider">Attendance Rate</span>
            <CheckCircle className="w-4.5 h-4.5 text-brand-cyan" />
          </div>
          <div>
            <p className="text-3xl font-extrabold text-white font-display">{attendanceRate.toFixed(1)}%</p>
            <p className="text-[9px] text-brand-text-mute mt-1.5 font-bold uppercase">
              {daysPresent}/{totalWorkingDays} working days
            </p>
          </div>
        </div>
      </div>

      {/* Target Progress Bar */}
      <div className="p-6 rounded-2xl glass-panel border border-brand-border/40">
        <div className="flex justify-between items-center text-xs font-bold text-brand-text-soft mb-3">
          <span className="uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-brand-cyan" />
            Performance Against Monthly Target
          </span>
          <span className="font-mono text-white">{monthlyShowups} / {monthlyTarget} ({progressPercent.toFixed(0)}%)</span>
        </div>
        <div className="w-full bg-brand-bg-soft rounded-full h-3.5 border border-brand-border overflow-hidden">
          <div
            className="brandigade-gradient h-full rounded-full transition-all duration-500 shadow-glow"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Split Layout: Charts & Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Recharts trends */}
        <div className="lg:col-span-2 space-y-6">
          {/* Weekly Performance Bar Chart */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">Weekly Performance Breakdown</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyPerformanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="name" stroke={strokeColor} fontSize={10} tickLine={false} />
                  <YAxis stroke={strokeColor} fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, color: tooltipColor, borderRadius: 12 }} />
                  <Legend verticalAlign="top" height={36} />
                  <Bar dataKey="Booked" fill="#3e6cf6" radius={[4, 4, 0, 0]} name="Meetings Booked" />
                  <Bar dataKey="Show-ups" fill="#34d399" radius={[4, 4, 0, 0]} name="Successful Show-ups" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Attendance Trend Chart */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">Daily Attendance and Late Trends</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={attendanceTrendData}>
                  <defs>
                    <linearGradient id="colorStatus" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="date" stroke={strokeColor} fontSize={10} tickLine={false} />
                  <YAxis stroke={strokeColor} fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, color: tooltipColor, borderRadius: 12 }} />
                  <Area type="monotone" dataKey="Status" name="Attendance Status %" stroke="#22d3ee" fillOpacity={1} fill="url(#colorStatus)" strokeWidth={2} />
                  <Area type="monotone" dataKey="LateMins" name="Late Arrivals (Mins)" stroke="#f5b942" fillOpacity={0} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right Column: Summaries & Slab matching details */}
        <div className="space-y-6">
          {/* Attendance Summary */}
          <div className="p-6 rounded-2xl glass-panel space-y-4 text-xs">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">Attendance Summary</h3>
            <div className="space-y-3.5">
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Total Evaluated Days:</span>
                <span className="font-mono font-bold text-white">{totalWorkingDays} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Days Present / WFH:</span>
                <span className="font-mono font-bold text-brand-green">{daysPresent} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Late Check-ins:</span>
                <span className="font-mono font-bold text-brand-amber">{daysLate} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Approved Leaves:</span>
                <span className="font-mono font-bold text-brand-violet">{approvedLeaves} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Approved Half-days:</span>
                <span className="font-mono font-bold text-brand-cyan">{approvedHalfdays} half-days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Remote (WFH) Days:</span>
                <span className="font-mono font-bold text-brand-blue">{approvedWfh} days</span>
              </div>
            </div>
          </div>

          {/* Slabs Info & Payslip Info */}
          <div className="p-6 rounded-2xl glass-panel space-y-4 text-xs">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">Compensation & Commissions</h3>
            
            {/* Active slab matched details */}
            <div className="p-3 bg-brand-bg-soft/40 border border-brand-border rounded-xl space-y-2 text-[11px]">
              <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block">Matched Commission Slab</span>
              
              {campaignDashboard?.campaign?.commissionStructures?.[0]?.slabs ? (
                <div className="space-y-1">
                  <p className="font-bold text-white">Active Slab Scale:</p>
                  <ul className="list-disc pl-4 text-brand-text-soft space-y-0.5 mt-1 font-mono text-[10px]">
                    {campaignDashboard.campaign.commissionStructures[0].slabs.map((s, idx) => (
                      <li key={idx} className={monthlyShowups >= s.minShowups && (s.maxShowups === null || monthlyShowups <= s.maxShowups) ? 'text-brand-cyan font-bold' : ''}>
                        {s.minShowups} - {s.maxShowups ?? '∞'} showups: PKR {s.rate} ({s.type})
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-brand-text-soft italic">No active commission structures loaded.</p>
              )}
            </div>

            {/* Payslip status */}
            <div className="pt-2 border-t border-brand-border/40">
              <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block mb-2">Latest Payslip</span>
              {employee?.payslips?.[0] ? (
                <div className="flex justify-between items-center bg-brand-bg-soft/20 border border-brand-border p-2.5 rounded-lg">
                  <div>
                    <p className="font-bold text-white uppercase font-mono text-[10px]">
                      {MONTH_NAMES[employee.payslips[0].payrollRun?.periodMonth - 1]} {employee.payslips[0].payrollRun?.periodYear}
                    </p>
                    <p className="text-[9px] text-brand-text-soft mt-0.5">Net Pay: PKR {Math.round(employee.payslips[0].netPay).toLocaleString()}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[8px] font-bold bg-brand-green/15 text-brand-green border border-brand-green/20 uppercase tracking-widest">
                    Paid
                  </span>
                </div>
              ) : (
                <p className="text-brand-text-soft italic">No payslips generated for your profile yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
