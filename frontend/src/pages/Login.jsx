import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, Mail, Loader2, ArrowRight, Sun, Moon, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { GoogleLogin } from '@react-oauth/google';

import api, { session, apiError } from '../utils/api';
import { useTheme } from '../utils/themeContext';

export default function Login() {
  const { isDark, toggleTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ defaultValues: { email: '', password: '' } });

  useEffect(() => {
    if (session.accessToken) navigate('/dashboard', { replace: true });
  }, [navigate]);

  // Explain why the user landed back here instead of silently showing the form.
  useEffect(() => {
    if (searchParams.get('reason') === 'session-expired') {
      toast('Your session expired. Please sign in again.', { icon: '🔒' });
    }
  }, [searchParams]);

  const completeLogin = (data) => {
    session.save(data);
    toast.success('Welcome to Brandigade HRIS');
    navigate(data.user?.mustChangePassword ? '/change-password' : '/dashboard', { replace: true });
  };

  const onSubmit = async (values) => {
    try {
      setLoading(true);
      const res = await api.post('/auth/login', values);
      completeLogin(res.data);
    } catch (err) {
      toast.error(apiError(err, 'Invalid credentials or inactive account.'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Google sign-in.
   *
   * This used to use the implicit `useGoogleLogin` flow: it fetched the profile
   * from Google in the browser and POSTed the resulting *email* to the server,
   * which trusted it. We now use the ID-token flow and send only the signed
   * credential, which the server verifies against our own client ID.
   */
  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      setGoogleLoading(true);
      const res = await api.post('/auth/google-login', {
        idToken: credentialResponse.credential,
      });
      completeLogin(res.data);
    } catch (err) {
      toast.error(apiError(err, 'Google sign-in failed. Make sure your account has access.'));
    } finally {
      setGoogleLoading(false);
    }
  };

  const busy = loading || googleLoading;
  const inputClass =
    'w-full pl-10 pr-11 py-3 rounded-xl border border-brand-border bg-brand-bg-soft text-sm text-brand-text placeholder-brand-text-mute focus:outline-none focus:border-brand-blue transition-colors';

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg px-4 relative overflow-hidden">
      <div className="absolute top-6 right-6 z-50">
        <button
          onClick={toggleTheme}
          className="p-2.5 rounded-xl border border-brand-border text-brand-text-soft hover:text-brand-text hover:border-brand-border-strong transition-all duration-300 cursor-pointer flex items-center justify-center hover:scale-105 active:scale-95 bg-brand-bg-elevated/40 backdrop-blur-md"
          aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {isDark ? <Sun className="w-4 h-4 text-brand-amber" /> : <Moon className="w-4 h-4 text-brand-blue" />}
        </button>
      </div>

      <div className="glow-field">
        <span className="g1" />
        <span className="g2" />
      </div>
      <div className="noise-grid absolute inset-0 z-0 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-md p-8 rounded-2xl glass-panel shadow-glow relative z-10"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-3 mb-2">
            <img src="/logo.png" alt="Brandigade" className="h-20 w-auto object-contain" />
            <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest bg-brand-blue text-white rounded">
              HRIS
            </span>
          </div>
          <p className="text-xs text-brand-text-soft font-display uppercase tracking-wider font-bold">
            Enterprise Intelligence Portal
          </p>
        </div>

        <div className="flex justify-center mb-6 min-h-[44px] items-center">
          {googleLoading ? (
            <div className="flex items-center gap-2 text-xs text-brand-text-soft">
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in…
            </div>
          ) : (
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => toast.error('Google sign-in was cancelled or failed.')}
              theme={isDark ? 'filled_black' : 'outline'}
              shape="pill"
              width="320"
              text="continue_with"
            />
          )}
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-brand-border" />
          <span className="text-xs text-brand-text-mute uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-brand-border" />
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <div>
            <label htmlFor="email" className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
              Email address
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-mute" />
              <input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="name@brandigade.com"
                {...register('email', {
                  required: 'Email is required',
                  pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' },
                })}
                className={inputClass}
              />
            </div>
            {errors.email && <span className="text-xs text-brand-red mt-1.5 block">{errors.email.message}</span>}
          </div>

          <div>
            <label htmlFor="password" className="block text-[10px] font-bold uppercase tracking-wider text-brand-text-soft mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-mute" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                {...register('password', { required: 'Password is required' })}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-text-mute hover:text-brand-text transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {errors.password && (
              <span className="text-xs text-brand-red mt-1.5 block">{errors.password.message}</span>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 px-4 rounded-full font-bold font-display text-sm brandigade-gradient text-white hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer group shadow-lg shadow-brand-blue/25"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Sign in to workspace
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </form>

        <p className="text-[10px] text-brand-text-mute text-center mt-6 leading-relaxed">
          Trouble signing in? Contact your HR administrator.
        </p>
      </motion.div>
    </div>
  );
}
