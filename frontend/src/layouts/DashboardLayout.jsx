import React, { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  FileSpreadsheet,
  Briefcase,
  PiggyBank,
  Bell,
  LogOut,
  Menu,
  X,
  User,
  ShieldAlert,
  Loader2,
  FileText,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Sun,
  Moon,
  PhoneCall
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useTheme } from '../utils/themeContext';
import { openBrandigadeDialer } from '../utils/openDialer';

export default function DashboardLayout() {
  const { theme, isDark, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const userString = localStorage.getItem('user');
  const currentUser = userString ? JSON.parse(userString) : { email: 'User', role: 'Employee' };

  // Fetch Notifications
  const fetchNotifications = async () => {
    try {
      setNotifLoading(true);
      const res = await api.get('/system/notifications');
      setNotifications(res.data);
    } catch (err) {
      console.error('Failed to load notifications');
    } finally {
      setNotifLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 45000);
    return () => clearInterval(interval);
  }, []);

  const markAllAsRead = async () => {
    try {
      await api.put('/system/notifications/read-all');
      setNotifications(notifications.map(n => ({ ...n, isRead: true })));
      toast.success('Marked all as read');
    } catch (err) {
      toast.error('Failed to update notifications');
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout', { userId: currentUser.id });
    } catch (e) {
      console.warn('Backend logout failed or offline');
    }
    localStorage.clear();
    toast.success('Logged out successfully');
    navigate('/login');
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const links = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['Admin', 'CEO', 'COO', 'Team Lead', 'Employee', 'SDR'] },
    { label: 'Employees', path: '/dashboard/employees', icon: Users, roles: ['Admin', 'CEO', 'COO', 'Team Lead', 'Employee'] },
    { label: 'Attendance', path: '/dashboard/attendance', icon: CalendarCheck, roles: ['Admin', 'CEO', 'COO', 'Team Lead', 'Employee', 'SDR'] },
    { label: 'Requests', path: '/dashboard/requests', icon: FileSpreadsheet, roles: ['Admin', 'CEO', 'COO', 'Team Lead', 'Employee', 'SDR'] },
    { label: 'Campaigns', path: '/dashboard/campaigns', icon: Briefcase, roles: ['Admin', 'CEO', 'COO'] },
    { label: 'Loans & Advances', path: '/dashboard/loans', icon: PiggyBank, roles: ['Admin', 'CEO', 'COO', 'Team Lead', 'Employee', 'SDR'] },
    { label: 'Payroll & Payslips', path: '/dashboard/payroll', icon: FileText, roles: ['Admin', 'CEO', 'COO', 'Team Lead', 'Employee', 'SDR'] },
    { label: 'Digital Twin', path: '/dashboard/digital-twin', icon: Cpu, roles: ['Admin', 'CEO', 'COO'] },
    { label: 'Audit Trail', path: '/dashboard/audit', icon: ShieldAlert, roles: ['Admin', 'CEO', 'COO'] }
  ];

  const visibleLinks = links.filter(link => link.roles.includes(currentUser.role));

  return (
    <div className="min-h-screen bg-brand-bg flex relative overflow-hidden font-sans text-brand-text">
      {/* Background atmosphere glows matching brandigade.com */}
      <div className="glow-field opacity-40">
        <span className="g1" />
        <span className="g2" />
      </div>
      
      {/* Noise Grid overlay */}
      <div className="noise-grid absolute inset-0 z-0 pointer-events-none" />

      {/* ---------------- Sidebar (Desktop) ---------------- */}
      <aside
        className={`hidden lg:flex flex-col bg-brand-bg-soft border-r border-brand-border shrink-0 z-10 transition-all duration-300 ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {/* Sidebar Header Container */}
        <div className="h-20 flex items-center justify-between px-5 border-b border-brand-border overflow-hidden">
          {!collapsed ? (
            <div className="flex items-center gap-2 min-w-0">
              <img src="/logo.png" alt="Brandigade logo" className="h-8 w-auto object-contain shrink-0" />
              <span className="px-1 py-0.5 text-[7px] font-extrabold uppercase bg-brand-blue text-white rounded shrink-0">
                HRIS
              </span>
            </div>
          ) : (
            <div className="flex justify-center w-full">
              <img src="/favicon.png" alt="Brandigade favicon" className="h-8 w-8 object-contain" />
            </div>
          )}

          {/* Collapsible Trigger button (Three lines or Dot) */}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-white hover:border-brand-blue/35 transition-colors cursor-pointer shrink-0"
              title="Collapse Sidebar"
            >
              <Menu className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Links Navigation */}
        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {collapsed && (
            <div className="flex justify-center mb-4">
              <button
                onClick={() => setCollapsed(false)}
                className="p-2 rounded-full border border-brand-border text-brand-text-soft hover:text-white hover:border-brand-blue/35 transition-colors cursor-pointer"
                title="Expand Sidebar"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {visibleLinks.map(link => {
            const Icon = link.icon;
            const active = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`flex items-center gap-3.5 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-300 ${
                  collapsed ? 'justify-center p-3' : 'px-4 py-3'
                } ${
                  active
                    ? 'bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg shadow-lg shadow-brand-blue/20'
                    : 'text-brand-text-soft hover:text-brand-text hover:bg-brand-bg-elevated'
                }`}
                title={collapsed ? link.label : ''}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User Card & Logout */}
        <div className="p-4 border-t border-brand-border bg-brand-bg-elevated/40">
          <div className={`flex items-center gap-3 mb-3 ${collapsed ? 'justify-center' : 'px-2'}`}>
            <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center border border-brand-blue/20 shrink-0">
              <User className="w-4 h-4 text-brand-cyan" />
            </div>
            {!collapsed && (
              <div className="min-w-0 text-left">
                <p className="text-xs font-bold text-white truncate font-display">{currentUser.email.split('@')[0]}</p>
                <p className="text-[9px] text-brand-text-mute uppercase tracking-widest font-extrabold">{currentUser.role}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-full border border-brand-border text-[10px] uppercase tracking-wider font-extrabold text-brand-text-soft hover:text-white hover:border-brand-blue/40 hover:bg-brand-blue/5 transition-all duration-300 cursor-pointer ${
              collapsed ? 'p-2' : ''
            }`}
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* ---------------- Sidebar (Mobile Drawer) ---------------- */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/80 z-45 lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed top-0 bottom-0 left-0 w-64 bg-brand-bg-soft border-r border-brand-border z-50 lg:hidden flex flex-col"
            >
              <div className="h-20 flex items-center justify-between px-6 border-b border-brand-border">
                <div className="flex items-center gap-2">
                  <img src="/logo.png" alt="Brandigade logo" className="h-12 w-auto object-contain" />
                  <span className="px-1 py-0.5 text-[7px] font-extrabold uppercase bg-brand-blue text-white rounded">HRIS</span>
                </div>
                <button onClick={() => setSidebarOpen(false)}>
                  <X className="w-5 h-5 text-brand-text-soft" />
                </button>
              </div>

              <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
                {visibleLinks.map(link => {
                  const Icon = link.icon;
                  const active = location.pathname === link.path;
                  return (
                    <Link
                      key={link.path}
                      to={link.path}
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-3.5 px-4 py-3 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-300 ${
                        active
                          ? 'bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg'
                          : 'text-brand-text-soft hover:text-brand-text hover:bg-brand-bg-elevated'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      {link.label}
                    </Link>
                  );
                })}
              </nav>

              <div className="p-4 border-t border-brand-border bg-brand-bg-elevated/40">
                <div className="flex items-center gap-3 px-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center border border-brand-blue/20">
                    <User className="w-4 h-4 text-brand-cyan" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-xs font-bold text-white truncate font-display">{currentUser.email}</p>
                    <p className="text-[9px] text-brand-text-mute uppercase tracking-widest font-extrabold">{currentUser.role}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-full border border-brand-border text-[10px] uppercase tracking-wider font-extrabold text-brand-text-soft hover:text-white hover:border-brand-blue/40 hover:bg-brand-blue/5 transition-all duration-300 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign Out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ---------------- Main Content Area ---------------- */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen z-10">
        {/* Header */}
        <header className="h-16 border-b border-brand-border bg-brand-bg/40 backdrop-blur-md flex items-center justify-between px-6 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-brand-border text-brand-text-soft hover:text-white"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Desktop toggle: Show hamburger button in top header if collapsed to let user expand it */}
            {collapsed && (
              <button
                onClick={() => setCollapsed(false)}
                className="hidden lg:block p-2 rounded-xl border border-brand-border text-brand-text-soft hover:text-white hover:border-brand-blue/35 transition-colors cursor-pointer"
                title="Expand Sidebar"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-4 relative">
            {/* Brandigade Dialer Button */}
            <button
              onClick={openBrandigadeDialer}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg text-xs font-bold font-display uppercase tracking-wider shadow-lg hover:shadow-cyan-500/20 hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer border border-brand-cyan/30"
              title="Launch Brandigade Dialer (App / Browser: dialer.brandigade.com)"
            >
              <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
              <span className="hidden sm:inline">Brandigade Dialer</span>
            </button>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="p-2.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-white hover:border-brand-border-strong transition-all duration-300 cursor-pointer flex items-center justify-center hover:scale-105 active:scale-95 bg-transparent"
              aria-label="Toggle Theme"
            >
              {isDark ? (
                <Sun className="w-4 h-4 text-brand-amber animate-pulse" />
              ) : (
                <Moon className="w-4 h-4 text-brand-blue" />
              )}
            </button>

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => setNotifOpen(!notifOpen)}
                className="p-2.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-white hover:border-brand-border-strong transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand-cyan rounded-full animate-pulse" />
                )}
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-80 bg-brand-bg-elevated border border-brand-border rounded-2xl p-4 shadow-glow z-50 text-left"
                    >
                      <div className="flex items-center justify-between mb-4 border-b border-brand-border pb-2.5">
                        <h4 className="text-[10px] font-bold text-white uppercase tracking-widest font-display">Notifications</h4>
                        {unreadCount > 0 && (
                          <button
                            onClick={markAllAsRead}
                            className="text-[10px] font-bold text-brand-cyan hover:underline cursor-pointer"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>

                      <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                        {notifLoading && notifications.length === 0 ? (
                          <div className="flex justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-brand-text-mute" />
                          </div>
                        ) : notifications.length === 0 ? (
                          <p className="text-xs text-brand-text-mute text-center py-4">No notifications yet</p>
                        ) : (
                          notifications.map(n => (
                            <div
                              key={n.id}
                              className={`p-2.5 rounded-xl border text-left transition-colors ${
                                n.isRead ? 'border-brand-border bg-brand-bg-soft/40' : 'border-brand-blue/20 bg-brand-blue/5'
                              }`}
                            >
                              <p className="text-xs font-bold text-white">{n.title}</p>
                              <p className="text-[11px] text-brand-text-soft mt-1 leading-normal">{n.message}</p>
                              <p className="text-[9px] text-brand-text-mute mt-1.5 font-mono">
                                {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Dynamic Nested Content */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-brand-bg">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
