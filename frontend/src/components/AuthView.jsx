import React, { useState, useEffect } from 'react';
import { loginUser, registerUser, checkEmail, googleLogin, getAuthConfig } from '../services/api';

const USER_COLORS = ['#1a73e8', '#1e8e3e', '#f9ab00', '#a142f4', '#e52592'];

export default function AuthView({ onAuthSuccess }) {
  const [step, setStep] = useState('email'); // 'email' or 'auth'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState(USER_COLORS[0]);
  const [showPassword, setShowPassword] = useState(false);
  const [isExistingUser, setIsExistingUser] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');

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
              setError(err.message || 'Google authentication failed');
            } finally {
              setLoading(false);
            }
          }
        },
        error_callback: (err) => {
          setError('Google popup error: ' + (err.message || err.error));
        }
      });
      client.requestAccessToken();
    } catch (err) {
      setError('Failed to initialize Google login: ' + err.message);
    }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;

    setError('');
    setMessage('');
    setLoading(true);

    try {
      const res = await checkEmail(email);
      if (res.exists) {
        setIsExistingUser(true);
        if (res.isGoogleUser && !res.isLocalUser) {
          setError('This email is registered with Google. Please use "Continue with Google".');
          setLoading(false);
          return;
        }
      } else {
        setIsExistingUser(false);
      }
      setStep('auth');
    } catch (err) {
      setError(err.message || 'Failed to check email');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isExistingUser) {
        // Login
        const data = await loginUser({ email, password });
        onAuthSuccess(data.user);
      } else {
        // Register
        if (!displayName) {
          setError('Display name is required for registration.');
          setLoading(false);
          return;
        }
        const data = await registerUser({ email, password, displayName, avatarColor });
        setMessage(data.message + ' (Check backend logs for verification link)');
        setIsExistingUser(true);
        setStep('auth');
        setPassword('');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  // Password strength checker helper
  const getPasswordStrength = () => {
    if (!password) return 0;
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[^A-Za-z0-9]/.test(password)) strength++;
    return strength;
  };

  const strength = getPasswordStrength();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full bg-bg-base text-text-primary font-ui px-4 py-12 overflow-y-auto">
      
      {/* Header Section */}
      <header className="flex flex-col items-center text-center select-none max-w-[600px] mb-8">
        <div className="flex items-center space-x-2 mb-6 cursor-pointer" onClick={() => window.location.reload()}>
          <img src="/logo.png" className="h-16 object-contain" alt="CollabIDE Logo" />
        </div>
        <h1 className="font-semibold text-text-2xl text-on-surface mb-2">
          Sign in to CollabIDE
        </h1>
        <p className="text-text-base text-text-secondary max-w-[420px]">
          Your collaborative partner for big coding ambitions
        </p>
      </header>

      {/* Auth Card Container */}
      <main className="w-full max-w-[400px]">
        <div className="bg-[#1b1c1c] border border-border-default rounded-radius-lg p-8 shadow-2xl transition-all duration-300">
          
          {error && (
            <div className="mb-5 p-3.5 bg-red-950/40 border border-accent-red/30 rounded-xl text-accent-red text-[13px] leading-normal flex items-start space-x-2">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
              <span className="flex-1">{error}</span>
            </div>
          )}

          {message && (
            <div className="mb-5 p-3.5 bg-green-950/40 border border-accent-green/30 rounded-xl text-accent-green text-[13px] leading-normal flex items-start space-x-2">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">check_circle</span>
              <span className="flex-1">{message}</span>
            </div>
          )}

          {step === 'email' ? (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              {/* Google SSO Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center space-x-3 h-[48px] bg-transparent border border-border-default hover:bg-[#252626] active:scale-[0.99] rounded-radius-md text-on-surface font-medium text-[14px] transition-all"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>

              {/* Separator OR */}
              <div className="flex items-center my-5 select-none">
                <div className="flex-grow border-t border-border-default"></div>
                <span className="px-4 text-[10px] text-text-muted uppercase tracking-[0.2em] font-bold">OR</span>
                <div className="flex-grow border-t border-border-default"></div>
              </div>

              {/* Email input and submit */}
              <div className="space-y-4">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="w-full h-[48px] px-4 bg-[#111212] border border-border-default focus:border-border-active focus:outline-none rounded-radius-md text-text-primary text-[14px] transition-colors placeholder:text-text-muted"
                />
                
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[48px] bg-accent-blue hover:bg-blue-600 active:scale-[0.99] text-white font-medium text-[14px] rounded-radius-md transition-all flex items-center justify-center space-x-2"
                >
                  <span>{loading ? 'Checking...' : 'Continue with email'}</span>
                </button>
              </div>

              <p className="text-[12px] text-text-muted text-center mt-6 select-none leading-relaxed">
                By continuing, you acknowledge CollabIDE's{' '}
                <a href="#" className="underline hover:text-on-surface transition-colors">Privacy Policy</a>.
              </p>
            </form>
          ) : (
            <form onSubmit={handleAuthSubmit} className="space-y-5">
              {/* Selected Email Box */}
              <div className="flex items-center justify-between bg-[#111212] border border-border-default rounded-radius-md px-4 py-2.5">
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">Email</span>
                  <span className="text-[13.5px] text-on-surface truncate max-w-[240px] font-medium">{email}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setError('');
                    setMessage('');
                  }}
                  className="text-text-muted hover:text-on-surface p-1 rounded-radius-md hover:bg-[#252626] transition-colors flex shrink-0"
                >
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                </button>
              </div>

              <div className="space-y-1">
                <h2 className="text-[18px] font-semibold text-on-surface">
                  {isExistingUser ? 'Welcome back!' : 'Create your account'}
                </h2>
                <p className="text-[13px] text-text-secondary">
                  {isExistingUser 
                    ? 'Enter your password to sign in.' 
                    : 'Choose a display name and secure password.'}
                </p>
              </div>

              {!isExistingUser && (
                <>
                  {/* Display name field */}
                  <div className="space-y-1.5">
                    <label className="block text-text-secondary text-[12px] font-medium" htmlFor="disp-name">Display name</label>
                    <input
                      id="disp-name"
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full h-[40px] px-3.5 bg-[#111212] border border-border-default focus:border-border-active focus:outline-none rounded-radius-md text-text-primary text-[14px] transition-colors"
                    />
                  </div>

                  {/* Avatar color picker */}
                  <div className="space-y-2">
                    <label className="block text-text-secondary text-[12px] font-medium">Choose avatar color</label>
                    <div className="flex gap-2.5">
                      {USER_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`w-6 h-6 rounded-full transition-all border ${
                            avatarColor === color ? 'ring-2 ring-border-active border-transparent' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => setAvatarColor(color)}
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Password field */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="block text-text-secondary text-[12px] font-medium" htmlFor="password">Password</label>
                  {isExistingUser && (
                    <a href="#" className="text-[11px] text-accent-blue hover:underline">Forgot password?</a>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-[40px] px-3.5 pr-10 bg-[#111212] border border-border-default focus:border-border-active focus:outline-none rounded-radius-md text-text-primary text-[14px] transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {showPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                </div>

                {/* Password strength checker (sign up only) */}
                {!isExistingUser && password && (
                  <div className="space-y-1 mt-2">
                    <div className="text-[10px] text-text-muted">
                      Strength: {['Weak', 'Fair', 'Good', 'Strong'][strength - 1] || 'Too short'}
                    </div>
                    <div className="flex gap-1 h-1 w-full bg-border-default/20 rounded-full overflow-hidden">
                      {[1, 2, 3, 4].map((step) => (
                        <div
                          key={step}
                          className={`flex-grow h-full transition-all ${
                            strength >= step
                              ? strength === 4
                                ? 'bg-accent-green'
                                : strength >= 2
                                ? 'bg-[#e07a1b]'
                                : 'bg-accent-red'
                              : 'bg-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[44px] bg-accent-blue hover:bg-blue-600 active:scale-[0.99] text-white font-medium text-[14px] rounded-radius-md transition-all flex items-center justify-center space-x-2"
                >
                  <span>{loading ? 'Processing...' : isExistingUser ? 'Sign In' : 'Create Account'}</span>
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setError('');
                    setMessage('');
                  }}
                  className="w-full h-[38px] bg-transparent hover:bg-[#252626] text-text-muted hover:text-on-surface font-medium text-[13px] rounded-radius-md transition-all"
                >
                  Go back
                </button>
              </div>
            </form>
          )}

        </div>
      </main>
    </div>
  );
}
