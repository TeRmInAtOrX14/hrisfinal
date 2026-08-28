import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  Plus,
  X,
  User,
  Loader2
} from 'lucide-react';
import api, { session, apiError } from '../utils/api';
import toast from 'react-hot-toast';
import { isAdmin as isAdminRole } from '../utils/roles';

export default function Loans() {
  const [activeTab, setActiveTab] = useState('my-loans');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [reviewItem, setReviewItem] = useState(null);

  const currentUser = session.user || { role: 'Employee' };
  const isAdmin = isAdminRole(currentUser);
  const { register, handleSubmit, reset } = useForm();

  const fetchLoans = async () => {
    try {
      setLoading(true);
      const query = activeTab === 'reviews' ? 'status=pending' : '';
      const res = await api.get(`/loans?${query}`);
      setRequests(res.data);
    } catch (err) {
      toast.error(apiError(err, 'Failed to load loans records.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLoans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleCreateRequest = async (data) => {
    try {
      await api.post('/loans', data);
      toast.success('Advance / Loan request submitted!');
      setRequestModalOpen(false);
      reset();
      fetchLoans();
    } catch (err) {
      toast.error(apiError(err, 'Failed to submit loan request.'));
    }
  };

  const handleReview = async (data) => {
    try {
      await api.put(`/loans/${reviewItem.id}/review`, {
        status: data.status,
        repaymentMonth: data.repaymentMonth,
        repaymentYear: data.repaymentYear
      });
      toast.success(`Request ${data.status} successfully`);
      setReviewItem(null);
      reset();
      fetchLoans();
    } catch (err) {
      toast.error(apiError(err, 'Failed to submit loan review.'));
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'approved':
        return <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-brand-green/10 text-brand-green border border-brand-green/20 uppercase tracking-wider">Approved</span>;
      case 'rejected':
        return <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-brand-amber/10 text-brand-amber border border-brand-amber/20 uppercase tracking-wider">Rejected</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-brand-blue/10 text-brand-cyan border border-brand-blue/20 uppercase tracking-wider">Pending</span>;
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-brand-text font-display uppercase">Loans & Advances</h2>
          <p className="text-xs text-brand-text-soft mt-1">Submit salary advances or loans, and track monthly paycheck deduction schedules.</p>
        </div>
        
        <button
          onClick={() => setRequestModalOpen(true)}
          className="px-5 py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg hover:scale-[1.02] active:scale-[0.98] font-bold font-display text-xs transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-brand-blue/20"
        >
          <Plus className="w-4 h-4" />
          Request Cash
        </button>
      </div>

      {/* Tabs */}
      {isAdmin && (
        <div className="border-b border-brand-border flex gap-6">
          <button
            onClick={() => setActiveTab('my-loans')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
              activeTab === 'my-loans' ? 'border-brand-cyan text-brand-text' : 'border-transparent text-brand-text-soft hover:text-brand-text'
            }`}
          >
            Loan Registry Log
          </button>
          <button
            onClick={() => setActiveTab('reviews')}
            className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
              activeTab === 'reviews' ? 'border-brand-cyan text-brand-text' : 'border-transparent text-brand-text-soft hover:text-brand-text'
            }`}
          >
            Pending Reviews Panel
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-brand-cyan" />
        </div>
      ) : requests.length === 0 ? (
        <div className="p-8 text-center border border-dashed border-brand-border rounded-2xl">
          <p className="text-xs text-brand-text-soft">No loan or salary advance requests found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {requests.map(req => (
            <div key={req.id} className="p-5 rounded-2xl glass-panel space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[8px] font-extrabold border uppercase tracking-wider ${
                    req.type === 'loan'
                      ? 'bg-brand-blue/15 text-brand-cyan border-brand-blue/30'
                      : 'bg-brand-violet/15 text-brand-violet border-brand-violet/30'
                  }`}>
                    {req.type === 'loan' ? 'Long-term Loan' : 'Salary Advance'}
                  </span>
                  <p className="text-xl font-extrabold text-brand-text font-display mt-2.5 font-mono">
                    PKR {req.amount.toLocaleString()}
                  </p>
                </div>
                {getStatusBadge(req.status)}
              </div>

              {activeTab === 'reviews' && (
                <div className="flex items-center gap-2 pb-2 border-b border-brand-border">
                  <div className="w-6 h-6 rounded-full bg-brand-bg-soft flex items-center justify-center border border-brand-border">
                    <User className="w-3 h-3 text-brand-cyan" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-brand-text leading-none">{req.employee?.fullName}</p>
                    <p className="text-[8px] text-brand-text-mute mt-0.5">{req.employee?.employeeCode}</p>
                  </div>
                </div>
              )}

              {req.reason && <p className="text-xs text-brand-text-soft leading-relaxed italic">" {req.reason} "</p>}

              <div className="text-[9px] text-brand-text-mute font-extrabold uppercase tracking-wider space-y-1">
                <p>Submitted: {new Date(req.createdAt).toLocaleDateString()}</p>
                {req.status === 'approved' && (
                  <p className="text-brand-green">Repayment Month: {req.repaymentMonth}/{req.repaymentYear}</p>
                )}
              </div>

              {activeTab === 'reviews' && req.status === 'pending' && (
                <button
                  onClick={() => setReviewItem(req)}
                  className="w-full py-2 bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg text-[10px] uppercase font-extrabold tracking-wider font-display rounded-full transition-all cursor-pointer text-center"
                >
                  Review Request
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---------------- Request Modal ---------------- */}
      {requestModalOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setRequestModalOpen(false)} />
          <div className="bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 w-full max-w-md shadow-glow relative z-50 text-left">
            <div className="flex justify-between items-center border-b border-brand-border pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-brand-text uppercase font-display">Request Advance or Loan</h3>
              <button onClick={() => setRequestModalOpen(false)} className="p-1 rounded text-brand-text-soft hover:text-brand-text cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit(handleCreateRequest)} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Request Type</label>
                <select {...register('type', { required: true })} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer">
                  <option value="advance_salary">Salary Advance (Short Term)</option>
                  <option value="loan">Company Loan (Long Term)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Amount (PKR)</label>
                <input type="number" {...register('amount', { required: true })} placeholder="e.g. 20000" className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Reason / Justification</label>
                <textarea rows={3} {...register('reason', { required: true })} placeholder="Provide context..." className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none" />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow-md shadow-brand-blue/15">Submit Request</button>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- Review Loan Modal ---------------- */}
      {reviewItem && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setReviewItem(null)} />
          <div className="bg-brand-bg-elevated border border-brand-border rounded-2xl p-6 w-full max-w-md shadow-glow relative z-50 text-left">
            <div className="flex justify-between items-center border-b border-brand-border pb-3 mb-4">
              <h3 className="text-sm font-extrabold text-brand-text uppercase font-display">Review Request</h3>
              <button onClick={() => setReviewItem(null)} className="p-1 rounded text-brand-text-soft hover:text-brand-text cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleSubmit(handleReview)} className="space-y-4">
              <div className="p-3.5 bg-brand-bg border border-brand-border rounded-xl space-y-1.5 text-xs text-brand-text-soft">
                <p><span className="text-brand-text-mute">Applicant:</span> <span className="font-bold text-brand-text">{reviewItem.employee?.fullName}</span></p>
                <p><span className="text-brand-text-mute">Amount Requested:</span> <span className="font-extrabold text-brand-text font-mono">PKR {reviewItem.amount.toLocaleString()}</span></p>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Action Status</label>
                <select {...register('status', { required: true })} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer">
                  <option value="approved">Approve Request</option>
                  <option value="rejected">Reject Request</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Repayment Month</label>
                  <select {...register('repaymentMonth')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-brand-text-soft mb-1.5">Repayment Year</label>
                  <select {...register('repaymentYear')} className="w-full px-3.5 py-2.5 rounded-xl bg-brand-bg border border-brand-border text-xs text-brand-text focus:outline-none cursor-pointer">
                    <option value="2026">2026</option>
                    <option value="2027">2027</option>
                  </select>
                </div>
              </div>

              <button type="submit" className="w-full py-2.5 rounded-full bg-gradient-to-r from-brand-blue via-brand-violet to-brand-cyan text-brand-bg font-bold font-display text-xs cursor-pointer shadow-md shadow-brand-blue/15">Submit Review</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
