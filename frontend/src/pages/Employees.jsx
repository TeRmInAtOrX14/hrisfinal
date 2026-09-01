import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import {
  Search,
  Plus,
  X,
  Eye,
  Trash2,
  Loader2,
  Clock,
  Pencil,
  KeyRound,
  Copy
} from 'lucide-react';
import api, { session, apiError } from '../utils/api';
import toast from 'react-hot-toast';
import { isAdmin as isAdminRole } from '../utils/roles';
import { money, longDate } from '../utils/format';

/** Debounce a fast-changing value so typing does not fire a request per keystroke. */
function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const getTeamPlaceholder = (emp) => {
  const role = emp.user?.role;
  const designation = (emp.designation || '').toLowerCase();
  if (['Admin', 'CEO', 'COO'].includes(role)) {
    return 'Management';
  }
  if (designation.includes('office') || designation.includes('boy') || designation.includes('support') || designation.includes('helper') || designation.includes('cleaner') || designation.includes('peon')) {
    return 'Support Staff';
  }
  return 'General Operations';
};

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering states
  const [search, setSearch] = useState('');
  const [selectedTeam, setSelectedTeam] = useState('');
  
  // Modals
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [detailEmployee, setDetailEmployee] = useState(null);
  // { email, password } from a reset — shown exactly once, never refetchable.
  const [resetResult, setResetResult] = useState(null);
  const [resetting, setResetting] = useState(false);

  const currentUser = session.user || { role: 'Employee' };
  const isAdmin = isAdminRole(currentUser);
  const debouncedSearch = useDebounced(search);

  const addForm = useForm({
    defaultValues: {
      shiftStart: '09:30',
      shiftEnd: '18:30',
      graceMinutes: 15,
      role: 'Employee'
    }
  });
  const { register, handleSubmit, reset, formState: { errors } } = addForm;

  const editForm = useForm();
  const {
    register: registerEdit,
    handleSubmit: handleSubmitEdit,
    reset: resetEdit,
    formState: { errors: errorsEdit },
  } = editForm;

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);

  const handleEditClick = (emp) => {
    setEditingEmployee(emp);
    
    resetEdit({
      email: emp.user?.email || '',
      role: emp.user?.role || 'Employee',
      isActive: emp.user?.isActive !== false,
      employeeCode: emp.employeeCode || '',
      fullName: emp.fullName || '',
      designation: emp.designation || '',
      teamIds: emp.campaignMembers?.map(m => m.campaign.id) || [],
      baseSalary: emp.baseSalary || 0,
      zkUserId: emp.zkUserId || '',
      shiftStart: emp.shiftStart || '09:30',
      shiftEnd: emp.shiftEnd || '18:30',
      graceMinutes: emp.graceMinutes !== undefined ? emp.graceMinutes : 15,
      phone: emp.phone || '',
      emergencyContact: emp.emergencyContact || '',
      birthday: emp.birthday || '',
      status: emp.status || 'active',
      salaryChangeReason: '',
      salaryChangeEffectiveDate: new Date().toISOString().substring(0, 10)
    });
    setEditModalOpen(true);
  };

  const handleEditEmployee = async (data) => {
    try {
      await api.put(`/employees/${editingEmployee.id}`, data);
      toast.success('Employee updated successfully!');
      setEditModalOpen(false);
      setEditingEmployee(null);
      fetchEmployees();
      if (detailEmployee && detailEmployee.id === editingEmployee.id) {
        const res = await api.get(`/employees/${editingEmployee.id}`);
        setDetailEmployee(res.data);
      }
    } catch (err) {
      toast.error(apiError(err, 'Failed to update employee.'));
    }
  };

  const fetchEmployees = async () => {
    try {
      setLoading(true);
      // The API filters on `campaignId`; this sent `teamId`, so the Team
      // dropdown silently did nothing. Values are encoded too, so an ampersand
      // or hash in a search term no longer corrupts the query string.
      const params = new URLSearchParams();
      if (selectedTeam) params.set('campaignId', selectedTeam);
      if (debouncedSearch) params.set('search', debouncedSearch);

      const res = await api.get(`/employees?${params}`);
      setEmployees(res.data);
    } catch (e) {
      toast.error(apiError(e, 'Failed to load the employee directory.'));
    } finally {
      setLoading(false);
    }
  };

  const fetchFilters = async () => {
    try {
      const tms = await api.get('/employees/teams');
      setTeams(tms.data);
    } catch (err) {
      console.error('Failed to load campaign filter options:', apiError(err));
    }
  };

  useEffect(() => {
    fetchEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeam, debouncedSearch]);

  useEffect(() => {
    fetchFilters();
  }, []);

  const handleAddEmployee = async (data) => {
    try {
      await api.post('/employees', data);
      toast.success('Employee created successfully!');
      setAddModalOpen(false);
      reset();
      fetchEmployees();
    } catch (err) {
      toast.error(apiError(err, 'Failed to create employee.'));
    }
  };

  const handleTerminate = async (id) => {
    if (confirm('Are you sure you want to terminate this employee? This will deactivate their user login and send them a termination email.')) {
      try {
        await api.post(`/employees/${id}/terminate`);
        toast.success('Employee terminated successfully. Email sent.');
        setDetailEmployee(null);
        fetchEmployees();
      } catch (e) {
        toast.error(apiError(e, 'Termination failed.'));
      }
    }
  };

  const handleResetPassword = async (emp) => {
    if (!confirm(`Reset the password for ${emp.fullName}? Their current password and active sessions stop working immediately, and a new one-time password is shown to you exactly once.`)) {
      return;
    }
    try {
      setResetting(true);
      const res = await api.post(`/employees/${emp.id}/reset-password`);
      setResetResult({ fullName: emp.fullName, email: res.data.email, password: res.data.password });
    } catch (e) {
      toast.error(apiError(e, 'Password reset failed.'));
    } finally {
      setResetting(false);
    }
  };

  const copyResetPassword = async () => {
    try {
      await navigator.clipboard.writeText(resetResult.password);
      toast.success('Password copied to clipboard.');
    } catch {
      toast.error('Could not copy — select the password and copy it manually.');
    }
  };

  const handleDeleteEmployee = async (id) => {
    if (confirm('WARNING: Are you absolutely sure you want to delete this employee? This will permanently delete their profile, user credentials, attendance history, payslips, leaves, loans, and EVERYTHING else. This action CANNOT be undone.')) {
      try {
        await api.delete(`/employees/${id}`);
        toast.success('Employee and all records deleted permanently');
        setDetailEmployee(null);
        fetchEmployees();
      } catch (e) {
        toast.error(apiError(e, 'Failed to delete the employee record.'));
      }
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Title Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase">Employee Directory</h2>
          <p className="text-xs text-brand-text-soft mt-1">Manage personnel registry, team mapping, and shift timing properties.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setAddModalOpen(true)}
            className="px-5 py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg hover:scale-[1.02] active:scale-[0.98] font-bold font-display text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-blue/20"
          >
            <Plus className="w-4 h-4" />
            Add Employee
          </button>
        )}
      </div>

      {/* Filter Widgets */}
      <div className="p-4 rounded-2xl border border-brand-border bg-brand-bg-soft/40 flex flex-col md:flex-row gap-4 items-center">
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-mute" />
          <input
            type="text"
            placeholder="Search by name, code or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-brand-border bg-brand-bg/40 text-xs text-brand-text focus:outline-none focus:border-brand-blue transition-colors"
          />
        </div>

        {/* Team Filter */}
        <div className="relative w-full md:w-48">
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-brand-border bg-brand-bg/40 text-xs text-brand-text focus:outline-none focus:border-brand-blue appearance-none cursor-pointer"
          >
            <option value="">All Teams</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Directory Table */}
      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
        </div>
      ) : employees.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-brand-border rounded-2xl">
          <p className="text-xs text-brand-text-soft">No employee records found matching criteria</p>
        </div>
      ) : (
        <div className="border border-brand-border rounded-2xl bg-brand-bg-soft/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg-elevated/40 text-[9px] uppercase font-extrabold tracking-widest text-brand-text-soft">
                  <th className="p-4">Employee Code</th>
                  <th className="p-4">Full Name</th>
                  <th className="p-4">Designation</th>
                  <th className="p-4">Team</th>
                  <th className="p-4">Bank Account</th>
                  <th className="p-4">Shift Timings</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border text-xs text-brand-text-soft">
                {employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-brand-bg-elevated/20 transition-colors">
                    <td className="p-4 font-mono text-brand-blue font-bold">{emp.employeeCode}</td>
                    <td className="p-4 font-bold text-brand-text">{emp.fullName}</td>
                    <td className="p-4 text-brand-text-soft">{emp.designation}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {emp.campaignMembers && emp.campaignMembers.length > 0 ? (
                          emp.campaignMembers.map(m => (
                            <span key={m.campaign.id} className="px-2 py-0.5 rounded-lg bg-brand-blue/10 text-brand-blue text-[9px] font-extrabold uppercase tracking-wide border border-brand-blue/20">
                              {m.campaign.name}
                            </span>
                          ))
                        ) : (
                          <span className="px-2 py-0.5 rounded-lg bg-brand-border text-brand-text-soft text-[9px] font-extrabold uppercase tracking-wide border border-brand-border/20">
                            {getTeamPlaceholder(emp)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 font-mono text-brand-text font-medium">{emp.bankAccount || '-'}</td>
                    <td className="p-4 font-medium text-brand-text-soft font-mono">{emp.shiftStart} - {emp.shiftEnd}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${
                        emp.status === 'active'
                          ? 'bg-brand-green/10 text-brand-green border-brand-green/20'
                          : 'bg-brand-bg-elevated text-brand-text-mute border-brand-border'
                      }`}>
                        {emp.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setDetailEmployee(emp)}
                          className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue-soft transition-colors cursor-pointer"
                          title="View Profile"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {(isAdmin || currentUser.id === emp.userId || (currentUser.employee && currentUser.employee.id === emp.id)) && (
                          <button
                            onClick={() => handleEditClick(emp)}
                            className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue-soft transition-colors cursor-pointer"
                            title="Edit Profile"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------------- Slide-Over Details Drawer ---------------- */}
      <AnimatePresence>
        {detailEmployee && (
          <>
            <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setDetailEmployee(null)} />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-lg bg-brand-bg-soft border-l border-brand-border z-50 p-6 overflow-y-auto flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between border-b border-brand-border pb-4 mb-6">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-brand-blue">{detailEmployee.employeeCode}</span>
                    <h3 className="text-lg font-extrabold text-brand-text font-display mt-0.5">{detailEmployee.fullName}</h3>
                  </div>
                  <button onClick={() => setDetailEmployee(null)} className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text cursor-pointer">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Profile Grid */}
                <div className="space-y-5">
                  <div className="p-4 rounded-2xl bg-brand-bg border border-brand-border grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Email Address</p>
                      <p className="text-xs text-brand-text font-semibold mt-1 truncate">{detailEmployee.user?.email || '-'}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">User Role</p>
                      <p className="text-xs text-brand-text font-semibold mt-1">{detailEmployee.user?.role || '-'}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Designation</p>
                      <p className="text-xs text-brand-text font-semibold mt-1">{detailEmployee.designation}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Teams Assigned</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {detailEmployee.campaignMembers && detailEmployee.campaignMembers.length > 0 ? (
                          detailEmployee.campaignMembers.map(m => (
                            <span key={m.campaign.id} className="px-1.5 py-0.5 rounded bg-brand-blue/10 text-brand-blue text-[9px] font-extrabold uppercase tracking-wide border border-brand-blue/20">
                              {m.campaign.name}
                            </span>
                          ))
                        ) : (
                          <span className="text-brand-text-mute text-xs">No Team</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Birthday</p>
                      <p className="text-xs text-brand-text font-semibold mt-1">
                        {detailEmployee.birthday || '-'}
                      </p>
                    </div>
                  </div>

                  <h4 className="text-xs font-bold text-brand-text uppercase tracking-widest font-display">Salary & Shift Details</h4>
                  <div className="p-4 rounded-2xl bg-brand-bg border border-brand-border grid grid-cols-2 gap-4">
                    {/* The API omits baseSalary for a Team Lead viewing a team
                        member; render nothing rather than a misleading PKR 0. */}
                    {detailEmployee.baseSalary !== undefined && (
                      <div>
                        <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Base Salary</p>
                        <p className="text-xs text-brand-cyan font-bold mt-1 font-mono">
                          {money(detailEmployee.baseSalary, detailEmployee.currency)}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Shift Timings</p>
                      <p className="text-xs text-brand-text font-mono mt-1 font-bold">{detailEmployee.shiftStart} - {detailEmployee.shiftEnd}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Biometric Device ID</p>
                      <p className="text-xs text-brand-text font-mono mt-1 font-bold">{detailEmployee.zkUserId || '-'}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Mobile Phone</p>
                      <p className="text-xs text-brand-text font-semibold mt-1 font-mono">{detailEmployee.phone || '-'}</p>
                    </div>
                  </div>

                  {/* Salary History */}
                  {detailEmployee.salaryHistory?.length > 0 && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-brand-text uppercase tracking-widest font-display">Salary History Log</h4>
                      <div className="space-y-2">
                        {detailEmployee.salaryHistory.map((sh, idx) => (
                          <div key={idx} className="p-3.5 rounded-xl border border-brand-border bg-brand-bg flex justify-between items-center">
                            <div>
                              <p className="text-xs font-bold text-brand-cyan font-mono">{money(sh.newSalary)}</p>
                              <p className="text-[10px] text-brand-text-soft mt-0.5">{sh.reason}</p>
                            </div>
                            <span className="text-[9px] text-brand-text-mute font-mono">
                              {longDate(sh.effectiveDate)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

               {/* Action Buttons */}
              {isAdmin && (
                <div className="mt-8 border-t border-brand-border pt-4 space-y-3">
                  <button
                    onClick={() => handleResetPassword(detailEmployee)}
                    disabled={resetting}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-brand-blue/10 hover:bg-brand-blue hover:text-brand-bg border border-brand-blue/30 text-xs font-bold uppercase tracking-wider font-display transition-all duration-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    Reset Password (One-Time Credential)
                  </button>
                  {detailEmployee.status === 'active' && (
                    <button
                      onClick={() => handleTerminate(detailEmployee.id)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-brand-amber/10 hover:bg-brand-amber hover:text-brand-bg border border-brand-amber/30 text-xs font-bold uppercase tracking-wider font-display transition-all duration-300 cursor-pointer"
                    >
                      <Clock className="w-4 h-4" />
                      Terminate Employment & Disable Login
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteEmployee(detailEmployee.id)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-full bg-brand-red/10 hover:bg-brand-red hover:text-brand-bg border border-brand-red/30 text-xs font-bold uppercase tracking-wider font-display transition-all duration-300 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Record Permanently (Hard Delete)
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ---------------- One-Time Password Modal ---------------- */}
      <AnimatePresence>
        {resetResult && (
          <>
            {/* No click-away dismiss: the password cannot be retrieved again, so
                closing is an explicit acknowledgement. */}
            <div className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 shadow-glow z-[70]"
            >
              <h3 className="text-sm font-extrabold text-brand-text font-display uppercase mb-1">Password Reset Complete</h3>
              <p className="text-xs text-brand-text-soft leading-relaxed mb-4">
                Give this password to <span className="font-bold text-brand-text">{resetResult.fullName}</span>.
                It is shown <span className="font-bold text-brand-amber">once</span> and cannot be retrieved again.
                They must change it the first time they sign in.
              </p>

              <div className="p-3.5 rounded-xl border border-brand-border bg-brand-bg mb-3">
                <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">Email</p>
                <p className="text-xs text-brand-text font-mono mt-1 break-all">{resetResult.email}</p>
              </div>
              <div className="p-3.5 rounded-xl border border-brand-amber/30 bg-brand-amber/5 mb-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] text-brand-text-mute uppercase font-bold tracking-wider">One-Time Password</p>
                  <p className="text-sm text-brand-text font-mono font-bold mt-1 break-all select-all">{resetResult.password}</p>
                </div>
                <button
                  onClick={copyResetPassword}
                  className="p-2 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-blue-soft transition-colors cursor-pointer shrink-0"
                  title="Copy password"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={() => setResetResult(null)}
                className="w-full py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer hover:scale-[1.01] transition-all"
              >
                I have saved it — close
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ---------------- Add Employee Modal ---------------- */}
      <AnimatePresence>
        {addModalOpen && (
          <>
            <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setAddModalOpen(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 shadow-glow z-50 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-brand-border pb-4 mb-6">
                <h3 className="text-sm font-extrabold text-brand-text font-display uppercase">Add New Employee Profile</h3>
                <button onClick={() => setAddModalOpen(false)} className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit(handleAddEmployee)} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Credentials */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Email Address *</label>
                    <input
                      type="email"
                      {...register('email', { required: 'A valid email is required' })}
                      placeholder="e.g. employee@brandigade.com"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Temporary Password *</label>
                    <input
                      type="password"
                      {...register('password', {
                        required: 'A password is required',
                        minLength: { value: 10, message: 'At least 10 characters' },
                        validate: {
                          mixedCase: (v) =>
                            (/[a-z]/.test(v) && /[A-Z]/.test(v)) || 'Include upper and lower case',
                          digit: (v) => /\d/.test(v) || 'Include at least one number',
                        },
                      })}
                      placeholder="Min 10 chars, mixed case + number"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                    {errors.password && (
                      <span className="text-[10px] text-brand-red mt-1 block">{errors.password.message}</span>
                    )}
                    <p className="text-[9px] text-brand-text-mute mt-1.5 leading-relaxed">
                      The employee is required to change this the first time they sign in.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Role *</label>
                    <select
                      {...register('role', { required: true })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none cursor-pointer"
                    >
                      <option value="Employee">Employee</option>
                      <option value="SDR">SDR</option>
                      <option value="Team Lead">Team Lead</option>
                      <option value="Admin">Admin</option>
                      <option value="CEO">CEO</option>
                      <option value="COO">COO</option>
                    </select>
                  </div>

                  {/* Profile Details */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Employee Code *</label>
                    <input
                      type="text"
                      {...register('employeeCode', { required: 'Employee code is required' })}
                      placeholder="e.g. EMP-004"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Full Name *</label>
                    <input
                      type="text"
                      {...register('fullName', { required: 'Full name is required' })}
                      placeholder="e.g. Raameen Ali"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Designation *</label>
                    <input
                      type="text"
                      {...register('designation', { required: 'Designation is required' })}
                      placeholder="e.g. SDR Outbound Campaigner"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Projects / Teams Assigned</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 p-3.5 rounded-xl border border-brand-border bg-brand-bg">
                      {teams.map(t => (
                        <label key={t.id} className="flex items-center gap-2 text-xs text-brand-text cursor-pointer select-none">
                          <input
                            type="checkbox"
                            value={t.id}
                            {...register('teamIds')}
                            className="w-4 h-4 rounded border-brand-border text-brand-blue bg-brand-bg focus:ring-0 focus:ring-offset-0 cursor-pointer"
                          />
                          <span>{t.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Base Monthly Salary (PKR) *</label>
                    <input
                      type="number"
                      {...register('baseSalary', { required: 'Base salary is required' })}
                      placeholder="e.g. 55000"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Birthday (for Wishes)</label>
                    <input
                      type="text"
                      {...register('birthday')}
                      placeholder="e.g. 15th June"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Bank Account</label>
                    <input
                      type="text"
                      {...register('bankAccount')}
                      placeholder="e.g. Meezan Bank - 02341234"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Biometric ZK Device User ID</label>
                    <input
                      type="text"
                      {...register('zkUserId')}
                      placeholder="e.g. 4"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none"
                    />
                  </div>

                  {/* Shift timings inputs (check in / check out) */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Shift Start Time *</label>
                    <input
                      type="time"
                      defaultValue="09:30"
                      {...register('shiftStart', { required: 'Shift start is required' })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Shift End Time *</label>
                    <input
                      type="time"
                      defaultValue="18:30"
                      {...register('shiftEnd', { required: 'Shift end is required' })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Shift Grace Minutes *</label>
                    <input
                      type="number"
                      defaultValue="15"
                      {...register('graceMinutes', { required: true })}
                      placeholder="e.g. 15"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  </div>

                {Object.keys(errors).length > 0 && (
                  <ul className="text-[11px] text-brand-red space-y-1 border border-brand-red/25 bg-brand-red/5 rounded-xl p-3">
                    {Object.entries(errors).map(([field, error]) => (
                      <li key={field}>{error.message || `${field} is invalid`}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-6 flex gap-3 justify-end border-t border-brand-border pt-4">
                  <button
                    type="button"
                    onClick={() => setAddModalOpen(false)}
                    className="px-5 py-2 rounded-full border border-brand-border hover:bg-brand-bg font-semibold text-xs text-brand-text-soft hover:text-brand-text transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg hover:scale-[1.02] transition-colors font-bold font-display text-xs cursor-pointer shadow-md shadow-brand-blue/15"
                  >
                    Save Profile
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ---------------- Edit Employee Modal ---------------- */}
      <AnimatePresence>
        {editModalOpen && (
          <>
            <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setEditModalOpen(false)} />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 shadow-glow z-50 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-brand-border pb-4 mb-6">
                <h3 className="text-sm font-extrabold text-brand-text font-display uppercase">Edit Employee Profile</h3>
                <button onClick={() => setEditModalOpen(false)} className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmitEdit(handleEditEmployee)} className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Account Fields */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Email Address *</label>
                    <input
                      type="email"
                      {...registerEdit('email', { required: 'A valid email is required' })}
                      placeholder="e.g. employee@brandigade.com"
                      disabled={!isAdmin}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Role *</label>
                    <select
                      {...registerEdit('role', { required: true })}
                      disabled={!isAdmin}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none cursor-pointer disabled:opacity-50"
                    >
                      <option value="Employee">Employee</option>
                      <option value="SDR">SDR</option>
                      <option value="Team Lead">Team Lead</option>
                      <option value="Admin">Admin</option>
                      <option value="CEO">CEO</option>
                      <option value="COO">COO</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Login Status *</label>
                    <select
                      {...registerEdit('isActive', { setValueAs: v => v === 'true' })}
                      disabled={!isAdmin}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none cursor-pointer disabled:opacity-50"
                    >
                      <option value="true">Active Login</option>
                      <option value="false">Disabled / Blocked</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Employment Status *</label>
                    <select
                      {...registerEdit('status', { required: true })}
                      disabled={!isAdmin}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none cursor-pointer disabled:opacity-50"
                    >
                      <option value="active">Active</option>
                      <option value="on_leave">On Leave</option>
                      <option value="terminated">Terminated</option>
                      <option value="resigned">Resigned</option>
                    </select>
                  </div>

                  {/* Profile Details */}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Employee Code *</label>
                    <input
                      type="text"
                      {...registerEdit('employeeCode', { required: 'Employee code is required' })}
                      disabled={!isAdmin}
                      placeholder="e.g. EMP-004"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Full Name *</label>
                    <input
                      type="text"
                      {...registerEdit('fullName', { required: 'Full name is required' })}
                      disabled={!isAdmin}
                      placeholder="e.g. Raameen Ali"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Designation *</label>
                    <input
                      type="text"
                      {...registerEdit('designation', { required: 'Designation is required' })}
                      disabled={!isAdmin}
                      placeholder="e.g. SDR Outbound Campaigner"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue disabled:opacity-50"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Projects / Teams Assigned</label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 p-3.5 rounded-xl border border-brand-border bg-brand-bg">
                      {teams.map(t => (
                        <label key={t.id} className="flex items-center gap-2 text-xs text-brand-text cursor-pointer select-none">
                          <input
                            type="checkbox"
                            value={t.id}
                            {...registerEdit('teamIds')}
                            disabled={!isAdmin}
                            className="w-4 h-4 rounded border-brand-border text-brand-blue bg-brand-bg focus:ring-0 focus:ring-offset-0 cursor-pointer disabled:opacity-50"
                          />
                          <span>{t.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Base Monthly Salary (PKR) *</label>
                    <input
                      type="number"
                      {...registerEdit('baseSalary', { required: 'Base salary is required' })}
                      disabled={!isAdmin}
                      placeholder="e.g. 55000"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Birthday (for Wishes)</label>
                    <input
                      type="text"
                      {...registerEdit('birthday')}
                      placeholder="e.g. 15th June"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Biometric ZK Device User ID</label>
                    <input
                      type="text"
                      {...registerEdit('zkUserId')}
                      disabled={!isAdmin}
                      placeholder="e.g. 4"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Shift Start Time *</label>
                    <input
                      type="time"
                      {...registerEdit('shiftStart', { required: 'Shift start is required' })}
                      disabled={!isAdmin}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Shift End Time *</label>
                    <input
                      type="time"
                      {...registerEdit('shiftEnd', { required: 'Shift end is required' })}
                      disabled={!isAdmin}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue disabled:opacity-50"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Shift Grace Minutes *</label>
                    <input
                      type="number"
                      {...registerEdit('graceMinutes', { required: true })}
                      disabled={!isAdmin}
                      placeholder="e.g. 15"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Mobile Phone</label>
                    <input
                      type="text"
                      {...registerEdit('phone')}
                      placeholder="e.g. +92 300 1234567"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Emergency Contact</label>
                    <input
                      type="text"
                      {...registerEdit('emergencyContact')}
                      placeholder="e.g. Brother: +92 300 7654321"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Bank Account</label>
                    <input
                      type="text"
                      {...registerEdit('bankAccount')}
                      placeholder="e.g. Meezan Bank - 02341234"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none"
                    />
                  </div>



                  {/* Salary Change Reason (Log history) */}
                  <div className="col-span-2 border-t border-brand-border pt-4 mt-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-brand-amber mb-3">Salary History Log (Optional)</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Salary Change Effective Date</label>
                        <input
                          type="date"
                          {...registerEdit('salaryChangeEffectiveDate')}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">Reason for Salary Change</label>
                        <input
                          type="text"
                          {...registerEdit('salaryChangeReason')}
                          placeholder="e.g. Annual Appraisal, Promotion"
                          className="w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {Object.keys(errorsEdit).length > 0 && (
                  <ul className="text-[11px] text-brand-red space-y-1 border border-brand-red/25 bg-brand-red/5 rounded-xl p-3">
                    {Object.entries(errorsEdit).map(([field, error]) => (
                      <li key={field}>{error.message || `${field} is invalid`}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-6 flex gap-3 justify-end border-t border-brand-border pt-4">
                  <button
                    type="button"
                    onClick={() => setEditModalOpen(false)}
                    className="px-5 py-2 rounded-full border border-brand-border hover:bg-brand-bg font-semibold text-xs text-brand-text-soft hover:text-brand-text transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-full bg-gradient-to-r from-brand-amber to-brand-violet text-brand-bg hover:scale-[1.02] transition-colors font-bold font-display text-xs cursor-pointer shadow-md shadow-brand-amber/15"
                  >
                    Update Profile
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
