import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { Calendar, RotateCw, Plus, X, Loader2, LogIn, LogOut, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

import api, { session, apiError } from '../utils/api';
import { isAdmin } from '../utils/roles';
import { shortDate, clockTime, minutesToDuration, todayInput, monthStartInput } from '../utils/format';

const STATUS_STYLES = {
  present: 'bg-brand-green/10 text-brand-green border-brand-green/25',
  half_day: 'bg-brand-amber/10 text-brand-amber border-brand-amber/25',
  leave: 'bg-brand-violet/10 text-brand-violet border-brand-violet/25',
  // 'wfh' had no style, so approved work-from-home days rendered as an
  // unlabelled grey chip reading "wfh".
  wfh: 'bg-brand-blue/10 text-brand-blue border-brand-blue/25',
  absent: 'bg-brand-red/10 text-brand-red border-brand-red/25',
  holiday: 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/25',
};

const STATUS_LABELS = {
  present: 'Present',
  half_day: 'Half day',
  leave: 'Leave',
  wfh: 'WFH',
  absent: 'Absent',
  holiday: 'Holiday',
  weekend: 'Weekend',
};

export default function Attendance() {
  const user = session.user;
  const admin = isAdmin(user);

  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [startDate, setStartDate] = useState(monthStartInput);
  const [endDate, setEndDate] = useState(todayInput);
  const [selectedEmployee, setSelectedEmployee] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm();

  const fetchAttendance = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ startDate, endDate });
      if (selectedEmployee) params.set('employeeId', selectedEmployee);
      const res = await api.get(`/attendance?${params}`);
      setRecords(res.data);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load attendance.'));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedEmployee]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  useEffect(() => {
    if (!admin) return;
    api
      .get('/employees')
      .then((res) => setEmployees(res.data))
      .catch(() => {});
  }, [admin]);

  const handleSync = async () => {
    try {
      setSyncing(true);
      toast.loading('Connecting to the biometric device…', { id: 'zk-sync' });
      const res = await api.post('/attendance/sync');
      const { synced, skipped, errors: syncErrors } = res.data;

      if (syncErrors?.length) {
        toast.error(`Synced ${synced}, but ${syncErrors.length} failed.`, { id: 'zk-sync' });
      } else {
        toast.success(`Synced ${synced} record(s), skipped ${skipped}.`, { id: 'zk-sync' });
      }
      fetchAttendance();
    } catch (err) {
      toast.error(apiError(err, 'Biometric sync failed. Is the device online?'), { id: 'zk-sync' });
    } finally {
      setSyncing(false);
    }
  };

  const onManualPunch = async (values) => {
    try {
      setSubmitting(true);
      // Empty datetime-local inputs come through as '' — send null instead.
      await api.post('/attendance/manual', {
        ...values,
        checkIn: values.checkIn || null,
        checkOut: values.checkOut || null,
      });
      toast.success('Attendance recorded.');
      setModalOpen(false);
      reset();
      fetchAttendance();
    } catch (err) {
      toast.error(apiError(err, 'Could not record attendance.'));
    } finally {
      setSubmitting(false);
    }
  };

  // Summary across whatever is currently filtered.
  const summary = records.reduce(
    (acc, r) => {
      if (r.status === 'present') acc.present++;
      else if (r.status === 'wfh') acc.wfh++;
      else if (r.status === 'half_day') acc.halfDay++;
      else if (r.status === 'leave') acc.leave++;
      if (r.late > 0) {
        acc.lateCount++;
        acc.lateMinutes += r.late;
      }
      acc.overtimeMinutes += r.overtime;
      return acc;
    },
    { present: 0, wfh: 0, halfDay: 0, leave: 0, lateCount: 0, lateMinutes: 0, overtimeMinutes: 0 }
  );

  const inputClass =
    'w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue';

  return (
    <div className="space-y-6 text-left">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase">
            Attendance Registry
          </h2>
          <p className="text-xs text-brand-text-soft mt-1">
            Biometric check-in and check-out, grace periods and late penalties.
          </p>
        </div>

        {admin && (
          <div className="flex gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="px-5 py-2.5 rounded-full border border-brand-border hover:border-brand-border-strong bg-brand-bg-soft/40 text-xs font-bold uppercase tracking-wider font-display text-brand-text-soft hover:text-brand-text transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              Sync Biometric
            </button>

            <button
              onClick={() => setModalOpen(true)}
              className="px-5 py-2.5 rounded-full brandigade-gradient text-white hover:scale-[1.02] transition-all font-bold font-display text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-blue/20"
            >
              <Plus className="w-4 h-4" />
              Manual Punch
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="p-4 rounded-2xl border border-brand-border bg-brand-bg-soft/40 flex flex-col md:flex-row gap-4 md:items-center">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <Calendar className="w-4 h-4 text-brand-text-mute shrink-0" />
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            aria-label="From date"
            className="px-3.5 py-2 rounded-xl border border-brand-border bg-brand-bg/40 text-xs text-brand-text focus:outline-none cursor-pointer"
          />
          <span className="text-brand-text-mute text-xs">to</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
            aria-label="To date"
            className="px-3.5 py-2 rounded-xl border border-brand-border bg-brand-bg/40 text-xs text-brand-text focus:outline-none cursor-pointer"
          />
        </div>

        {admin && (
          <select
            value={selectedEmployee}
            onChange={(e) => setSelectedEmployee(e.target.value)}
            aria-label="Filter by employee"
            className="w-full md:w-56 px-4 py-2 rounded-xl border border-brand-border bg-brand-bg/40 text-xs text-brand-text cursor-pointer focus:outline-none focus:border-brand-blue"
          >
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName} ({e.employeeCode})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Summary strip */}
      {!loading && records.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            ['Present', summary.present, 'text-brand-green'],
            ['WFH', summary.wfh, 'text-brand-blue'],
            ['Half days', summary.halfDay, 'text-brand-amber'],
            ['Leave', summary.leave, 'text-brand-violet'],
            ['Late arrivals', summary.lateCount, 'text-brand-red'],
            ['Overtime', minutesToDuration(summary.overtimeMinutes), 'text-brand-cyan'],
          ].map(([label, value, tone]) => (
            <div key={label} className="p-3 rounded-xl border border-brand-border bg-brand-bg-soft/40">
              <p className="text-[9px] font-bold uppercase tracking-widest text-brand-text-mute">
                {label}
              </p>
              <p className={`text-lg font-extrabold font-display tabular-nums mt-1 ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
        </div>
      ) : records.length === 0 ? (
        <div className="p-10 text-center border border-dashed border-brand-border rounded-2xl">
          <Clock className="w-7 h-7 text-brand-text-mute mx-auto mb-3" />
          <p className="text-sm text-brand-text-soft">No attendance records in this date range.</p>
        </div>
      ) : (
        <div className="border border-brand-border rounded-2xl bg-brand-bg-soft/40 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-brand-border bg-brand-bg-elevated/40 text-[9px] uppercase font-extrabold tracking-widest text-brand-text-soft">
                  <th scope="col" className="p-4">Date</th>
                  <th scope="col" className="p-4">Staff member</th>
                  <th scope="col" className="p-4">Status</th>
                  <th scope="col" className="p-4">Check-in</th>
                  {/* Check-out was never shown, because the backend never
                      stored it. Both are now recorded and displayed. */}
                  <th scope="col" className="p-4">Check-out</th>
                  <th scope="col" className="p-4 text-center">Late</th>
                  <th scope="col" className="p-4 text-center">Overtime</th>
                  <th scope="col" className="p-4">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-border text-xs text-brand-text-soft">
                {records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-brand-bg-elevated/20 transition-colors">
                    <td className="p-4 font-bold text-brand-text font-mono whitespace-nowrap">
                      {shortDate(rec.date)}
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-brand-text">{rec.employee?.fullName}</div>
                      <div className="text-[10px] text-brand-text-mute mt-0.5">
                        {rec.employee?.employeeCode}
                      </div>
                    </td>
                    <td className="p-4">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border whitespace-nowrap ${
                          STATUS_STYLES[rec.status] ||
                          'bg-brand-bg-elevated text-brand-text-mute border-brand-border'
                        }`}
                      >
                        {STATUS_LABELS[rec.status] || rec.status}
                      </span>
                    </td>
                    <td className="p-4 font-mono font-bold text-brand-text whitespace-nowrap">
                      {rec.checkIn && <LogIn className="w-3 h-3 inline mr-1.5 text-brand-green" />}
                      {clockTime(rec.checkIn)}
                    </td>
                    <td className="p-4 font-mono font-bold text-brand-text whitespace-nowrap">
                      {rec.checkOut && <LogOut className="w-3 h-3 inline mr-1.5 text-brand-blue" />}
                      {clockTime(rec.checkOut)}
                    </td>
                    <td className="p-4 font-mono text-center whitespace-nowrap">
                      {rec.late > 0 ? (
                        <span className="text-brand-amber font-bold">
                          {minutesToDuration(rec.late)}
                        </span>
                      ) : (
                        <span className="text-brand-text-mute">—</span>
                      )}
                    </td>
                    <td className="p-4 font-mono text-center whitespace-nowrap">
                      {rec.overtime > 0 ? (
                        <span className="text-brand-green font-bold">
                          {minutesToDuration(rec.overtime)}
                        </span>
                      ) : (
                        <span className="text-brand-text-mute">—</span>
                      )}
                    </td>
                    <td className="p-4 text-brand-text-soft max-w-[14rem] truncate">
                      {rec.note || <span className="text-brand-text-mute">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Manual punch modal */}
      <AnimatePresence>
        {modalOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
              onClick={() => setModalOpen(false)}
            />
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(28rem,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 shadow-glow z-50"
            >
              <div className="flex items-center justify-between border-b border-brand-border pb-4 mb-5">
                <h3 className="text-sm font-extrabold text-brand-text font-display uppercase">
                  Log manual punch
                </h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit(onManualPunch)} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                    Employee
                  </label>
                  <select
                    {...register('employeeId', { required: 'Select an employee' })}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">Choose…</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName} ({e.employeeCode})
                      </option>
                    ))}
                  </select>
                  {errors.employeeId && (
                    <span className="text-xs text-brand-red mt-1 block">
                      {errors.employeeId.message}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                      Date
                    </label>
                    <input
                      type="date"
                      {...register('date', { required: 'A date is required' })}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                      Status
                    </label>
                    <select
                      {...register('status', { required: true })}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="present">Present</option>
                      <option value="half_day">Half day</option>
                      <option value="wfh">Work from home</option>
                      <option value="leave">Leave</option>
                      <option value="absent">Absent</option>
                      <option value="holiday">Holiday</option>
                    </select>
                  </div>
                </div>
                {errors.date && (
                  <span className="text-xs text-brand-red block">{errors.date.message}</span>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                      Check-in
                    </label>
                    <input type="datetime-local" {...register('checkIn')} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                      Check-out
                    </label>
                    <input type="datetime-local" {...register('checkOut')} className={inputClass} />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                    Note
                  </label>
                  <textarea
                    rows={2}
                    {...register('note')}
                    placeholder="e.g. Forgot to scan on the device"
                    className={inputClass}
                  />
                </div>

                <div className="flex gap-3 justify-end border-t border-brand-border pt-4">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-5 py-2 rounded-full border border-brand-border font-semibold text-xs text-brand-text-soft hover:text-brand-text transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 rounded-full brandigade-gradient text-white font-bold font-display text-xs cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Record
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
