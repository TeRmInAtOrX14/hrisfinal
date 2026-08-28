import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Loader2, ShieldCheck, Eye, EyeOff, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';

import api, { session, apiError } from '../utils/api';

/**
 * First-login / voluntary password change.
 *
 * Accounts are created by an admin with a password that admin chose, and the
 * User model has carried `mustChangePassword` since the first migration — but
 * no endpoint and no screen ever let anyone change it, so every employee kept
 * using an admin-known password forever.
 */
export default function ChangePassword() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  const user = session.user;
  const forced = Boolean(user?.mustChangePassword);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm();

  const newPassword = watch('newPassword', '');

  const rules = [
    { label: 'At least 10 characters', ok: newPassword.length >= 10 },
    { label: 'Upper and lower case letters', ok: /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) },
    { label: 'At least one number', ok: /\d/.test(newPassword) },
  ];

  const onSubmit = async (data) => {
    try {
      setLoading(true);
      await api.post('/auth/change-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });

      // The server revokes the refresh token, so the session is intentionally
      // over — send the user back to sign in with the new password.
      session.clear();
      toast.success('Password changed. Please sign in again.');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(apiError(err, 'Could not change your password.'));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full pl-10 pr-11 py-3 rounded-xl border border-brand-border bg-brand-bg-soft text-sm text-brand-text placeholder-brand-text-mute focus:outline-none focus:border-brand-blue transition-colors';

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-4 relative overflow-hidden">
      <div className="glow-field opacity-40">
        <span className="g1" />
        <span className="g2" />
      </div>
      <div className="noise-grid absolute inset-0 z-0 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md p-8 rounded-2xl glass-panel shadow-glow relative z-10"
      >
        <div className="flex flex-col items-center mb-7 text-center">
          <div className="w-12 h-12 rounded-2xl bg-brand-blue/10 border border-brand-blue/25 flex items-center justify-center mb-4">
            <ShieldCheck className="w-6 h-6 text-brand-blue" />
          </div>
          <h1 className="text-lg font-extrabold text-brand-text font-display uppercase tracking-tight">
            {forced ? 'Set your own password' : 'Change password'}
          </h1>
          <p className="text-xs text-brand-text-soft mt-2 leading-relaxed">
            {forced
              ? 'Your account was created with a temporary password. Choose your own before continuing.'
              : 'Choose a new password for your account.'}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
              Current password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-mute" />
              <input
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                {...register('currentPassword', { required: 'Current password is required' })}
                className={inputClass}
              />
            </div>
            {errors.currentPassword && (
              <span className="text-xs text-brand-red mt-1.5 block">{errors.currentPassword.message}</span>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
              New password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-mute" />
              <input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                {...register('newPassword', {
                  required: 'A new password is required',
                  minLength: { value: 10, message: 'Must be at least 10 characters' },
                  validate: {
                    hasCase: (v) => (/[a-z]/.test(v) && /[A-Z]/.test(v)) || 'Include upper and lower case letters',
                    hasNumber: (v) => /\d/.test(v) || 'Include at least one number',
                  },
                })}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-text-mute hover:text-brand-text transition-colors cursor-pointer"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <ul className="mt-3 space-y-1.5">
              {rules.map((rule) => (
                <li
                  key={rule.label}
                  className={`text-[11px] flex items-center gap-2 transition-colors ${
                    rule.ok ? 'text-brand-green' : 'text-brand-text-mute'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      rule.ok ? 'bg-brand-green' : 'bg-brand-text-mute'
                    }`}
                  />
                  {rule.label}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
              Confirm new password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-mute" />
              <input
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                {...register('confirmPassword', {
                  required: 'Please confirm your new password',
                  validate: (v) => v === newPassword || 'Passwords do not match',
                })}
                className={inputClass}
              />
            </div>
            {errors.confirmPassword && (
              <span className="text-xs text-brand-red mt-1.5 block">{errors.confirmPassword.message}</span>
            )}
          </div>

          {(errors.newPassword) && (
            <p className="text-xs text-brand-red">{errors.newPassword.message}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 rounded-full font-bold font-display text-sm brandigade-gradient text-white hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-brand-blue/25"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Update password <ArrowRight className="w-4 h-4" /></>}
          </button>

          {!forced && (
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="w-full text-xs text-brand-text-soft hover:text-brand-text transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
        </form>
      </motion.div>
    </div>
  );
}
