import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Briefcase,
  TrendingUp,
  Clock,
  UserCheck,
  RefreshCw,
  Sliders,
  AlertTriangle,
  Zap
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
  Legend,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import api, { apiError } from '../utils/api';
import toast from 'react-hot-toast';
import { useTheme } from '../utils/themeContext';

const COLORS = ['#3e6cf6', '#8b5cf6', '#22d3ee', '#34d399', '#f5b942', '#ef4444'];

export default function DigitalTwin() {
  const { isDark } = useTheme();
  
  const strokeColor = isDark ? '#6b7287' : '#94a3b8';
  const gridStroke = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(15, 23, 42, 0.08)';
  const tooltipBg = isDark ? '#0d101c' : '#ffffff';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15, 23, 42, 0.08)';
  const tooltipColor = isDark ? '#f4f6fb' : '#0f172a';

  // Live State
  const [employees, setEmployees] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [halfdayRequests, setHalfdayRequests] = useState([]);
  const [wfhRequests, setWfhRequests] = useState([]);
  const [loanRequests, setLoanRequests] = useState([]);
  const [campaignDetails, setCampaignDetails] = useState({});
  const [loading, setLoading] = useState(true);

  // Simulation State
  const [simMode, setSimMode] = useState(false);
  const [simAbsences, setSimAbsences] = useState(0); // overall additional absences
  const [simCampaignSdrDiffs, setSimCampaignSdrDiffs] = useState({}); // campaignId -> added SDRs
  const [simShowupPercentDiffs, setSimShowupPercentDiffs] = useState({}); // campaignId -> percent increase in showups

  // Load Data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [
        empRes,
        campRes,
        leaveRes,
        halfdayRes,
        wfhRes,
        loanRes,
      ] = await Promise.all([
        api.get('/employees'),
        api.get('/campaigns'),
        api.get('/requests/leave'),
        api.get('/requests/halfday'),
        api.get('/requests/wfh'),
        api.get('/loans'),
      ]);

      setEmployees(empRes.data);
      setCampaigns(campRes.data);
      setLeaveRequests(leaveRes.data);
      setHalfdayRequests(halfdayRes.data);
      setWfhRequests(wfhRes.data);
      setLoanRequests(loanRes.data);

      // Fetch last 30 days of attendance
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 30);
      const startDateStr = thirtyDaysAgo.toISOString().split('T')[0];
      const endDateStr = today.toISOString().split('T')[0];
      const attRes = await api.get(`/attendance?startDate=${startDateStr}&endDate=${endDateStr}`);
      setAttendance(attRes.data);

      // Fetch detailed dashboards for active campaigns in parallel
      const activeCampaigns = campRes.data.filter(c => c.status === 'active');
      const detailsMap = {};
      await Promise.all(
        activeCampaigns.map(async (camp) => {
          try {
            const res = await api.get(`/campaigns/${camp.id}/dashboard`);
            detailsMap[camp.id] = res.data;
          } catch (e) {
            console.error(`Campaign dashboard ${camp.id}:`, apiError(e));
          }
        })
      );
      setCampaignDetails(detailsMap);

      toast.success('Digital Twin state synchronized');
    } catch (err) {
      toast.error('Failed to sync Digital Twin operational state');
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
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Clock className="w-8 h-8 animate-spin text-brand-cyan" />
          <p className="text-brand-text-soft text-sm">Synchronizing virtual models...</p>
        </div>
      </div>
    );
  }

  // Active / Total employee calculations
  const activeEmployees = employees.filter(e => e.status === 'active');
  const totalEmployeesCount = activeEmployees.length;

  // Today's attendance calculation
  const todayStr = new Date().toISOString().split('T')[0];
  const todayAttendance = attendance.filter(a => {
    const dStr = new Date(a.date).toISOString().split('T')[0];
    return dStr === todayStr;
  });

  const normalPresentCount = todayAttendance.filter(a => a.status === 'present' || a.status === 'half_day').length;
  const normalLateCount = todayAttendance.filter(a => a.late > 0).length;
  const normalAbsentCount = todayAttendance.filter(a => a.status === 'absent').length;
  const normalLeaveCount = todayAttendance.filter(a => a.status === 'leave' || a.status === 'on_leave').length;
  const normalWfhCount = todayAttendance.filter(a => a.status === 'wfh').length;

  // Requests stats
  const pendingLeaves = leaveRequests.filter(r => r.status === 'pending').length;
  const pendingHalfdays = halfdayRequests.filter(r => r.status === 'pending').length;
  const pendingWfh = wfhRequests.filter(r => r.status === 'pending').length;
  const pendingLoans = loanRequests.filter(r => r.status === 'pending').length;
  const totalPendingRequests = pendingLeaves + pendingHalfdays + pendingWfh + pendingLoans;

  // Active campaigns count
  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const activeCampaignsCount = activeCampaigns.length;

  // Team Leads list & count
  const teamLeadsCount = activeEmployees.filter(e => e.designation?.toLowerCase().includes('lead') || e.user?.role === 'Team Lead').length;


  // ---------------------------------------------------------------------------
  // Simulation calculations
  // ---------------------------------------------------------------------------
  
  // Simulated stats variables
  const projectedPresent = Math.max(0, normalPresentCount - simAbsences - Math.floor(totalEmployeesCount * (simAbsences > 0 ? 0.05 : 0))); // simulated absences deduct present
  const projectedAbsent = normalAbsentCount + simAbsences;
  const projectedWfh = normalWfhCount;
  const projectedLeave = normalLeaveCount;
  const projectedLate = normalLateCount;

  // Today's attendance percentage
  const normalAttendanceRate = totalEmployeesCount > 0 ? (normalPresentCount / totalEmployeesCount) * 100 : 0;
  const projectedAttendanceRate = totalEmployeesCount > 0 ? (projectedPresent / totalEmployeesCount) * 100 : 0;

  // ---------------------------------------------------------------------------
  // Payroll calculations (Live vs Simulated)
  // ---------------------------------------------------------------------------
  let liveTotalCommissions = 0;
  let liveMeetingsBooked = 0;
  let liveShowups = 0;
  let projectedTotalCommissions = 0;

  // Compute live payroll amounts
  Object.values(campaignDetails).forEach(detail => {
    liveTotalCommissions += detail.stats?.commissionPaid || 0;
    liveMeetingsBooked += detail.stats?.meetingsBooked || 0;
    liveShowups += detail.stats?.showups || 0;
  });

  // Calculate projected payroll based on simulation
  projectedTotalCommissions = liveTotalCommissions;
  activeCampaigns.forEach(camp => {
    const detail = campaignDetails[camp.id];
    if (!detail) return;

    // Get simulated increases
    const sdrDiff = simCampaignSdrDiffs[camp.id] || 0;
    const showupPercentIncrease = simShowupPercentDiffs[camp.id] || 0;

    let baseShowups = detail.stats?.showups || 0;
    
    // Simulate additional showups from new SDRs (each bringing average showups)
    const activeSdrs = detail.campaign?.totalSdrs || 1;
    const avgShowupPerSdr = baseShowups / (activeSdrs || 1);
    
    let simulatedShowups = baseShowups + (sdrDiff * (avgShowupPerSdr || 8));
    // Apply percentage modifier
    simulatedShowups = simulatedShowups * (1 + showupPercentIncrease / 100);

    // Estimate commission change
    const activeStructure = camp.commissionStructures.find(s => s.status === 'active') || camp.commissionStructures[0];
    if (activeStructure && activeStructure.slabs.length > 0) {
      // Calculate original commission for this campaign
      const origCampaignComm = detail.stats?.commissionPaid || 0;

      // Re-estimate commission based on new average showups per simulated SDR
      const totalSimSdrs = activeSdrs + sdrDiff;
      const simAvgShowups = totalSimSdrs > 0 ? simulatedShowups / totalSimSdrs : 0;

      const slab = activeStructure.slabs.find(s => 
        simAvgShowups >= s.minShowups && 
        (s.maxShowups === null || simAvgShowups <= s.maxShowups)
      );

      let newEstimatedComm = 0;
      if (slab) {
        if (slab.type === 'per_showup') {
          newEstimatedComm = simulatedShowups * slab.rate;
        } else if (slab.type === 'fixed_monthly') {
          newEstimatedComm = slab.rate * totalSimSdrs;
        } else if (slab.type === 'percentage') {
          newEstimatedComm = slab.rate * simulatedShowups;
        } else if (slab.type === 'hybrid') {
          newEstimatedComm = (slab.rate * totalSimSdrs) + (simulatedShowups * 2000);
        }
      }

      // TL override override recalculation
      let newTLComm = 0;
      const lead = camp.members.find(m => m.role === 'team_lead');
      if (lead) {
        newTLComm = newEstimatedComm * 0.1; // estimate 10% TL override
      }

      const projectedCampaignTotal = newEstimatedComm + newTLComm;
      projectedTotalCommissions = projectedTotalCommissions - origCampaignComm + projectedCampaignTotal;
    }
  });

  // Calculate Base Salary Deductions from simulated absences
  // average employee base salary
  const avgBaseSalary = activeEmployees.length > 0 
    ? activeEmployees.reduce((sum, e) => sum + (e.baseSalary || 0), 0) / activeEmployees.length
    : 35000;
  const dailyAbsencePenalty = avgBaseSalary / 26; // assume 26 working days
  const estimatedAbsenceDeductions = simAbsences * dailyAbsencePenalty;

  // Reset Simulation Function
  const resetSimulation = () => {
    setSimAbsences(0);
    setSimCampaignSdrDiffs({});
    setSimShowupPercentDiffs({});
    setSimTLReassignments({});
    setSimMode(false);
    toast.success('Simulation state reset');
  };

  // ---------------------------------------------------------------------------
  // Charts & Metrics Aggregations
  // ---------------------------------------------------------------------------

  // 1. Workforce Status Chart Data
  const workforcePieData = [
    { name: 'Working', value: simMode ? projectedPresent : normalPresentCount },
    { name: 'Absent', value: simMode ? projectedAbsent : normalAbsentCount },
    { name: 'On Leave', value: simMode ? projectedLeave : normalLeaveCount },
    { name: 'WFH', value: simMode ? projectedWfh : normalWfhCount },
    { name: 'Late', value: simMode ? projectedLate : normalLateCount }
  ].filter(d => d.value > 0);

  // 2. Attendance Trend Data (Last 7 Days)
  const attendanceTrendData = [];
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dailyAttendanceMap = {};

  attendance.forEach(log => {
    const dStr = new Date(log.date).toISOString().split('T')[0];
    if (!dailyAttendanceMap[dStr]) {
      dailyAttendanceMap[dStr] = { present: 0, total: 0, late: 0 };
    }
    dailyAttendanceMap[dStr].total++;
    if (log.status === 'present' || log.status === 'half_day') {
      dailyAttendanceMap[dStr].present++;
    }
    if (log.late > 0) {
      dailyAttendanceMap[dStr].late++;
    }
  });

  const sortedDates = Object.keys(dailyAttendanceMap).sort().slice(-7);
  sortedDates.forEach(dateStr => {
    const d = new Date(dateStr);
    const metrics = dailyAttendanceMap[dateStr];
    attendanceTrendData.push({
      date: `${d.getMonth() + 1}/${d.getDate()}`,
      day: daysOfWeek[d.getDay()],
      Rate: parseFloat(((metrics.present / (metrics.total || 1)) * 100).toFixed(1)),
      Lates: metrics.late
    });
  });

  if (attendanceTrendData.length === 0) {
    // Fallback static trend data
    attendanceTrendData.push(
      { date: '7/2', day: 'Thu', Rate: 88, Lates: 2 },
      { date: '7/3', day: 'Fri', Rate: 92, Lates: 1 },
      { date: '7/6', day: 'Mon', Rate: 85, Lates: 4 },
      { date: '7/7', day: 'Tue', Rate: 90, Lates: 3 },
      { date: '7/8', day: 'Wed', Rate: 91, Lates: 1 },
      { date: '7/9', day: 'Thu', Rate: Number(projectedAttendanceRate.toFixed(0)), Lates: projectedLate }
    );
  }

  // 3. Campaign Performance comparison data
  const campaignPerformanceData = activeCampaigns.map(camp => {
    const detail = campaignDetails[camp.id];
    const sdrDiff = simCampaignSdrDiffs[camp.id] || 0;
    const showupPercentIncrease = simShowupPercentDiffs[camp.id] || 0;

    let showups = detail?.stats?.showups || 0;
    const activeSdrs = detail?.campaign?.totalSdrs || 1;
    const avgShowupPerSdr = showups / activeSdrs;

    // Projected showups
    let projectedShowups = showups + (sdrDiff * (avgShowupPerSdr || 8));
    projectedShowups = projectedShowups * (1 + showupPercentIncrease / 100);

    return {
      name: camp.name,
      'Live Show-ups': showups,
      'Projected Show-ups': Math.round(projectedShowups)
    };
  });


  // 5. Performance Leaderboards
  let topPerformingCampaign = 'None';
  let topPerformingTeam = 'None';
  let topSDRs = [];

  // Flatten SDR lists and sort by showups
  const allSdrPerformances = [];
  activeCampaigns.forEach(camp => {
    const detail = campaignDetails[camp.id];
    if (detail?.leaderboard) {
      detail.leaderboard.forEach(sdr => {
        allSdrPerformances.push({
          ...sdr,
          campaignName: camp.name
        });
      });
    }
  });

  allSdrPerformances.sort((a, b) => b.showups - a.showups);
  topSDRs = allSdrPerformances.slice(0, 5);

  // Find top campaign by showups
  let maxShowups = -1;
  activeCampaigns.forEach(camp => {
    const detail = campaignDetails[camp.id];
    const showups = detail?.stats?.showups || 0;
    if (showups > maxShowups) {
      maxShowups = showups;
      topPerformingCampaign = camp.name;
      topPerformingTeam = detail?.campaign?.teamLead || 'Unassigned';
    }
  });

  // 6. Heatmap grid data (28 calendar boxes of recent attendance)
  const heatmapData = [];
  const heatmapDates = Object.keys(dailyAttendanceMap).sort().slice(-28);
  heatmapDates.forEach(dateStr => {
    const metrics = dailyAttendanceMap[dateStr];
    heatmapData.push({
      date: dateStr,
      rate: parseFloat(((metrics.present / (metrics.total || 1)) * 100).toFixed(0))
    });
  });

  if (heatmapData.length === 0) {
    // Fill with fallback dummy boxes if no database records
    for (let i = 27; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const rates = [92, 85, 96, 74, 90, 88, 91, 79, 95, 100, 84, 87];
      heatmapData.push({
        date: d.toISOString().split('T')[0],
        rate: rates[i % rates.length]
      });
    }
  }

  // Health calculation helper
  const getCampaignHealth = (campId) => {
    const detail = campaignDetails[campId];
    if (!detail) return { label: '🟢 Healthy', color: 'text-brand-green border-brand-green/20 bg-brand-green/5' };

    const sdrDiff = simCampaignSdrDiffs[campId] || 0;
    const showupPercentIncrease = simShowupPercentDiffs[campId] || 0;
    let showups = detail.stats?.showups || 0;
    const activeSdrs = (detail.campaign?.totalSdrs || 1) + sdrDiff;
    const avgShowupPerSdr = showups / (detail.campaign?.totalSdrs || 1);

    // Projected showups
    let projectedShowups = showups + (sdrDiff * (avgShowupPerSdr || 8));
    projectedShowups = projectedShowups * (1 + showupPercentIncrease / 100);

    const projectedAvgShowup = activeSdrs > 0 ? projectedShowups / activeSdrs : 0;

    // Simulate attendance rate
    const normalAtt = detail.stats?.attendanceRate ?? 90;
    // If overall absences are simulated, reduce campaign attendance rate
    const projectedAtt = Math.max(0, normalAtt - (simAbsences * 1.5));

    if (projectedAtt < 70 || projectedAvgShowup < 5) {
      return { label: '🔴 Critical', color: 'text-brand-red border-brand-red/20 bg-brand-red/5' };
    } else if (projectedAtt < 85 || projectedAvgShowup < 10) {
      return { label: '🟡 Attention Required', color: 'text-brand-amber border-brand-amber/20 bg-brand-amber/5' };
    }
    return { label: '🟢 Healthy', color: 'text-brand-green border-brand-green/20 bg-brand-green/5' };
  };

  return (
    <div className="space-y-6 text-left relative">
      {/* Simulation Indicator Overlay */}
      <AnimatePresence>
        {simMode && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="p-3 bg-brand-blue/10 border border-brand-blue/30 rounded-2xl flex items-center justify-between gap-4 z-20 backdrop-blur-md relative"
          >
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-brand-cyan animate-pulse" />
              <div className="text-left">
                <p className="text-xs font-extrabold text-brand-text uppercase tracking-wider font-display">Simulation Mode Active</p>
                <p className="text-[10px] text-brand-text-soft">Visualizing projected operational impacts. Database changes are completely disabled.</p>
              </div>
            </div>
            <button
              onClick={resetSimulation}
              className="px-4 py-1.5 rounded-full bg-brand-blue text-brand-bg text-[10px] uppercase font-bold hover:scale-[1.02] active:scale-[0.98] transition-transform flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset Simulation
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase flex items-center gap-2">
            <Sliders className="w-5 h-5 text-brand-cyan" />
            Digital Twin Overview
          </h2>
          <p className="text-xs text-brand-text-soft mt-1">Real-time virtual mirror of operational metrics, attendance logs, and predictive impact modeling.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchData}
            className="p-2.5 rounded-full border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue-soft transition-colors cursor-pointer"
            title="Refresh Live Data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary Stats Twin */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Total Headcount */}
        <div className="p-4 rounded-xl glass-panel hover-glow-blue flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Total Headcount</span>
            <Users className="w-4 h-4 text-brand-blue" />
          </div>
          <p className="text-2xl font-extrabold text-brand-text font-display">{totalEmployeesCount}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">Active Profiles</span>
        </div>

        {/* Present Today */}
        <div className="p-4 rounded-xl glass-panel hover-glow-green flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Present Today</span>
            <UserCheck className="w-4 h-4 text-brand-green" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl font-extrabold text-brand-text font-display">{simMode ? projectedPresent : normalPresentCount}</p>
            {simMode && projectedPresent !== normalPresentCount && (
              <span className={`text-[10px] font-bold ${projectedPresent < normalPresentCount ? 'text-brand-red' : 'text-brand-green'}`}>
                {projectedPresent < normalPresentCount ? '↓' : '↑'}
              </span>
            )}
          </div>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">Simulated Check-ins</span>
        </div>

        {/* Attendance Rate */}
        <div className="p-4 rounded-xl glass-panel hover-glow-cyan flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Attendance Rate</span>
            <TrendingUp className="w-4 h-4 text-brand-cyan" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <p className="text-2xl font-extrabold text-brand-text font-display">
              {(simMode ? projectedAttendanceRate : normalAttendanceRate).toFixed(1)}%
            </p>
            {simMode && projectedAttendanceRate !== normalAttendanceRate && (
              <span className={`text-[10px] font-bold ${projectedAttendanceRate < normalAttendanceRate ? 'text-brand-red' : 'text-brand-green'}`}>
                {projectedAttendanceRate < normalAttendanceRate ? '↓' : '↑'}
              </span>
            )}
          </div>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">Workforce Attendance</span>
        </div>

        {/* Active Campaigns */}
        <div className="p-4 rounded-xl glass-panel hover-glow-violet flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Active Campaigns</span>
            <Briefcase className="w-4 h-4 text-brand-violet" />
          </div>
          <p className="text-2xl font-extrabold text-brand-text font-display">{activeCampaignsCount}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">Led by {teamLeadsCount} TLs</span>
        </div>

        {/* Pending Requests */}
        <div className="p-4 rounded-xl glass-panel hover-glow-amber flex flex-col justify-between">
          <div className="flex items-center justify-between text-brand-text-soft mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider">Pending Requests</span>
            <AlertTriangle className="w-4 h-4 text-brand-amber" />
          </div>
          <p className="text-2xl font-extrabold text-brand-text font-display">{totalPendingRequests}</p>
          <span className="text-[8px] text-brand-text-mute mt-1 font-mono uppercase">Leaves, WFH & Loans</span>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Workforce Twin & Live Operations status */}
        <div className="space-y-6 lg:col-span-2">
          
          {/* Campaign Twin */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-sm font-extrabold text-brand-text uppercase tracking-wider font-display">Campaign Twin State</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeCampaigns.map(camp => {
                const detail = campaignDetails[camp.id];
                const leadName = detail?.campaign?.teamLead || 'No Lead Assigned';
                
                // Fetch simulated states
                const sdrDiff = simCampaignSdrDiffs[camp.id] || 0;
                const showupPercentIncrease = simShowupPercentDiffs[camp.id] || 0;

                const baseShowups = detail?.stats?.showups || 0;
                const activeSdrs = (detail?.campaign?.totalSdrs || 0) + sdrDiff;
                const avgShowupPerSdr = baseShowups / (detail?.campaign?.totalSdrs || 1);

                let simulatedShowups = baseShowups + (sdrDiff * (avgShowupPerSdr || 8));
                simulatedShowups = simulatedShowups * (1 + showupPercentIncrease / 100);

                const health = getCampaignHealth(camp.id);

                return (
                  <div key={camp.id} className="p-4 rounded-xl bg-brand-bg-soft/50 border border-brand-border space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-xs font-bold text-brand-text uppercase tracking-wider">{camp.name}</h4>
                        <p className="text-[9px] text-brand-text-mute mt-0.5">Lead: {leadName}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold border ${health.color}`}>
                        {health.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-brand-text-soft border-t border-brand-border/30 pt-2.5">
                      <div>
                        <span className="block text-[8px] uppercase text-brand-text-mute">SDR size</span>
                        <strong className="text-brand-text">{activeSdrs} SDRs</strong>
                        {sdrDiff !== 0 && (
                          <span className={`text-[8px] ml-1 ${sdrDiff > 0 ? 'text-brand-green' : 'text-brand-red'}`}>
                            ({sdrDiff > 0 ? `+${sdrDiff}` : sdrDiff})
                          </span>
                        )}
                      </div>
                      <div>
                        <span className="block text-[8px] uppercase text-brand-text-mute">Monthly Showups</span>
                        <strong className="text-brand-text">{Math.round(simulatedShowups)}</strong>
                        {simMode && Math.round(simulatedShowups) !== baseShowups && (
                          <span className="text-[8px] ml-1 text-brand-green">
                            (Proj)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Attendance Trends */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-sm font-extrabold text-brand-text uppercase tracking-wider font-display">Attendance Twin Trends</h3>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={attendanceTrendData}>
                  <defs>
                    <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3e6cf6" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#3e6cf6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorLates" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f5b942" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#f5b942" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="date" stroke={strokeColor} fontSize={10} tickLine={false} />
                  <YAxis stroke={strokeColor} fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, color: tooltipColor, borderRadius: 12 }} />
                  <Legend verticalAlign="top" height={36} />
                  <Area type="monotone" dataKey="Rate" name="Attendance Rate %" stroke="#3e6cf6" strokeWidth={2} fillOpacity={1} fill="url(#colorRate)" />
                  <Area type="monotone" dataKey="Lates" name="Late Arrivals Count" stroke="#f5b942" strokeWidth={2} fillOpacity={1} fill="url(#colorLates)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            
            {/* Attendance Heatmap */}
            <div className="space-y-2 border-t border-brand-border pt-4">
              <span className="text-[10px] font-bold text-brand-text-soft uppercase tracking-widest font-display">Daily Attendance Heatmap (Last 28 Days)</span>
              <div className="grid grid-cols-7 sm:grid-cols-14 gap-2">
                {heatmapData.map((box, idx) => {
                  let color = 'bg-brand-bg-soft border-brand-border';
                  if (box.rate >= 90) color = 'bg-brand-green/20 border-brand-green/40 text-brand-green';
                  else if (box.rate >= 80) color = 'bg-brand-blue/20 border-brand-blue/40 text-brand-blue';
                  else if (box.rate >= 70) color = 'bg-brand-amber/20 border-brand-amber/40 text-brand-amber';
                  else color = 'bg-brand-red/20 border-brand-red/40 text-brand-red';

                  return (
                    <div
                      key={idx}
                      className={`h-8 w-full border rounded flex items-center justify-center text-[9px] font-mono font-bold ${color}`}
                      title={`Date: ${box.date} - Rate: ${box.rate}%`}
                    >
                      {box.rate}%
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Simulation Panel & Performance twin */}
        <div className="space-y-6">
          
          {/* Simulation Panel */}
          <div className="p-6 rounded-2xl glass-panel-strong border-brand-blue/30 space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-brand-border/40">
              <h3 className="text-sm font-extrabold text-brand-text uppercase tracking-wider font-display flex items-center gap-1.5">
                <Sliders className="w-4 h-4 text-brand-cyan" />
                Operational Simulation
              </h3>
              {simMode && (
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-brand-cyan/10 text-brand-cyan uppercase">Active</span>
              )}
            </div>

            <div className="space-y-4">
              {/* Absences Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-brand-text-soft">Simulated SDR Absences:</span>
                  <span className="font-bold text-brand-cyan">{simAbsences} SDRs</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={simAbsences}
                  onChange={(e) => {
                    setSimAbsences(Number(e.target.value));
                    setSimMode(true);
                  }}
                  className="w-full h-1 bg-brand-bg-soft rounded-lg appearance-none cursor-pointer accent-brand-cyan"
                />
              </div>

              {/* Campaign SDR adjustments */}
              <div className="space-y-3.5 pt-2">
                <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block">Add SDRs to Campaigns</span>
                {activeCampaigns.map(camp => (
                  <div key={camp.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-brand-text-soft truncate max-w-[120px]">{camp.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          const currentVal = simCampaignSdrDiffs[camp.id] || 0;
                          setSimCampaignSdrDiffs({
                            ...simCampaignSdrDiffs,
                            [camp.id]: Math.max(0, currentVal - 1)
                          });
                          setSimMode(true);
                        }}
                        className="px-2 py-0.5 border border-brand-border rounded bg-brand-bg hover:bg-brand-bg-elevated cursor-pointer"
                      >
                        -
                      </button>
                      <span className="font-mono font-bold text-brand-text w-6 text-center">{simCampaignSdrDiffs[camp.id] || 0}</span>
                      <button
                        onClick={() => {
                          const currentVal = simCampaignSdrDiffs[camp.id] || 0;
                          setSimCampaignSdrDiffs({
                            ...simCampaignSdrDiffs,
                            [camp.id]: currentVal + 1
                          });
                          setSimMode(true);
                        }}
                        className="px-2 py-0.5 border border-brand-border rounded bg-brand-bg hover:bg-brand-bg-elevated cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Showups percentage modifier */}
              <div className="space-y-3.5 pt-2">
                <span className="text-[9px] font-bold text-brand-text-mute uppercase tracking-widest block">Simulate Show-up Modifiers</span>
                {activeCampaigns.map(camp => (
                  <div key={camp.id} className="space-y-1">
                    <div className="flex justify-between text-[10px] text-brand-text-soft">
                      <span>{camp.name}:</span>
                      <span className="font-bold text-brand-green">+{simShowupPercentDiffs[camp.id] || 0}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={simShowupPercentDiffs[camp.id] || 0}
                      onChange={(e) => {
                        setSimShowupPercentDiffs({
                          ...simShowupPercentDiffs,
                          [camp.id]: Number(e.target.value)
                        });
                        setSimMode(true);
                      }}
                      className="w-full h-1 bg-brand-bg-soft rounded-lg appearance-none cursor-pointer accent-brand-green"
                    />
                  </div>
                ))}
              </div>

              {/* Expected Operational Impact report cards */}
              {simMode && (
                <div className="p-3 bg-brand-bg/40 border border-brand-border/60 rounded-xl space-y-3.5 text-xs text-left">
                  <span className="text-[9px] font-extrabold text-brand-cyan uppercase tracking-widest block border-b border-brand-border/30 pb-1.5">Projected Operational Impact</span>
                  
                  {/* Attendance Rate impact */}
                  <div className="flex justify-between">
                    <span className="text-brand-text-soft">Attendance Rate:</span>
                    <span className={`font-mono font-bold ${projectedAttendanceRate < normalAttendanceRate ? 'text-brand-red' : 'text-brand-green'}`}>
                      {normalAttendanceRate.toFixed(1)}% ➡️ {projectedAttendanceRate.toFixed(1)}%
                    </span>
                  </div>

                  {/* Commissions change */}
                  <div className="flex justify-between">
                    <span className="text-brand-text-soft">Total Commissions:</span>
                    <span className={`font-mono font-bold ${projectedTotalCommissions > liveTotalCommissions ? 'text-brand-green' : 'text-brand-text'}`}>
                      PKR {Math.round(liveTotalCommissions).toLocaleString()} ➡️ PKR {Math.round(projectedTotalCommissions).toLocaleString()}
                    </span>
                  </div>

                  {/* Salary Deductions impact */}
                  {estimatedAbsenceDeductions > 0 && (
                    <div className="flex justify-between">
                      <span className="text-brand-text-soft">Absence Deductions:</span>
                      <span className="font-mono font-bold text-brand-amber">
                        + PKR {Math.round(estimatedAbsenceDeductions).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {simMode && (
                <button
                  onClick={resetSimulation}
                  className="w-full py-2 bg-brand-bg-elevated border border-brand-border rounded-full hover:border-brand-blue-soft transition-all text-xs font-bold text-brand-text uppercase cursor-pointer"
                >
                  Reset Simulation
                </button>
              )}
            </div>
          </div>

          {/* Performance Twin: Leaders & Rankings */}
          <div className="p-6 rounded-2xl glass-panel space-y-4">
            <h3 className="text-sm font-extrabold text-brand-text uppercase tracking-wider font-display">Performance Twin</h3>
            
            {/* Top performing indicators */}
            <div className="p-3 bg-brand-bg-soft/40 border border-brand-border rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Top Campaign:</span>
                <span className="font-bold text-brand-text">{topPerformingCampaign}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-brand-text-soft">Top Team Lead:</span>
                <span className="font-bold text-brand-cyan">{topPerformingTeam}</span>
              </div>
            </div>

            {/* Top SDR Leaderboard list */}
            <div className="space-y-3 pt-2">
              <span className="text-[10px] font-bold text-brand-text-soft uppercase tracking-widest font-display">Top Performing SDRs (Show-ups)</span>
              <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                {topSDRs.map((sdr, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs p-2 bg-brand-bg-soft/20 border border-brand-border rounded-lg">
                    <div className="min-w-0">
                      <p className="font-bold text-brand-text truncate">{sdr.fullName}</p>
                      <p className="text-[8px] text-brand-text-mute uppercase">{sdr.campaignName}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-bold text-brand-green">{sdr.showups} show-ups</span>
                    </div>
                  </div>
                ))}
                {topSDRs.length === 0 && (
                  <p className="text-xs text-brand-text-mute italic">No performance logs recorded yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Grid: Workforce status pie chart & campaign metrics compare */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Workforce Status Distribution Pie Chart */}
        <div className="p-6 rounded-2xl glass-panel space-y-4">
          <h3 className="text-sm font-extrabold text-brand-text uppercase tracking-wider font-display">Workforce Distribution</h3>
          <div className="h-64 w-full flex justify-center items-center">
            {workforcePieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={workforcePieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {workforcePieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, color: tooltipColor, borderRadius: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-brand-text-mute italic">No attendance data collected today</p>
            )}
          </div>
        </div>

        {/* Campaign Showups Comparison Bar Chart */}
        <div className="p-6 rounded-2xl glass-panel space-y-4">
          <h3 className="text-sm font-extrabold text-brand-text uppercase tracking-wider font-display">Campaign Show-ups Comparison</h3>
          <div className="h-64 w-full">
            {campaignPerformanceData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={campaignPerformanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="name" stroke={strokeColor} fontSize={10} tickLine={false} />
                  <YAxis stroke={strokeColor} fontSize={10} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderColor: tooltipBorder, color: tooltipColor, borderRadius: 12 }} />
                  <Legend verticalAlign="top" height={36} />
                  <Bar dataKey="Live Show-ups" fill="#3e6cf6" radius={[4, 4, 0, 0]} />
                  {simMode && <Bar dataKey="Projected Show-ups" fill="#34d399" radius={[4, 4, 0, 0]} />}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-brand-text-mute italic">No active campaign performance data</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
