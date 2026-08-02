import React, { useState, useEffect } from 'react';
import { loginUser, registerUser, googleLogin, getAuthConfig } from '../services/api';

const USER_COLORS = ['#1a73e8', '#1e8e3e', '#f9ab00', '#a142f4', '#e52592'];

export default function AuthView({ onAuthSuccess }) {
  const [activeTab, setActiveTab] = useState('signin'); // 'signin' or 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState(USER_COLORS[0]);
  const [showPassword, setShowPassword] = useState(false);
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

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (activeTab === 'signin') {
        const data = await loginUser({ email, password });
        onAuthSuccess(data.user);
      } else {
        if (!displayName) {
          setError('Display name is required for registration.');
          setLoading(false);
          return;
        }
        const data = await registerUser({ email, password, displayName, avatarColor });
        setMessage(data.message + ' (Check backend logs for verification link)');
        setActiveTab('signin');
        setPassword('');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

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
    <div className="flex min-h-screen w-full bg-bg-base text-text-primary font-ui overflow-y-auto overflow-x-hidden">
      
      {/* Container for the Two Columns */}
      <div className="flex flex-col lg:flex-row w-full max-w-[1200px] mx-auto min-h-screen">
        
        {/* Left Column (Hero & Features) */}
        <div className="flex-1 flex flex-col justify-center px-8 py-12 lg:pr-16 relative">
          
          <div className="max-w-[480px]">
            <h1 className="font-semibold text-[32px] md:text-[40px] leading-tight text-on-surface mb-4">
              Code together, <br className="hidden md:block"/> in real time.
            </h1>
            <p className="text-[15px] text-text-secondary leading-relaxed mb-12">
              A collaborative IDE with live editing, voice chat, and instant code execution.
            </p>

            <div className="space-y-8">
              {/* Feature 1 */}
              <div className="flex items-start space-x-4">
                <span className="material-symbols-outlined text-accent-orange text-[24px] mt-0.5">bolt</span>
                <div>
                  <h3 className="text-[14px] font-semibold text-on-surface">Real-time sync</h3>
                  <p className="text-[13px] text-text-muted mt-1">CRDT-based editing. No conflicts, ever.</p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="flex items-start space-x-4">
                <span className="material-symbols-outlined text-text-muted text-[24px] mt-0.5">mic</span>
                <div>
                  <h3 className="text-[14px] font-semibold text-on-surface">Voice chat</h3>
                  <p className="text-[13px] text-text-muted mt-1">Audio-first collaboration built into the room.</p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="flex items-start space-x-4">
                <span className="material-symbols-outlined text-on-surface text-[24px] mt-0.5">play_arrow</span>
                <div>
                  <h3 className="text-[14px] font-semibold text-on-surface">Code execution</h3>
                  <p className="text-[13px] text-text-muted mt-1">Run code in 5 languages, output shared instantly.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-16">
            <p className="text-[11px] font-medium tracking-widest text-text-muted/60 uppercase">
              BAHRIA UNIVERSITY FYP · BSE 2026
            </p>
          </div>
        </div>

        {/* Right Column (Auth Card) */}
        <div className="flex-1 flex flex-col justify-center items-center lg:items-end px-8 py-12">
          
          <div className="w-full max-w-[420px] bg-bg-panel border border-border-default rounded-radius-lg p-8 shadow-2xl relative overflow-hidden">
            
            <div className="flex justify-center items-center space-x-2 mb-8 select-none">
              <span className="text-accent-blue font-mono font-medium text-[16px]">code</span>
              <span className="font-sans font-bold text-[18px] tracking-wide text-accent-blue">CollabIDE</span>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border-default mb-8">
              <button
                className={`flex-1 pb-3 text-[14px] font-medium transition-colors border-b-2 ${
                  activeTab === 'signin' 
                    ? 'border-accent-blue text-on-surface' 
                    : 'border-transparent text-text-muted hover:text-text-secondary'
                }`}
                onClick={() => { setActiveTab('signin'); setError(''); setMessage(''); }}
              >
                Sign in
              </button>
              <button
                className={`flex-1 pb-3 text-[14px] font-medium transition-colors border-b-2 ${
                  activeTab === 'signup' 
                    ? 'border-accent-blue text-on-surface' 
                    : 'border-transparent text-text-muted hover:text-text-secondary'
                }`}
                onClick={() => { setActiveTab('signup'); setError(''); setMessage(''); }}
              >
                Create account
              </button>
            </div>

            {error && (
              <div className="mb-5 p-3.5 bg-red-950/40 border border-accent-red/30 rounded-radius-md text-accent-red text-[13px] leading-normal flex items-start space-x-2">
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
                <span className="flex-1">{error}</span>
              </div>
            )}

            {message && (
              <div className="mb-5 p-3.5 bg-green-950/40 border border-accent-green/30 rounded-radius-md text-accent-green text-[13px] leading-normal flex items-start space-x-2">
                <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">check_circle</span>
                <span className="flex-1">{message}</span>
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-5">
              
              <div className="space-y-1.5">
                <label className="block text-text-secondary text-[12px] font-medium" htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full h-[40px] px-3.5 bg-[#111212] border border-border-default focus:border-border-active focus:outline-none rounded-radius-md text-text-primary text-[14px] transition-colors placeholder:text-text-muted/50"
                />
              </div>

              {activeTab === 'signup' && (
                <>
                  <div className="space-y-1.5">
                    <label className="block text-text-secondary text-[12px] font-medium" htmlFor="disp-name">Display name</label>
                    <input
                      id="disp-name"
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full h-[40px] px-3.5 bg-[#111212] border border-border-default focus:border-border-active focus:outline-none rounded-radius-md text-text-primary text-[14px] transition-colors placeholder:text-text-muted/50"
                    />
                  </div>

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

              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="block text-text-secondary text-[12px] font-medium" htmlFor="password">Password</label>
                  {activeTab === 'signin' && (
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
                    className="w-full h-[40px] px-3.5 pr-10 bg-[#111212] border border-border-default focus:border-border-active focus:outline-none rounded-radius-md text-text-primary text-[14px] transition-colors tracking-[0.2em] placeholder:tracking-normal placeholder:text-text-muted/50"
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
                
                {activeTab === 'signup' && password && (
                  <div className="space-y-1 mt-2">
                    <div className="text-[10px] text-text-muted flex justify-between">
                      <span>Strength</span>
                      <span>{['Weak', 'Fair', 'Good', 'Strong'][strength - 1] || 'Too short'}</span>
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

              <div className="pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-[44px] bg-accent-blue hover:bg-blue-600 active:scale-[0.99] text-white font-medium text-[14px] rounded-radius-md transition-all flex items-center justify-center space-x-2"
                >
                  <span>{loading ? 'Processing...' : activeTab === 'signin' ? 'Sign In' : 'Create Account'}</span>
                  {!loading && activeTab === 'signin' && (
                    <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                  )}
                </button>
              </div>

              {/* Separator OR */}
              <div className="flex items-center my-6 select-none opacity-80">
                <div className="flex-grow border-t border-border-default"></div>
                <span className="px-4 text-[10px] text-text-muted uppercase tracking-[0.2em] font-bold">OR</span>
                <div className="flex-grow border-t border-border-default"></div>
              </div>

              {/* Google SSO Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center space-x-3 h-[44px] bg-transparent border border-border-default hover:bg-[#252626] active:scale-[0.99] rounded-radius-md text-on-surface font-medium text-[13px] transition-all"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
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

            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
