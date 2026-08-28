import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Users,
  Network,
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
  ChevronRight,
  Cpu,
  Sun,
  Moon,
  PhoneCall,
  KeyRound,
} from 'lucide-react';
import toast from 'react-hot-toast';

import api, { session, apiError } from '../utils/api';
import { useTheme } from '../utils/themeContext';
import { openBrandigadeDialer } from '../utils/openDialer';
import { ADMIN_ROLES, ALL_ROLES, TEAM_LEAD } from '../utils/roles';

const NOTIFICATION_POLL_MS = 60_000;

const NAV_LINKS = [
  { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ALL_ROLES, end: true },
  // Employee and SDR are treated identically by the API (self only), but the
  // sidebar used to show this to Employee and hide it from SDR.
  { label: 'Employees', path: '/dashboard/employees', icon: Users, roles: ALL_ROLES },
  { label: 'Org Chart', path: '/dashboard/org-chart', icon: Network, roles: ALL_ROLES },
  { label: 'Attendance', path: '/dashboard/attendance', icon: CalendarCheck, roles: ALL_ROLES },
  { label: 'Requests', path: '/dashboard/requests', icon: FileSpreadsheet, roles: ALL_ROLES },
  { label: 'Loans & Advances', path: '/dashboard/loans', icon: PiggyBank, roles: ALL_ROLES },
  { label: 'Payroll & Payslips', path: '/dashboard/payroll', icon: FileText, roles: ALL_ROLES },
  { label: 'Campaigns', path: '/dashboard/campaigns', icon: Briefcase, roles: ADMIN_ROLES },
  { label: 'Digital Twin', path: '/dashboard/digital-twin', icon: Cpu, roles: ADMIN_ROLES },
  { label: 'Audit Trail', path: '/dashboard/audit', icon: ShieldAlert, roles: ADMIN_ROLES },
];

