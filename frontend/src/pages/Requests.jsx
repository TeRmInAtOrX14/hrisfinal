import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { Plus, X, Loader2, Check, Ban, Inbox } from 'lucide-react';
import toast from 'react-hot-toast';

import api, { session, apiError } from '../utils/api';
import { canReview, isTeamLead } from '../utils/roles';
import { longDate, todayInput } from '../utils/format';

const TYPES = [
  { key: 'leave', label: 'Leave' },
  { key: 'halfday', label: 'Half-day' },
  { key: 'wfh', label: 'Work from home' },
];

function StatusBadge({ status }) {
  const styles = {
    approved: 'bg-brand-green/10 text-brand-green border-brand-green/25',
    rejected: 'bg-brand-red/10 text-brand-red border-brand-red/25',
    pending: 'bg-brand-blue/10 text-brand-blue border-brand-blue/25',
  };
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider border ${
        styles[status] || styles.pending
      }`}
    >
      {status}
    </span>
  );
}

export default function Requests() {
  const user = session.user;
  const reviewer = canReview(user);
  const teamLead = isTeamLead(user);

  // Team Leads get a read-only team view: the API grants them visibility but
  // not approval authority. The old UI rendered Approve/Reject buttons for them
  // that always came back 403.
  const canSeeTeamTab = reviewer || teamLead;

  const [activeTab, setActiveTab] = useState('mine');
  const [data, setData] = useState({ leave: [], halfday: [], wfh: [] });
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [submitType, setSubmitType] = useState('leave');
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm();

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);

      // "My requests" hits the /mine endpoints, which are always scoped to the
      // caller. The old page called the same unscoped list endpoint for both
      // tabs, so an admin's personal log showed every request in the company.
      const suffix = activeTab === 'mine' ? '/mine' : '?status=pending';

      const [leave, halfday, wfh] = await Promise.all([
        api.get(`/requests/leave${suffix}`),
        api.get(`/requests/halfday${suffix}`),
        api.get(`/requests/wfh${suffix}`),
      ]);

      setData({ leave: leave.data, halfday: halfday.data, wfh: wfh.data });
    } catch (err) {
      toast.error(apiError(err, 'Failed to load requests.'));
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const onSubmit = async (values) => {
    try {
      setSubmitting(true);
      await api.post(`/requests/${submitType}`, values);
      toast.success('Request submitted.');
      setModalOpen(false);
      reset();
      fetchRequests();
    } catch (err) {
      toast.error(apiError(err, 'Could not submit your request.'));
    } finally {
      setSubmitting(false);
    }
  };

  const review = async (type, id, status) => {
    const verb = status === 'approved' ? 'Approve' : 'Reject';
    if (!window.confirm(`${verb} this request?`)) return;

    try {
      setReviewing(id);
      await api.put(`/requests/${type}/${id}/review`, { status });
      toast.success(`Request ${status}.`);
      fetchRequests();
    } catch (err) {
      toast.error(apiError(err, 'Could not review this request.'));
    } finally {
      setReviewing(null);
    }
  };

  const describe = (type, req) => {
    if (type === 'halfday') return longDate(req.date);
    const start = longDate(req.startDate);
    const end = longDate(req.endDate);
    return start === end ? start : `${start} → ${end}`;
  };

  const allEmpty = TYPES.every(({ key }) => data[key].length === 0);
  const showReviewActions = activeTab === 'team' && reviewer;

  const inputClass =
    'w-full px-3.5 py-2.5 rounded-xl border border-brand-border bg-brand-bg text-xs text-brand-text focus:outline-none focus:border-brand-blue';

  return (
    <div className="space-y-6 text-left">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase">
            Request Centre
          </h2>
          <p className="text-xs text-brand-text-soft mt-1">
            Submit leave, half-days and work-from-home periods.
          </p>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="px-5 py-2.5 rounded-full brandigade-gradient text-white hover:scale-[1.02] active:scale-[0.98] font-bold font-display text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-blue/20"
        >
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      {canSeeTeamTab && (
        <div className="border-b border-brand-border flex gap-6" role="tablist">
          {[
            ['mine', 'My requests'],
            ['team', reviewer ? 'Pending reviews' : 'Team requests'],
          ].map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
              className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
                activeTab === key
                  ? 'border-brand-blue text-brand-text'
                  : 'border-transparent text-brand-text-soft hover:text-brand-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'team' && teamLead && !reviewer && (
        <p className="text-[11px] text-brand-text-soft p-3 rounded-xl border border-brand-border bg-brand-bg-soft/40">
          You can see your team&apos;s requests here. Approvals are handled by HR and management.
        </p>
      )}

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
        </div>
      ) : allEmpty ? (
        <div className="p-10 text-center border border-dashed border-brand-border rounded-2xl">
          <Inbox className="w-7 h-7 text-brand-text-mute mx-auto mb-3" />
          <p className="text-sm text-brand-text-soft">
            {activeTab === 'mine' ? 'You have no requests yet.' : 'Nothing awaiting review.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {TYPES.map(({ key, label }) => {
            const rows = data[key];
            if (rows.length === 0) return null;

            return (
              <section
                key={key}
                className="border border-brand-border rounded-2xl bg-brand-bg-soft/40 overflow-hidden"
              >
                <h3 className="px-4 py-3 text-[10px] font-extrabold uppercase tracking-widest text-brand-text-soft border-b border-brand-border bg-brand-bg-elevated/40">
                  {label} · {rows.length}
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sr-only">
                      <tr>
                        {activeTab === 'team' && <th>Employee</th>}
                        <th>Dates</th>
                        <th>Reason</th>
                        <th>Status</th>
                        {showReviewActions && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-border">
                      {rows.map((req) => (
                        <tr key={req.id} className="hover:bg-brand-bg-elevated/20 transition-colors">
                          {activeTab === 'team' && (
                            <td className="p-4">
                              <div className="font-bold text-brand-text">
                                {req.employee?.fullName || '—'}
                              </div>
                              <div className="text-[10px] text-brand-text-mute mt-0.5">
                                {req.employee?.employeeCode}
                              </div>
                            </td>
                          )}

                          <td className="p-4 font-mono text-brand-text">
                            {describe(key, req)}
                            {key === 'leave' && (
                              <span className="text-brand-text-mute ml-2">
                                ({req.days} day{req.days === 1 ? '' : 's'}, {req.type})
                              </span>
                            )}
                          </td>

                          <td className="p-4 text-brand-text-soft max-w-xs truncate">
                            {req.reason || '—'}
                          </td>

                          <td className="p-4">
                            <StatusBadge status={req.status} />
                          </td>

                          {showReviewActions && (
                            <td className="p-4 text-right">
                              {req.status === 'pending' ? (
                                <div className="flex justify-end gap-2">
                                  <button
                                    onClick={() => review(key, req.id, 'approved')}
                                    disabled={reviewing === req.id}
                                    className="p-1.5 rounded-lg border border-brand-green/30 text-brand-green hover:bg-brand-green/10 transition-colors cursor-pointer disabled:opacity-40"
                                    title="Approve"
                                  >
                                    {reviewing === req.id ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Check className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <button
                                    onClick={() => review(key, req.id, 'rejected')}
                                    disabled={reviewing === req.id}
                                    className="p-1.5 rounded-lg border border-brand-red/30 text-brand-red hover:bg-brand-red/10 transition-colors cursor-pointer disabled:opacity-40"
                                    title="Reject"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] text-brand-text-mute">Reviewed</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Submit modal */}
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
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(28rem,calc(100vw-2rem))] bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 shadow-glow z-50"
            >
              <div className="flex items-center justify-between border-b border-brand-border pb-4 mb-5">
                <h3 className="text-sm font-extrabold text-brand-text font-display uppercase">
                  New request
                </h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="p-1.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                    Request type
                  </label>
                  <select
                    value={submitType}
                    onChange={(e) => {
                      setSubmitType(e.target.value);
                      reset();
                    }}
                    className={`${inputClass} cursor-pointer`}
                  >
                    {TYPES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                {submitType === 'leave' && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                      Leave type
                    </label>
                    <select {...register('type', { required: true })} className={`${inputClass} cursor-pointer`}>
                      <option value="annual">Annual</option>
                      <option value="sick">Sick</option>
                      <option value="casual">Casual</option>
                      <option value="unpaid">Unpaid</option>
                    </select>
                  </div>
                )}

                {submitType === 'halfday' ? (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                      Date
                    </label>
                    <input
                      type="date"
                      min={todayInput()}
                      {...register('date', { required: 'A date is required' })}
                      className={inputClass}
                    />
                    {errors.date && (
                      <span className="text-xs text-brand-red mt-1 block">{errors.date.message}</span>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                        From
                      </label>
                      <input
                        type="date"
                        {...register('startDate', { required: 'Start date is required' })}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                        To
                      </label>
                      <input
                        type="date"
                        {...register('endDate', { required: 'End date is required' })}
                        className={inputClass}
                      />
                    </div>
                    {(errors.startDate || errors.endDate) && (
                      <span className="col-span-2 text-xs text-brand-red">
                        {errors.startDate?.message || errors.endDate?.message}
                      </span>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
                    Reason
                  </label>
                  <textarea
                    rows={3}
                    {...register('reason')}
                    placeholder="Optional context for your manager"
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
                    Submit
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
