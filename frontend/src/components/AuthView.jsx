/**
 * @fileoverview Authentication View Component (AuthView.jsx).
 *
 * Implements user authentication workflows including email/password sign-in,
 * registration with avatar color selection, Google OAuth 2.0 federation,
 * password reset requests, and secure token validation.
 *
 * @module components/AuthView
 */

import React, { useState, useEffect } from 'react';
import {
  loginUser,
  registerUser,
  googleLogin,
  getAuthConfig,
  requestPasswordReset,
  validateResetToken,
  resetPassword,
  validatePasswordApi,
  formatErrorMessage,
} from '../services/api';
import { Eye, EyeOff, Check, X, ArrowLeft, Lock, Mail, KeyRound, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';

const USER_COLORS = ['#1a73e8', '#1e8e3e', '#f9ab00', '#a142f4', '#e52592'];

/**
 * Authentication View component.
 *
 * @param {Object} props - Component properties.
 * @param {Function} props.onAuthSuccess - Callback invoked upon successful authentication.
 * @param {string} [props.initialResetToken] - Token parsed from query parameter for password reset.
 * @param {Function} [props.onClearResetToken] - Callback invoked to reset password reset state.
 * @returns {React.ReactElement} Authentication form container.
 */
export default function AuthView({ onAuthSuccess, initialResetToken, onClearResetToken }) {
  // Tabs: 'signin' | 'signup' | 'forgot' | 'reset'
  const [activeTab, setActiveTab] = useState(initialResetToken ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState(USER_COLORS[0]);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');

  // Password reset specific state
  const [resetToken, setResetToken] = useState(initialResetToken || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [tokenValidating, setTokenValidating] = useState(false);
  const [tokenValid, setTokenValid] = useState(false);
  const [resetTargetEmail, setResetTargetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  // NFR-16: HaveIBeenPwned live breach check states
  const [breachCheck, setBreachCheck] = useState({ checking: false, isPwned: false, breachCount: 0, checked: false, message: '' });
  const [resetBreachCheck, setResetBreachCheck] = useState({ checking: false, isPwned: false, breachCount: 0, checked: false, message: '' });

  // Theme state for pre-auth login view
  const [isLight, setIsLight] = useState(
    () => document.documentElement.classList.contains('light') || localStorage.getItem('collabide_theme') === 'light'
  );

  const toggleTheme = () => {
    const nextIsLight = !isLight;
    setIsLight(nextIsLight);
    if (nextIsLight) {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('collabide_theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('collabide_theme', 'vs-dark');
    }
  };

  // Fetch Google client ID from backend
  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await getAuthConfig();
        setGoogleClientId(config.googleClientId);
      } catch (err) {
        console.warn('Failed to load auth config:', err);
      }
    }
    loadConfig();
  }, []);

  // Validate reset token if provided
  useEffect(() => {
    if (initialResetToken) {
      setResetToken(initialResetToken);
      setActiveTab('reset');
      validateToken(initialResetToken);
    }
  }, [initialResetToken]);

  const validateToken = async (token) => {
    try {
      setTokenValidating(true);
      setError('');
      const data = await validateResetToken(token);
      if (data.valid) {
        setTokenValid(true);
        setResetTargetEmail(data.email || '');
      } else {
        setTokenValid(false);
        setError(data.message || 'Invalid or expired password reset link.');
      }
    } catch (err) {
      setTokenValid(false);
      setError(formatErrorMessage(err, 'Invalid or expired reset link. Reset links expire after 30 minutes.'));
    } finally {
      setTokenValidating(false);
    }
  };

  const handleGoogleSignIn = () => {
    if (!googleClientId) {
      setError('Google configuration is not loaded yet. Please try again.');
      return;
    }

    if (!window.google) {
      setError('Google Sign-In is unavailable. Please check your internet connection or ad blocker.');
      return;
    }

    try {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'openid email profile',
        callback: async (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            setLoading(true);
            setError('');
            try {
              const data = await googleLogin(tokenResponse.access_token);
              onAuthSuccess(data.user);
            } catch (err) {
              setError(formatErrorMessage(err, 'Google authentication failed. Please try again.'));
            } finally {
              setLoading(false);
            }
          }
        },
        error_callback: (err) => {
          if (err && (err.type === 'popup_closed' || err.error === 'popup_closed_by_user')) {
            setError('Google sign-in window was closed. Please try again.');
          } else {
            setError('Unable to sign in with Google. Please try again.');
          }
        },
      });
      client.requestAccessToken();
    } catch (err) {
      setError('Unable to initialize Google sign-in. Please try again.');
    }
  };

  // Sign In / Sign Up Submit
  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (activeTab === 'signin') {
      setLoading(true);
      try {
        const data = await loginUser({ email, password });
        onAuthSuccess(data.user);
      } catch (err) {
        setError(formatErrorMessage(err, 'Authentication failed. Please check your credentials and try again.'));
      } finally {
        setLoading(false);
      }
    } else {
      if (!displayName) {
        setError('Display name is required for registration.');
        return;
      }
      if (!signupComplexityValid) {
        setError('Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (breachCheck.isPwned) {
        setError(breachCheck.message || 'This password was found in a known data breach and cannot be used per security policy (NFR-16).');
        return;
      }

      setLoading(true);
      try {
        const data = await registerUser({ email, password, displayName, avatarColor });
        setMessage(data.message + ' (Check backend logs for verification link)');
        setActiveTab('signin');
        setPassword('');
        setConfirmPassword('');
        setBreachCheck({ checking: false, isPwned: false, breachCount: 0, checked: false, message: '' });
      } catch (err) {
        setError(formatErrorMessage(err, 'Registration failed. Please try again.'));
      } finally {
        setLoading(false);
      }
    }
  };

  // Forgot Password Request Submit (FR-09)
  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setError('');
    setMessage('');
    setLoading(true);

    try {
      const res = await requestPasswordReset(email.trim().toLowerCase());
      setMessage(
        res.message ||
          'If the email matches a registered account, a password reset link has been dispatched (and logged in the backend console).'
      );
    } catch (err) {
      setError(formatErrorMessage(err, 'Failed to request password reset. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  // Reset Password Execution Submit (FR-09)
  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!newPassword || !confirmPassword) {
      setError('Please fill in both password fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
    if (!PASSWORD_REGEX.test(newPassword)) {
      setError(
        'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character.'
      );
      return;
    }

    if (resetBreachCheck.isPwned) {
      setError(resetBreachCheck.message || 'This password was found in a known data breach and cannot be used per security policy (NFR-16).');
      return;
    }

    setLoading(true);

    try {
      const res = await resetPassword({ token: resetToken, newPassword });
      setResetSuccess(true);
      setMessage(res.message || 'Password has been reset successfully. All active sessions have been revoked.');
      onClearResetToken?.();

      // Clear sensitive form state
      setNewPassword('');
      setConfirmPassword('');
      setResetBreachCheck({ checking: false, isPwned: false, breachCount: 0, checked: false, message: '' });
    } catch (err) {
      setError(formatErrorMessage(err, 'Failed to reset password. The link may have expired or already been used.'));
    } finally {
      setLoading(false);
    }
  };

  // Password complexity checks for Sign Up (NFR-16)
  const signupHasLength = password.length >= 8;
  const signupHasUpper = /[A-Z]/.test(password);
  const signupHasLower = /[a-z]/.test(password);
  const signupHasNumber = /\d/.test(password);
  const signupHasSpecial = /[^A-Za-z0-9]/.test(password);
  const signupPasswordsMatch = password.length > 0 && password === confirmPassword;
  const signupComplexityValid = signupHasLength && signupHasUpper && signupHasLower && signupHasNumber && signupHasSpecial;

  // Password complexity checks for Reset Password (NFR-16)
  const hasLength = newPassword.length >= 8;
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const resetComplexityValid = hasLength && hasUpper && hasLower && hasNumber && hasSpecial;

  // Live HaveIBeenPwned breach check for Sign Up password (NFR-16)
  useEffect(() => {
    if (activeTab !== 'signup' || !signupComplexityValid) {
      setBreachCheck({ checking: false, isPwned: false, breachCount: 0, checked: false, message: '' });
      return;
    }

    const timer = setTimeout(async () => {
      setBreachCheck((prev) => ({ ...prev, checking: true }));
      try {
        const res = await validatePasswordApi(password);
        setBreachCheck({
          checking: false,
          isPwned: !!res.isPwned,
          breachCount: res.breachCount || 0,
          checked: true,
          message: res.message || '',
        });
      } catch (err) {
        setBreachCheck({ checking: false, isPwned: false, breachCount: 0, checked: false, message: '' });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [activeTab, password, signupComplexityValid]);

  // Live HaveIBeenPwned breach check for Reset password (NFR-16)
  useEffect(() => {
    if (activeTab !== 'reset' || !resetComplexityValid) {
      setResetBreachCheck({ checking: false, isPwned: false, breachCount: 0, checked: false, message: '' });
      return;
    }

    const timer = setTimeout(async () => {
      setResetBreachCheck((prev) => ({ ...prev, checking: true }));
      try {
        const res = await validatePasswordApi(newPassword);
        setResetBreachCheck({
          checking: false,
          isPwned: !!res.isPwned,
          breachCount: res.breachCount || 0,
          checked: true,
          message: res.message || '',
        });
      } catch (err) {
        setResetBreachCheck({ checking: false, isPwned: false, breachCount: 0, checked: false, message: '' });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [activeTab, newPassword, resetComplexityValid]);

  return (
    <div className="bg-[#0d0e0f] text-[#e3e2e3] font-ui text-[13px] h-screen flex overflow-hidden w-full">
      {/* Left Side: Hero Section */}
      <section className="hidden lg:flex w-1/2 bg-[#0d0e0f] p-8 flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <img
            alt="Background Pattern"
            className="w-full h-full object-cover grayscale"
            src="https://lh3.googleusercontent.com/aida/AP1WRLv9qWf1XDlcw4ubvHO07TFEEDuJXFaVKbthxEN2QPbSm3zoYaNLjxl3F8SCkxjy2UUyLB3K9pXwKoIq8ngDndHF6pI-TTenwEiDCChXUY-myS_Le_BP9fAJCq8pMFu8ou75st7Ktlih8CYAXei-JiU_ngDf4oRALrGdH6eoyxa3NH7jRvKz1EZHGZvDDREd_YKYWljEInpge4INo9bzqTvI16qONknUQbWbmAO16_aVXXemJuzhwhc0HmTn"
          />
        </div>
        <div className="relative z-10 max-w-md my-auto xl:ml-16">
          <h1 className="text-[36px] font-semibold text-[#e3e2e2] leading-tight mb-4">
            Code together, <br />in real time.
          </h1>
          <p className="text-[#c0c7d3] text-[16px] leading-relaxed mb-12">
            A collaborative IDE with live editing, voice chat, and instant code execution.
          </p>

          <div className="space-y-8">
            <div className="flex items-start space-x-4 group">
              <div className="mt-1 w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#1f2021] border border-[#404751] text-[#9fcaff] group-hover:border-[#9fcaff] transition-colors">
                <span className="material-symbols-outlined">sync_alt</span>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-[#e3e2e3]">Real-time sync</h3>
                <p className="text-[13px] text-[#c0c7d3]">
                  Sub-millisecond latency updates across all connected clients.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-4 group">
              <div className="mt-1 w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#1f2021] border border-[#404751] text-[#9fcaff] group-hover:border-[#9fcaff] transition-colors">
                <span className="material-symbols-outlined">mic</span>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-[#e3e2e3]">Voice chat</h3>
                <p className="text-[13px] text-[#c0c7d3]">Built-in spatial audio for seamless team communication.</p>
              </div>
            </div>
            <div className="flex items-start space-x-4 group">
              <div className="mt-1 w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-[#1f2021] border border-[#404751] text-[#9fcaff] group-hover:border-[#9fcaff] transition-colors">
                <span className="material-symbols-outlined">terminal</span>
              </div>
              <div>
                <h3 className="text-[14px] font-medium text-[#e3e2e3]">Code execution</h3>
                <p className="text-[13px] text-[#c0c7d3]">
                  Secure sandboxed runtime for over 25+ programming languages.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="relative z-10 xl:ml-16">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[#8a919d]/50">
            BAHRIA UNIVERSITY FYP · BSE 2026
          </p>
        </div>
      </section>

      {/* Right Side: Auth Card Section */}
      <section className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#121314] relative">
        <button
          onClick={toggleTheme}
          type="button"
          className="absolute top-6 right-6 p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-[#252626] transition-colors"
          title={`Switch to ${isLight ? 'Dark' : 'Light'} Mode`}
        >
          {isLight ? (
            <span className="material-symbols-outlined text-[20px] text-amber-500">light_mode</span>
          ) : (
            <span className="material-symbols-outlined text-[20px]">dark_mode</span>
          )}
        </button>

        <div className="w-full max-w-[440px] bg-[#1b1c1c] border border-[#404751] rounded-lg p-10 shadow-xl overflow-y-auto max-h-[92vh]">
          {/* Logo */}
          <div
            className="flex items-center justify-center space-x-2 mb-8 cursor-pointer select-none"
            onClick={() => {
              setActiveTab('signin');
              setError('');
              setMessage('');
              onClearResetToken?.();
            }}
          >
            <img src={isLight ? '/logo-light.png' : '/logo.png'} alt="CollabIDE Logo" className="h-12 object-contain app-logo" />
          </div>

          {/* Tab Switcher (Visible in Signin / Signup mode) */}
          {(activeTab === 'signin' || activeTab === 'signup') && (
            <div className="flex border-b border-[#404751] mb-8">
              <button
                type="button"
                className={`flex-1 pb-4 text-[14px] font-medium transition-all border-b-2 ${
                  activeTab === 'signin'
                    ? 'text-[#9fcaff] border-[#9fcaff]'
                    : 'text-[#c0c7d3] border-transparent hover:text-[#e3e2e3]'
                }`}
                onClick={() => {
                  setActiveTab('signin');
                  setError('');
                  setMessage('');
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`flex-1 pb-4 text-[14px] font-medium transition-all border-b-2 ${
                  activeTab === 'signup'
                    ? 'text-[#9fcaff] border-[#9fcaff]'
                    : 'text-[#c0c7d3] border-transparent hover:text-[#e3e2e3]'
                }`}
                onClick={() => {
                  setActiveTab('signup');
                  setError('');
                  setMessage('');
                }}
              >
                Create account
              </button>
            </div>
          )}

          {/* Header for Forgot Password */}
          {activeTab === 'forgot' && (
            <div className="mb-6 space-y-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('signin');
                  setError('');
                  setMessage('');
                }}
                className="inline-flex items-center gap-1.5 text-xs text-[#9fcaff] hover:underline mb-2"
              >
                <ArrowLeft size={14} />
                Back to Sign in
              </button>
              <h2 className="text-[20px] font-semibold text-[#e3e2e2]">Reset your password</h2>
              <p className="text-[13px] text-[#c0c7d3] leading-relaxed">
                Enter your account email below. We will send a single-use reset link valid for <strong>30 minutes</strong>.
              </p>
            </div>
          )}

          {/* Header for Reset Password */}
          {activeTab === 'reset' && (
            <div className="mb-6 space-y-2">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-[#007acc]/10 border border-[#007acc]/30 text-[#9fcaff] text-xs font-mono mb-1">
                <KeyRound size={13} />
                Single-Use Reset Link (30m)
              </div>
              <h2 className="text-[20px] font-semibold text-[#e3e2e2]">Set new password</h2>
              {resetTargetEmail ? (
                <p className="text-[13px] text-[#c0c7d3]">
                  Resetting credentials for account: <strong className="text-white font-mono">{resetTargetEmail}</strong>
                </p>
              ) : (
                <p className="text-[13px] text-[#c0c7d3] leading-relaxed">
                  Enter your new password below. All existing active sessions will be revoked for security.
                </p>
              )}
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="mb-5 p-3 bg-red-950/40 border border-[#d93025]/30 rounded-lg text-[#d93025] text-[13px] flex items-start space-x-2 animate-in fade-in">
              <span className="material-symbols-outlined text-[18px] mt-0.5">error</span>
              <span className="flex-1 leading-snug">{error}</span>
            </div>
          )}

          {/* Success Banner */}
          {message && (
            <div className="mb-5 p-3 bg-green-950/40 border border-[#1e8e3e]/30 rounded-lg text-[#1e8e3e] text-[13px] flex items-start space-x-2 animate-in fade-in">
              <span className="material-symbols-outlined text-[18px] mt-0.5">check_circle</span>
              <span className="flex-1 leading-snug">{message}</span>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VIEW 1: SIGN IN & SIGN UP FORMS
             ───────────────────────────────────────────────────────────── */}
          {(activeTab === 'signin' || activeTab === 'signup') && (
            <form className="space-y-6" onSubmit={handleAuthSubmit}>
              <div className="space-y-2">
                <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="email">
                  Email Address
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">
                    mail
                  </span>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dev@collabide.io"
                    className="w-full h-11 bg-[#0d0e0f] border border-[#404751] rounded-lg pl-10 pr-4 text-[13px] text-[#e3e2e3] placeholder:text-[#8a919d]/40 transition-all focus:border-[#9fcaff] focus:outline-none focus:ring-1 focus:ring-[#9fcaff]/50"
                  />
                </div>
              </div>

              {activeTab === 'signup' && (
                <>
                  <div className="space-y-2">
                    <label
                      className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]"
                      htmlFor="displayName"
                    >
                      Display Name
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">
                        person
                      </span>
                      <input
                        id="displayName"
                        type="text"
                        required
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="e.g. John Doe"
                        className="w-full h-11 bg-[#0d0e0f] border border-[#404751] rounded-lg pl-10 pr-4 text-[13px] text-[#e3e2e3] placeholder:text-[#8a919d]/40 transition-all focus:border-[#9fcaff] focus:outline-none focus:ring-1 focus:ring-[#9fcaff]/50"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]">
                      Choose Avatar Color
                    </label>
                    <div className="flex gap-2.5">
                      {USER_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`w-6 h-6 rounded-full transition-all border ${
                            avatarColor === color
                              ? 'ring-2 ring-border-active border-transparent'
                              : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => setAvatarColor(color)}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="password">
                    Password
                  </label>
                  {activeTab === 'signin' && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('forgot');
                        setError('');
                        setMessage('');
                      }}
                      className="text-[11px] font-medium text-[#9fcaff] hover:underline bg-transparent border-none p-0 cursor-pointer"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">
                    lock
                  </span>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 bg-[#0d0e0f] border border-[#404751] rounded-lg pl-10 pr-12 text-[13px] text-[#e3e2e3] placeholder:text-[#8a919d]/40 transition-all focus:border-[#9fcaff] focus:outline-none focus:ring-1 focus:ring-[#9fcaff]/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a919d] hover:text-[#9fcaff] transition-colors flex items-center justify-center"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {activeTab === 'signup' && (
                <>
                  {/* Confirm Password Field */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="signupConfirmPassword">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">
                        lock_reset
                      </span>
                      <input
                        id="signupConfirmPassword"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full h-11 bg-[#0d0e0f] border border-[#404751] rounded-lg pl-10 pr-12 text-[13px] text-[#e3e2e3] placeholder:text-[#8a919d]/40 transition-all focus:border-[#9fcaff] focus:outline-none focus:ring-1 focus:ring-[#9fcaff]/50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a919d] hover:text-[#9fcaff] transition-colors flex items-center justify-center"
                      >
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Live Password Complexity Checklist (NFR-16) */}
                  <div className="p-3 bg-[#0d0e0f] border border-[#2b2b2b] rounded-lg space-y-1.5 text-[11px]">
                    <div className="font-semibold text-[#8a919d] uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span>Password Requirements (NFR-16)</span>
                      {breachCheck.checking && (
                        <span className="text-[10px] text-[#9fcaff] flex items-center gap-1 font-normal lowercase">
                          <Loader2 size={11} className="animate-spin" /> checking breach db…
                        </span>
                      )}
                    </div>
                    <div className={`flex items-center gap-2 ${signupHasLength ? 'text-accent-green' : 'text-text-muted'}`}>
                      {signupHasLength ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>At least 8 characters</span>
                    </div>
                    <div className={`flex items-center gap-2 ${signupHasUpper ? 'text-accent-green' : 'text-text-muted'}`}>
                      {signupHasUpper ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>One uppercase letter (A-Z)</span>
                    </div>
                    <div className={`flex items-center gap-2 ${signupHasLower ? 'text-accent-green' : 'text-text-muted'}`}>
                      {signupHasLower ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>One lowercase letter (a-z)</span>
                    </div>
                    <div className={`flex items-center gap-2 ${signupHasNumber ? 'text-accent-green' : 'text-text-muted'}`}>
                      {signupHasNumber ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>One number (0-9)</span>
                    </div>
                    <div className={`flex items-center gap-2 ${signupHasSpecial ? 'text-accent-green' : 'text-text-muted'}`}>
                      {signupHasSpecial ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>One special character (!@#$%^&*)</span>
                    </div>
                    <div className={`flex items-center gap-2 ${signupPasswordsMatch ? 'text-accent-green' : 'text-text-muted'}`}>
                      {signupPasswordsMatch ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>Passwords match</span>
                    </div>

                    {/* HaveIBeenPwned Result */}
                    {breachCheck.checked && (
                      <div className={`mt-2 p-2 rounded-md flex items-start gap-2 border text-[11px] ${
                        breachCheck.isPwned
                          ? 'bg-red-950/40 border-red-500/40 text-accent-red'
                          : 'bg-emerald-950/30 border-emerald-500/40 text-accent-green'
                      }`}>
                        {breachCheck.isPwned ? (
                          <>
                            <ShieldAlert size={15} className="shrink-0 mt-0.5 text-accent-red" />
                            <div>
                              <p className="font-semibold">Compromised Password Detected</p>
                              <p className="text-[10px] opacity-90 leading-tight">
                                Found in {breachCheck.breachCount.toLocaleString()} known data breaches (HaveIBeenPwned). Please choose a different password.
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={15} className="shrink-0 mt-0.5 text-accent-green" />
                            <span className="leading-tight">Password not found in known data breaches (HaveIBeenPwned verified).</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={
                  loading ||
                  (activeTab === 'signup' && (!signupComplexityValid || !signupPasswordsMatch || breachCheck.isPwned || breachCheck.checking))
                }
                className="w-full h-12 bg-[#007acc] hover:bg-[#007acc]/90 text-white font-medium text-[14px] rounded-lg flex items-center justify-center group transition-all active:scale-[0.98] mt-2 shadow-lg shadow-[#007acc]/20 disabled:opacity-50"
              >
                <span>{loading ? 'Processing...' : activeTab === 'signin' ? 'Sign In' : 'Create Account'}</span>
                {!loading && activeTab === 'signin' && (
                  <span className="material-symbols-outlined ml-2 text-[20px] group-hover:translate-x-1 transition-transform">
                    arrow_forward
                  </span>
                )}
              </button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-[#404751]/50"></div>
                </div>
                <div className="relative flex justify-center text-[11px] font-medium uppercase tracking-widest">
                  <span className="bg-[#1b1c1c] px-4 text-[#8a919d]/60">Or continue with</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full h-11 border border-[#404751] bg-transparent hover:bg-[#292a2b] transition-colors rounded-lg flex items-center justify-center space-x-3"
              >
                <img
                  src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png"
                  alt="Google Logo"
                  className="w-5 h-5 object-contain"
                />
                <span className="text-[14px] font-medium text-[#e3e2e3]">Continue with Google</span>
              </button>
            </form>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VIEW 2: FORGOT PASSWORD FORM (FR-09)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'forgot' && (
            <form className="space-y-6" onSubmit={handleForgotSubmit}>
              <div className="space-y-2">
                <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="forgotEmail">
                  Account Email Address
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">
                    mail
                  </span>
                  <input
                    id="forgotEmail"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="dev@collabide.io"
                    className="w-full h-11 bg-[#0d0e0f] border border-[#404751] rounded-lg pl-10 pr-4 text-[13px] text-[#e3e2e3] placeholder:text-[#8a919d]/40 transition-all focus:border-[#9fcaff] focus:outline-none focus:ring-1 focus:ring-[#9fcaff]/50"
                  />
                </div>
                <p className="text-[11px] text-[#8a919d] leading-relaxed">
                  A cryptographically signed, single-use reset link will be sent to this email (or printed to the local backend terminal).
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-[#007acc] hover:bg-[#007acc]/90 text-white font-medium text-[14px] rounded-lg flex items-center justify-center transition-all active:scale-[0.98] shadow-lg shadow-[#007acc]/20 disabled:opacity-50"
              >
                <span>{loading ? 'Sending link...' : 'Send Password Reset Link'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('signin');
                  setError('');
                  setMessage('');
                }}
                className="w-full h-11 border border-[#404751] bg-transparent hover:bg-[#292a2b] transition-colors rounded-lg flex items-center justify-center text-[13px] text-[#c0c7d3] hover:text-white"
              >
                Cancel and return to Sign In
              </button>
            </form>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VIEW 3: SET NEW PASSWORD FORM (FR-09)
             ───────────────────────────────────────────────────────────── */}
          {activeTab === 'reset' && (
            <div>
              {tokenValidating ? (
                <div className="py-12 flex flex-col items-center justify-center space-y-3">
                  <div className="w-8 h-8 border-2 border-[#007acc] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-[#8a919d]">Verifying reset token...</p>
                </div>
              ) : resetSuccess ? (
                <div className="space-y-6 text-center py-4">
                  <div className="w-16 h-16 mx-auto rounded-full bg-emerald-950/40 border border-[#1e8e3e] flex items-center justify-center text-[#1e8e3e]">
                    <Check size={32} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white">Password Updated</h3>
                    <p className="text-xs text-[#c0c7d3] mt-1 leading-relaxed">
                      Your password has been changed. All active sessions have been revoked per FR-09 security requirements.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('signin');
                      setError('');
                      setMessage('');
                      setResetSuccess(false);
                    }}
                    className="w-full h-11 bg-[#007acc] hover:bg-[#007acc]/90 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Sign in with new password
                  </button>
                </div>
              ) : !tokenValid && error ? (
                <div className="space-y-4 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('forgot');
                      setError('');
                      setMessage('');
                    }}
                    className="w-full h-11 bg-[#007acc] hover:bg-[#007acc]/90 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Request a new password reset link
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('signin');
                      setError('');
                      setMessage('');
                    }}
                    className="w-full h-10 border border-[#404751] hover:bg-[#252626] rounded-lg text-xs text-[#c0c7d3] transition-colors"
                  >
                    Back to Sign In
                  </button>
                </div>
              ) : (
                <form className="space-y-5" onSubmit={handleResetSubmit}>
                  {/* New Password */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="newPassword">
                      New Password
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">
                        lock
                      </span>
                      <input
                        id="newPassword"
                        type={showNewPassword ? 'text' : 'password'}
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full h-11 bg-[#0d0e0f] border border-[#404751] rounded-lg pl-10 pr-12 text-[13px] text-[#e3e2e3] placeholder:text-[#8a919d]/40 transition-all focus:border-[#9fcaff] focus:outline-none focus:ring-1 focus:ring-[#9fcaff]/50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a919d] hover:text-[#9fcaff] transition-colors flex items-center justify-center"
                      >
                        {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="confirmPassword">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">
                        lock_reset
                      </span>
                      <input
                        id="confirmPassword"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full h-11 bg-[#0d0e0f] border border-[#404751] rounded-lg pl-10 pr-12 text-[13px] text-[#e3e2e3] placeholder:text-[#8a919d]/40 transition-all focus:border-[#9fcaff] focus:outline-none focus:ring-1 focus:ring-[#9fcaff]/50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a919d] hover:text-[#9fcaff] transition-colors flex items-center justify-center"
                      >
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Live Password Complexity Checklist (FR-01 / FR-09 / NFR-16) */}
                  <div className="p-3 bg-[#0d0e0f] border border-[#2b2b2b] rounded-lg space-y-1.5 text-[11px]">
                    <div className="font-semibold text-[#8a919d] uppercase tracking-wider mb-1 flex items-center justify-between">
                      <span>Password Requirements (NFR-16)</span>
                      {resetBreachCheck.checking && (
                        <span className="text-[10px] text-[#9fcaff] flex items-center gap-1 font-normal lowercase">
                          <Loader2 size={11} className="animate-spin" /> checking breach db…
                        </span>
                      )}
                    </div>
                    <div className={`flex items-center gap-2 ${hasLength ? 'text-accent-green' : 'text-text-muted'}`}>
                      {hasLength ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>At least 8 characters</span>
                    </div>
                    <div className={`flex items-center gap-2 ${hasUpper ? 'text-accent-green' : 'text-text-muted'}`}>
                      {hasUpper ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>One uppercase letter (A-Z)</span>
                    </div>
                    <div className={`flex items-center gap-2 ${hasLower ? 'text-accent-green' : 'text-text-muted'}`}>
                      {hasLower ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>One lowercase letter (a-z)</span>
                    </div>
                    <div className={`flex items-center gap-2 ${hasNumber ? 'text-accent-green' : 'text-text-muted'}`}>
                      {hasNumber ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>One number (0-9)</span>
                    </div>
                    <div className={`flex items-center gap-2 ${hasSpecial ? 'text-accent-green' : 'text-text-muted'}`}>
                      {hasSpecial ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>One special character (!@#$%^&*)</span>
                    </div>
                    <div className={`flex items-center gap-2 ${passwordsMatch ? 'text-accent-green' : 'text-text-muted'}`}>
                      {passwordsMatch ? <Check size={13} /> : <span className="w-3.5 inline-block text-center">•</span>}
                      <span>Passwords match</span>
                    </div>

                    {/* HaveIBeenPwned Result */}
                    {resetBreachCheck.checked && (
                      <div className={`mt-2 p-2 rounded-md flex items-start gap-2 border text-[11px] ${
                        resetBreachCheck.isPwned
                          ? 'bg-red-950/40 border-red-500/40 text-accent-red'
                          : 'bg-emerald-950/30 border-emerald-500/40 text-accent-green'
                      }`}>
                        {resetBreachCheck.isPwned ? (
                          <>
                            <ShieldAlert size={15} className="shrink-0 mt-0.5 text-accent-red" />
                            <div>
                              <p className="font-semibold">Compromised Password Detected</p>
                              <p className="text-[10px] opacity-90 leading-tight">
                                Found in {resetBreachCheck.breachCount.toLocaleString()} known data breaches (HaveIBeenPwned). Please choose a different password.
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={15} className="shrink-0 mt-0.5 text-accent-green" />
                            <span className="leading-tight">Password not found in known data breaches (HaveIBeenPwned verified).</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={
                      loading ||
                      !hasLength ||
                      !hasUpper ||
                      !hasLower ||
                      !hasNumber ||
                      !hasSpecial ||
                      !passwordsMatch ||
                      resetBreachCheck.isPwned ||
                      resetBreachCheck.checking
                    }
                    className="w-full h-12 bg-[#007acc] hover:bg-[#007acc]/90 text-white font-medium text-[14px] rounded-lg flex items-center justify-center transition-all active:scale-[0.98] shadow-lg shadow-[#007acc]/20 disabled:opacity-50"
                  >
                    <span>{loading ? 'Updating Password...' : 'Reset Password & Invalidate Sessions'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('signin');
                      setError('');
                      setMessage('');
                      onClearResetToken?.();
                    }}
                    className="w-full h-10 border border-[#404751] hover:bg-[#252626] rounded-lg text-xs text-[#c0c7d3] transition-colors"
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