export default function DashboardLayout() {
  const { isDark, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();
  const notifRef = useRef(null);

  const currentUser = session.user || { email: '', role: 'Employee' };
  const displayName = currentUser.employee?.fullName || currentUser.email?.split('@')[0] || 'User';

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(collapsed));
  }, [collapsed]);

  const fetchNotifications = useCallback(async () => {
    try {
      setNotifLoading(true);
      const res = await api.get('/system/notifications');
      setNotifications(res.data.notifications || []);
      setUnreadCount(res.data.unreadCount || 0);
    } catch {
      // A transient polling failure should not throw a toast every minute.
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, NOTIFICATION_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close the notification popover on Escape as well as on outside click.
  useEffect(() => {
    if (!notifOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setNotifOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notifOpen]);

  const markAllAsRead = async () => {
    const previous = notifications;
    const previousCount = unreadCount;
    setNotifications((ns) => ns.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);

    try {
      await api.put('/system/notifications/read-all');
    } catch (err) {
      setNotifications(previous);
      setUnreadCount(previousCount);
      toast.error(apiError(err, 'Could not update notifications.'));
    }
  };

  const openNotification = async (notification) => {
    if (!notification.isRead) {
      setNotifications((ns) =>
        ns.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      api.put(`/system/notifications/${notification.id}/read`).catch(() => {});
    }
    if (notification.link) {
      setNotifOpen(false);
      navigate(notification.link);
    }
  };

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Offline or already-expired session: still clear locally.
    }
    // Targeted clear, so the user's theme choice survives sign-out.
    session.clear();
    toast.success('Signed out');
    navigate('/login', { replace: true });
  };

  const visibleLinks = NAV_LINKS.filter((link) => link.roles.includes(currentUser.role));

  const isActive = (link) =>
    link.end ? location.pathname === link.path : location.pathname.startsWith(link.path);

  const renderLinks = (onNavigate) =>
    visibleLinks.map((link) => {
      const Icon = link.icon;
      const active = isActive(link);
      return (
        <Link
          key={link.path}
          to={link.path}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? link.label : undefined}
          className={`flex items-center gap-3.5 rounded-full text-xs font-bold font-display uppercase tracking-wider transition-all duration-300 ${
            collapsed ? 'justify-center p-3' : 'px-4 py-3'
          } ${
            active
              ? 'brandigade-gradient text-white shadow-lg shadow-brand-blue/20'
              : 'text-brand-text-soft hover:text-brand-text hover:bg-brand-bg-elevated'
          }`}
        >
          <Icon className="w-4 h-4 shrink-0" />
          {!collapsed && <span className="truncate">{link.label}</span>}
        </Link>
      );
    });

  const userCard = (isCollapsed) => (
    <div className="p-4 border-t border-brand-border bg-brand-bg-elevated/40">
      <div className={`flex items-center gap-3 mb-3 ${isCollapsed ? 'justify-center' : 'px-2'}`}>
        <div className="w-8 h-8 rounded-full bg-brand-blue/10 flex items-center justify-center border border-brand-blue/20 shrink-0">
          <User className="w-4 h-4 text-brand-cyan" />
        </div>
        {!isCollapsed && (
          <div className="min-w-0 text-left flex-1">
            <p className="text-xs font-bold text-brand-text truncate font-display">{displayName}</p>
            <p className="text-[9px] text-brand-text-mute uppercase tracking-widest font-extrabold">
              {currentUser.role}
            </p>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <Link
          to="/change-password"
          className="w-full flex items-center justify-center gap-2 py-2 px-3 mb-2 rounded-full border border-brand-border text-[10px] uppercase tracking-wider font-extrabold text-brand-text-soft hover:text-brand-text hover:border-brand-blue/40 transition-all duration-300"
        >
          <KeyRound className="w-3.5 h-3.5" />
          Change Password
        </Link>
      )}

      <button
        onClick={handleLogout}
        title="Sign out"
        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-full border border-brand-border text-[10px] uppercase tracking-wider font-extrabold text-brand-text-soft hover:text-brand-text hover:border-brand-blue/40 hover:bg-brand-blue/5 transition-all duration-300 cursor-pointer"
      >
        <LogOut className="w-3.5 h-3.5" />
        {!isCollapsed && <span>Sign Out</span>}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-brand-bg flex relative overflow-hidden font-sans text-brand-text">
      <div className="glow-field opacity-40">
        <span className="g1" />
        <span className="g2" />
      </div>
      <div className="noise-grid absolute inset-0 z-0 pointer-events-none" />

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-brand-bg-soft border-r border-brand-border shrink-0 z-10 transition-all duration-300 ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        <div className="h-20 flex items-center justify-between px-5 border-b border-brand-border overflow-hidden">
          {!collapsed ? (
            <>
              <Link to="/dashboard" className="flex items-center gap-2 min-w-0">
                <img src="/logo.png" alt="Brandigade" className="h-8 w-auto object-contain shrink-0" />
                <span className="px-1 py-0.5 text-[7px] font-extrabold uppercase bg-brand-blue text-white rounded shrink-0">
                  HRIS
                </span>
              </Link>
              <button
                onClick={() => setCollapsed(true)}
                className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue/35 transition-colors cursor-pointer shrink-0"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <Menu className="w-4 h-4" />
              </button>
            </>
          ) : (
            <div className="flex justify-center w-full">
              <img src="/favicon.png" alt="Brandigade" className="h-8 w-8 object-contain" />
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
          {collapsed && (
            <div className="flex justify-center mb-4">
              <button
                onClick={() => setCollapsed(false)}
                className="p-2 rounded-full border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue/35 transition-colors cursor-pointer"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
          {renderLinks()}
        </nav>

        {userCard(collapsed)}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black z-40 lg:hidden"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 260 }}
              className="fixed top-0 bottom-0 left-0 w-64 bg-brand-bg-soft border-r border-brand-border z-50 lg:hidden flex flex-col"
            >
              <div className="h-20 flex items-center justify-between px-6 border-b border-brand-border">
                <div className="flex items-center gap-2">
                  <img src="/logo.png" alt="Brandigade" className="h-10 w-auto object-contain" />
                  <span className="px-1 py-0.5 text-[7px] font-extrabold uppercase bg-brand-blue text-white rounded">
                    HRIS
                  </span>
                </div>
                <button onClick={() => setSidebarOpen(false)} aria-label="Close menu">
                  <X className="w-5 h-5 text-brand-text-soft" />
                </button>
              </div>

              <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
                {renderLinks(() => setSidebarOpen(false))}
              </nav>

              {userCard(false)}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen z-10">
        <header className="h-16 border-b border-brand-border bg-brand-bg/60 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 z-30 shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {collapsed && (
              <button
                onClick={() => setCollapsed(false)}
                className="hidden lg:block p-2 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue/35 transition-colors cursor-pointer"
                title="Expand sidebar"
                aria-label="Expand sidebar"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={openBrandigadeDialer}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl brandigade-gradient text-white text-xs font-bold font-display uppercase tracking-wider shadow-lg hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer"
              title="Launch Brandigade Dialer"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Dialer</span>
            </button>

            <button
              onClick={toggleTheme}
              className="p-2.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-border-strong transition-all duration-300 cursor-pointer flex items-center justify-center hover:scale-105 active:scale-95"
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {isDark ? <Sun className="w-4 h-4 text-brand-amber" /> : <Moon className="w-4 h-4 text-brand-blue" />}
            </button>

            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setNotifOpen((o) => !o)}
                className="relative p-2.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-border-strong transition-colors cursor-pointer"
                aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand-red text-white text-[9px] font-bold flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.97 }}
                      className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] bg-brand-bg-elevated border border-brand-border rounded-2xl p-4 shadow-glow z-50 text-left"
                    >
                      <div className="flex items-center justify-between mb-3 border-b border-brand-border pb-2.5">
                        <h4 className="text-[10px] font-bold text-brand-text uppercase tracking-widest font-display">
                          Notifications
                        </h4>
                        {unreadCount > 0 && (
                          <button
                            onClick={markAllAsRead}
                            className="text-[10px] font-bold text-brand-blue hover:underline cursor-pointer"
                          >
                            Mark all read
                          </button>
                        )}
                      </div>

                      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                        {notifLoading && notifications.length === 0 ? (
                          <div className="flex justify-center py-6">
                            <Loader2 className="w-4 h-4 animate-spin text-brand-text-mute" />
                          </div>
                        ) : notifications.length === 0 ? (
                          <p className="text-xs text-brand-text-mute text-center py-6">
                            You&apos;re all caught up
                          </p>
                        ) : (
                          notifications.map((n) => (
                            <button
                              key={n.id}
                              onClick={() => openNotification(n)}
                              className={`w-full p-2.5 rounded-xl border text-left transition-colors cursor-pointer hover:border-brand-border-strong ${
                                n.isRead
                                  ? 'border-brand-border bg-brand-bg-soft/40'
                                  : 'border-brand-blue/25 bg-brand-blue/5'
                              }`}
                            >
                              <p className="text-xs font-bold text-brand-text">{n.title}</p>
                              <p className="text-[11px] text-brand-text-soft mt-1 leading-normal">
                                {n.message}
                              </p>
                              <p className="text-[9px] text-brand-text-mute mt-1.5 font-mono">
                                {new Date(n.createdAt).toLocaleString('en-GB', {
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </p>
                            </button>
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

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-brand-bg">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export { TEAM_LEAD };
