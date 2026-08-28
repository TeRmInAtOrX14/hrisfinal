import React from 'react';
import { motion } from 'framer-motion';
import { Users, Briefcase, CalendarCheck, TrendingUp, CheckCircle, HelpCircle, UserCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AdminDashboard({ stats, campaigns = [] }) {

  return (
    <motion.div
      className="space-y-6"
      variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } }}
      initial="hidden"
      animate="show"
    >
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total Headcount */}
        <div className="p-6 rounded-2xl glass-panel hover-glow-blue text-left relative overflow-hidden border border-brand-border/40">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-brand-text-soft uppercase tracking-widest font-display">Total Headcount</span>
            <Users className="w-5 h-5 text-brand-blue" />
          </div>
          <p className="text-3xl font-extrabold text-white font-display">{stats?.totalEmployees || 0}</p>
          <p className="text-[9px] text-brand-text-mute mt-2 font-bold">Active synced biometric profiles</p>
        </div>

        {/* Active Campaigns */}
        <div className="p-6 rounded-2xl glass-panel hover-glow-violet text-left relative overflow-hidden border border-brand-border/40">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-brand-text-soft uppercase tracking-widest font-display">Active Campaigns</span>
            <Briefcase className="w-5 h-5 text-brand-violet" />
          </div>
          <p className="text-3xl font-extrabold text-white font-display">{stats?.activeProjects || 0}</p>
          <p className="text-[9px] text-brand-text-mute mt-2 font-bold">Tiered showup structures running</p>
        </div>

        {/* Present Today */}
        <div className="p-6 rounded-2xl glass-panel hover-glow-green text-left relative overflow-hidden border border-brand-border/40">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-brand-text-soft uppercase tracking-widest font-display">Present Today</span>
            <UserCheck className="w-5 h-5 text-brand-green" />
          </div>
          <p className="text-3xl font-extrabold text-brand-green font-display">{stats?.presentToday || 0}</p>
          <p className="text-[9px] text-brand-text-mute mt-2 font-bold">ZKTeco machine synced logs</p>
        </div>

        {/* Lates Today */}
        <div className="p-6 rounded-2xl glass-panel hover-glow-amber text-left relative overflow-hidden border border-brand-border/40">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-bold text-brand-text-soft uppercase tracking-widest font-display">Late Arrivals Today</span>
            <CalendarCheck className="w-5 h-5 text-brand-amber" />
          </div>
          <p className="text-3xl font-extrabold text-brand-amber font-display">{stats?.lateToday || 0}</p>
          <p className="text-[9px] text-brand-text-mute mt-2 font-bold">Triggered penalty deductions</p>
        </div>
      </div>

      {/* Active Campaigns Tracking Section */}
      <section className="p-6 rounded-2xl glass-panel border border-brand-border/40 text-left space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-brand-border/40">
          <h2 className="text-sm font-extrabold text-white uppercase font-display flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-cyan" />
            Active Campaigns Progress
          </h2>
          <Link to="/dashboard/campaigns" className="text-[10px] font-bold text-brand-cyan hover:underline uppercase">Manage Campaigns</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {campaigns.map(camp => {
            const lead = camp.members.find(m => m.role === 'team_lead');
            const sdrs = camp.members.filter(m => m.role === 'sdr');
            return (
              <div key={camp.id} className="p-4 rounded-xl bg-brand-bg/40 border border-brand-border flex flex-col justify-between space-y-3">
                <div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">{camp.name}</h3>
                  <p className="text-[11px] text-brand-text-soft mt-1 leading-relaxed line-clamp-2">{camp.description || 'No description.'}</p>
                </div>

                <div className="flex justify-between text-[10px] text-brand-text-mute font-mono">
                  <span>Lead: <strong className="text-white font-sans">{lead?.employee?.fullName || 'Unassigned'}</strong></span>
                  <span>SDR Size: <strong className="text-white font-sans">{sdrs.length}</strong></span>
                </div>
              </div>
            );
          })}

          {campaigns.length === 0 && (
            <p className="col-span-full py-6 text-center text-brand-text-soft italic text-xs">No active campaigns running currently.</p>
          )}
        </div>
      </section>
    </motion.div>
  );
}
