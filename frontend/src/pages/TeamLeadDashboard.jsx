import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Briefcase,
  CalendarCheck,
  AlertCircle,
  Clock,
  TrendingUp,
  Award,
  DollarSign,
  UserCheck,
  FileSpreadsheet,
  CheckCircle,
  HelpCircle,
  ArrowRight
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
  Line
} from 'recharts';
import api from '../utils/api';
import toast from 'react-hot-toast';
import { useTheme } from '../utils/themeContext';

const COLORS = ['#3e6cf6', '#8b5cf6', '#22d3ee', '#34d399', '#f5b942', '#ef4444'];

export default function TeamLeadDashboard() {
  const { theme, isDark } = useTheme();

  const strokeColor = isDark ? '#6b7287' : '#94a3b8';
  const gridStroke = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15, 23, 42, 0.08)';
  const tooltipBg = isDark ? '#0d101c' : '#ffffff';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15, 23, 42, 0.08)';
  const tooltipColor = isDark ? '#f4f6fb' : '#0f172a';

  const [teamMembers, setTeamMembers] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
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
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(today.getDate() - 10);
      const tenDaysAgoStr = tenDaysAgo.toISOString().split('T')[0];
      const todayStr = today.toISOString().split('T')[0];

      // Fetch ALL data in parallel — employees, campaigns, attendance, and requests
      const [empRes, campRes, attRes, leaveRes, halfdayRes, wfhRes] = await Promise.all([
        api.get('/employees'),
        api.get('/campaigns'),
        api.get(`/attendance?startDate=${tenDaysAgoStr}&endDate=${todayStr}`),
        api.get('/requests/leave?status=pending'),
        api.get('/requests/halfday?status=pending'),
        api.get('/requests/wfh?status=pending')
      ]);

      setTeamMembers(empRes.data);
      setCampaigns(campRes.data);
      setAttendance(attRes.data);
      setLeaves(leaveRes.data);
      setHalfdays(halfdayRes.data);
      setWfh(wfhRes.data);

      // Fetch campaign dashboard (depends on knowing which campaign is active)
      const activeCampaign = campRes.data.find(c => c.status === 'active');
      if (activeCampaign) {
        const dashRes = await api.get(`/campaigns/${activeCampaign.id}/dashboard?month=${currentMonth}&year=${currentYear}`);
        setCampaignDashboard(dashRes.data);
      }

    } catch (err) {
      toast.error('Failed to load Team Lead metrics');
      console.error(err);
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
          <p className="text-brand-text-soft text-sm">Aggregating team performance statistics...</p>
        </div>
      </div>
    );
  }

  // Calculations
  const activeCampaign = campaigns.find(c => c.status === 'active');
  const teamName = activeCampaign?.name || 'No Active Campaign';
  
  const sdrs = teamMembers.filter(e => e.user?.role === 'SDR');
  const totalSdrs = sdrs.length;

  // Today's attendance
  const todayStr = new Date().toISOString().split('T')[0];
  const todayAttendance = attendance.filter(a => new Date(a.date).toISOString().split('T')[0] === todayStr);

  const presentTodayCount = todayAttendance.filter(a => a.status === 'present' || a.status === 'half_day').length;
  const absentTodayCount = Math.max(0, totalSdrs - presentTodayCount);
  const lateTodayCount = todayAttendance.filter(a => a.late > 0).length;

  const monthlyShowups = campaignDashboard?.stats?.showups || 0;
  const meetingsBooked = campaignDashboard?.stats?.meetingsBooked || 0;
  const totalTeamCommission = campaignDashboard?.stats?.commissionPaid || 0;

  // Requests count
  const pendingLeavesCount = leaves.length;
  const pendingHalfdaysCount = halfdays.length;
  const pendingWfhCount = wfh.length;

  // Leaderboard statistics
  const leaderboard = campaignDashboard?.leaderboard || [];
  const topPerformer = leaderboard[0]?.fullName || 'None';
  
  // Averages
  const averageShowupsPerSdr = totalSdrs > 0 ? parseFloat((monthlyShowups / totalSdrs).toFixed(1)) : 0;
  
  // Calculate average attendance rate of team members
  const attendanceRate = totalSdrs > 0 && attendance.length > 0
    ? parseFloat(((attendance.filter(a => a.status === 'present' || a.status === 'half_day').length / attendance.length) * 100).toFixed(1))
    : 90;

  // Target Progress (Assume overall team target is 100 show-ups)
  const teamTarget = 100;
  const progressPercent = Math.min(100, (monthlyShowups / teamTarget) * 100);

  // ---------------------------------------------------------------------------
  // Charts Formatting
  // ---------------------------------------------------------------------------
  // 1. Show-ups by Team Member
  const showupsByMemberData = leaderboard.map(sdr => ({
    name: sdr.fullName.split(' ')[0],
    'Show-ups': sdr.showups,
    'Meetings Booked': sdr.meetingsBooked
  }));

  // 2. Attendance Trend Data
  const dailyAttendanceMap = {};
  attendance.forEach(log => {
    const dStr = new Date(log.date).toISOString().split('T')[0];
    if (!dailyAttendanceMap[dStr]) {
      dailyAttendanceMap[dStr] = { present: 0, total: 0 };
    }
    dailyAttendanceMap[dStr].total++;
    if (log.status === 'present' || log.status === 'half_day') {
      dailyAttendanceMap[dStr].present++;
    }
  });

  const attendanceTrendData = Object.keys(dailyAttendanceMap).sort().map(dStr => {
    const d = new Date(dStr);
    const m = dailyAttendanceMap[dStr];
    return {
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      Rate: parseFloat(((m.present / (m.total || 1)) * 100).toFixed(0))
    };
  });

  // 3. Commission Distribution
  const commissionDistributionData = leaderboard.map(sdr => ({
    name: sdr.fullName.split(' ')[0],
    value: sdr.commissionEarned
  })).filter(d => d.value > 0);

  return (
    <motion.div
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } }}
      initial="hidden"
      animate="show"
      className="space-y-6 text-left"
    >
      {/* Top Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl glass-panel relative overflow-hidden border border-brand-border/40">
        <div className="z-10">
          <h2 className="text-2xl font-extrabold text-white font-display uppercase tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-cyan" />
            Team Lead Hub
          </h2>
          <p className="text-xs text-brand-text-soft mt-1">Management center for active outreach SDR campaigns.</p>
        </div>
        <div className="z-10 text-right">
          <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block">Campaign Assigned</span>
          <span className="text-sm font-extrabold text-white uppercase font-display bg-brand-cyan/15 border border-brand-cyan/30 px-3.5 py-1 rounded-full mt-1 inline-block">
            {teamName}
          </span>
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-brand-blue/5 via-transparent to-brand-cyan/5 z-0" />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {/* Total SDRs */}
        <div className="p-4 rounded-xl glass-panel hover-glow-blue flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Total SDRs</span>
            <Users className="w-4.5 h-4.5 text-brand-blue" />
          </div>
          <p className="text-2xl font-extrabold text-white font-display">{totalSdrs}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">Assigned Team Size</span>
        </div>

        {/* Present Today */}
        <div className="p-4 rounded-xl glass-panel hover-glow-green flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Present Today</span>
            <UserCheck className="w-4.5 h-4.5 text-brand-green" />
          </div>
          <p className="text-2xl font-extrabold text-brand-green font-display">{presentTodayCount}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">{absentTodayCount} SDRs Absent</span>
        </div>

        {/* Monthly Show-ups */}
        <div className="p-4 rounded-xl glass-panel hover-glow-cyan flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Monthly Show-ups</span>
            <TrendingUp className="w-4.5 h-4.5 text-brand-cyan" />
          </div>
          <p className="text-2xl font-extrabold text-white font-display">{monthlyShowups}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">{meetingsBooked} Booked</span>
        </div>

        {/* Team Commission */}
        <div className="p-4 rounded-xl glass-panel hover-glow-violet flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Team Commission</span>
            <DollarSign className="w-4.5 h-4.5 text-brand-violet" />
          </div>
          <p className="text-2xl font-extrabold text-white font-display">PKR {Math.round(totalTeamCommission).toLocaleString()}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">Payout this Month</span>
        </div>
      </div>

      {/* Target Progress Bar */}
      <div className="p-6 rounded-2xl glass-panel border border-brand-border/40">
        <div className="flex justify-between items-center text-xs font-bold text-brand-text-soft mb-3">
          <span className="uppercase tracking-wider">Team Campaign Progress Target</span>
          <span className="font-mono text-white">{monthlyShowups} / {teamTarget} ({progressPercent.toFixed(0)}%)</span>
        </div>
        <div className="w-full bg-brand-bg-soft rounded-full h-3 border border-brand-border overflow-hidden">
          <div
            className="brandigade-gradient h-full rounded-full transition-all duration-500 shadow-glow"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Split Analytics & Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Recharts visual trends */}
        <div className="lg:col-span-2 space-y-6">
          {/* Show-ups by Team Member */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">Show-ups by Team Member</h3>
            <div className="h-64 w-full">
              {showupsByMemberData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={showupsByMemberData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="name" stroke={strokeColor} fontSize={10} tickLine={false} />
                    <YAxis stroke={strokeColor} fontSize={10} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, color: tooltipColor, borderRadius: 12 }} />
                    <Legend verticalAlign="top" height={36} />
                    <Bar dataKey="Meetings Booked" fill="#3e6cf6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Show-ups" fill="#34d399" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-brand-text-mute italic py-12 text-center">No showups registered for this campaign yet</p>
              )}
            </div>
          </div>

          {/* Attendance Trend Line */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">Daily Attendance Trend Rate</h3>
            <div className="h-64 w-full">
              {attendanceTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={attendanceTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" stroke={strokeColor} fontSize={10} tickLine={false} />
                    <YAxis stroke={strokeColor} fontSize={10} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, color: tooltipColor, borderRadius: 12 }} />
                    <Line type="monotone" dataKey="Rate" name="Attendance Rate %" stroke="#22d3ee" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-brand-text-mute italic py-12 text-center">No attendance logs logged yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Summaries & Leaderboard distributions */}
        <div className="space-y-6">
          {/* Team Analytics Insight */}
          <div className="p-6 rounded-2xl glass-panel space-y-4 text-xs">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display font-bold">Team Performance Insights</h3>
            
            <div className="space-y-3.5">
              <div className="flex justify-between items-center">
                <span className="text-brand-text-soft">Top Performer of Month:</span>
                <span className="font-bold text-white uppercase tracking-wide flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-brand-cyan" />
                  {topPerformer}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Team Attendance Rate:</span>
                <span className="font-mono font-bold text-brand-green">{attendanceRate.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Average Show-ups per SDR:</span>
                <span className="font-mono font-bold text-brand-cyan">{averageShowupsPerSdr} show-ups</span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Pending Team Requests:</span>
                <span className="font-mono font-bold text-brand-amber">
                  {pendingLeavesCount + pendingHalfdaysCount + pendingWfhCount} requests
                </span>
              </div>
            </div>
          </div>

          {/* Commission distribution pie chart */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">Commission Payout Shares</h3>
            <div className="h-48 w-full flex justify-center items-center">
              {commissionDistributionData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={commissionDistributionData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      outerRadius={60}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {commissionDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, color: tooltipColor, borderRadius: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-brand-text-mute italic">No commissions payout recorded</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Team Roster Table */}
      <div className="p-6 rounded-2xl glass-panel border border-brand-border/40 space-y-4">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider font-display">Active Team Members</h3>
        
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-brand-border bg-brand-bg-elevated/40 text-[9px] uppercase font-extrabold tracking-widest text-brand-text-soft">
                <th className="py-3 px-4">Name</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Today's Attendance</th>
                <th className="py-3 px-4 text-center">Meetings Booked</th>
                <th className="py-3 px-4 text-center">Monthly Show-ups</th>
                <th className="py-3 px-4 text-right">Commissions</th>
              </tr>
            </thead>
            <tbody>
              {sdrs.map(sdr => {
                const attLog = todayAttendance.find(a => a.employeeId === sdr.id);
                const perf = leaderboard.find(l => l.employeeId === sdr.id);

                let statusColor = 'text-brand-text-mute border-brand-border bg-brand-border/10';
                let statusLabel = 'Absent';
                if (attLog) {
                  if (attLog.status === 'present') {
                    statusColor = 'text-brand-green border-brand-green/20 bg-brand-green/5';
                    statusLabel = 'Present';
                  } else if (attLog.status === 'half_day') {
                    statusColor = 'text-brand-amber border-brand-amber/20 bg-brand-amber/5';
                    statusLabel = 'Half Day';
                  } else if (attLog.status === 'wfh') {
                    statusColor = 'text-brand-blue border-brand-blue/20 bg-brand-blue/5';
                    statusLabel = 'WFH';
                  }
                }

                return (
                  <tr key={sdr.id} className="border-b border-brand-border/30 hover:bg-brand-bg-elevated/20 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">{sdr.fullName}</td>
                    <td className="py-3 px-4 font-mono text-[10px] text-brand-text-soft">{sdr.designation}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2.5 py-0.5 rounded-full border text-[8px] font-bold uppercase tracking-widest ${statusColor}`}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-white">{perf?.meetingsBooked || 0}</td>
                    <td className="py-3 px-4 text-center font-mono font-bold text-brand-green">{perf?.showups || 0}</td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-white">
                      PKR {Math.round(perf?.commissionEarned || 0).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
              {sdrs.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-brand-text-mute italic">No SDR outreach employees assigned to your team</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
