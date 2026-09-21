import React, { useState, useEffect } from 'react';
import { loginUser, registerUser, googleLogin, getAuthConfig } from '../services/api';
import { Eye, EyeOff } from 'lucide-react';

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

  return (
    <div className="bg-[#0d0e0f] text-[#e3e2e3] font-ui text-[13px] h-screen flex overflow-hidden w-full">
      {/* Left Side: Hero Section */}
      <section className="hidden lg:flex w-1/2 bg-[#0d0e0f] p-8 flex-col justify-between relative overflow-hidden">
        {/* Subtle code background texture */}
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <img alt="Background Pattern" className="w-full h-full object-cover grayscale" src="https://lh3.googleusercontent.com/aida/AP1WRLv9qWf1XDlcw4ubvHO07TFEEDuJXFaVKbthxEN2QPbSm3zoYaNLjxl3F8SCkxjy2UUyLB3K9pXwKoIq8ngDndHF6pI-TTenwEiDCChXUY-myS_Le_BP9fAJCq8pMFu8ou75st7Ktlih8CYAXei-JiU_ngDf4oRALrGdH6eoyxa3NH7jRvKz1EZHGZvDDREd_YKYWljEInpge4INo9bzqTvI16qONknUQbWbmAO16_aVXXemJuzhwhc0HmTn" />
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
                <p className="text-[13px] text-[#c0c7d3]">Sub-millisecond latency updates across all connected clients.</p>
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
                <p className="text-[13px] text-[#c0c7d3]">Secure sandboxed runtime for over 25+ programming languages.</p>
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
      <section className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#121314]">
        <div className="w-full max-w-[440px] bg-[#1b1c1c] border border-[#404751] rounded-lg p-10 shadow-xl overflow-y-auto max-h-screen">
          
          {/* Logo */}
          <div className="flex items-center justify-center space-x-2 mb-10 cursor-pointer select-none" onClick={() => window.location.reload()}>
            <img src="/logo.png" alt="CollabIDE Logo" className="h-12 object-contain" />
          </div>

          {/* Tab Switcher */}
          <div className="flex border-b border-[#404751] mb-8">
            <button 
              type="button"
              className={`flex-1 pb-4 text-[14px] font-medium transition-all border-b-2 ${
                activeTab === 'signin' ? 'text-[#9fcaff] border-[#9fcaff]' : 'text-[#c0c7d3] border-transparent hover:text-[#e3e2e3]'
              }`}
              onClick={() => { setActiveTab('signin'); setError(''); setMessage(''); }}
            >
              Sign in
            </button>
            <button 
              type="button"
              className={`flex-1 pb-4 text-[14px] font-medium transition-all border-b-2 ${
                activeTab === 'signup' ? 'text-[#9fcaff] border-[#9fcaff]' : 'text-[#c0c7d3] border-transparent hover:text-[#e3e2e3]'
              }`}
              onClick={() => { setActiveTab('signup'); setError(''); setMessage(''); }}
            >
              Create account
            </button>
          </div>

          {error && (
            <div className="mb-5 p-3 bg-red-950/40 border border-[#d93025]/30 rounded-lg text-[#d93025] text-[13px] flex items-start space-x-2">
              <span className="material-symbols-outlined text-[18px] mt-0.5">error</span>
              <span className="flex-1">{error}</span>
            </div>
          )}

          {message && (
            <div className="mb-5 p-3 bg-green-950/40 border border-[#1e8e3e]/30 rounded-lg text-[#1e8e3e] text-[13px] flex items-start space-x-2">
              <span className="material-symbols-outlined text-[18px] mt-0.5">check_circle</span>
              <span className="flex-1">{message}</span>
            </div>
          )}

          {/* Form */}
          <form className="space-y-6" onSubmit={handleAuthSubmit}>
            <div className="space-y-2">
              <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="email">Email Address</label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">mail</span>
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
                  <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="displayName">Display Name</label>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">person</span>
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
                  <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]">Choose Avatar Color</label>
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

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-medium uppercase tracking-widest text-[#c0c7d3]" htmlFor="password">Password</label>
                {activeTab === 'signin' && (
                  <a className="text-[11px] font-medium text-[#9fcaff] hover:underline" href="#">Forgot?</a>
                )}
              </div>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#8a919d] text-[20px]">lock</span>
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

            <button 
              type="submit"
              disabled={loading}
              className="w-full h-12 bg-[#007acc] hover:bg-[#007acc]/90 text-white font-medium text-[14px] rounded-lg flex items-center justify-center group transition-all active:scale-[0.98] mt-2 shadow-lg shadow-[#007acc]/20"
            >
              <span>{loading ? 'Processing...' : activeTab === 'signin' ? 'Sign In' : 'Create Account'}</span>
              {!loading && activeTab === 'signin' && (
                <span className="material-symbols-outlined ml-2 text-[20px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
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
              <img src="https://www.gstatic.com/images/branding/product/1x/gsa_512dp.png" alt="Google Logo" className="w-5 h-5 object-contain" />
              <span className="text-[14px] font-medium text-[#e3e2e3]">Continue with Google</span>
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
