import React, { useState } from 'react';
import { loginUser, registerUser } from '../services/api';

const USER_COLORS = ['#1a73e8', '#1e8e3e', '#f9ab00', '#a142f4', '#e52592'];

export default function AuthView({ onAuthSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState(USER_COLORS[0]);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (isLogin) {
        const data = await loginUser({ email, password });
        onAuthSuccess(data.user);
      } else {
        const data = await registerUser({ email, password, displayName, avatarColor });
        setMessage(data.message + ' (Check the backend server logs for the verification link to activate your account!)');
        setIsLogin(true);
        setPassword('');
      }
    } catch (err) {
      setError(err.message);
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
    <div className="flex flex-row items-stretch overflow-hidden h-screen w-full bg-bg-base font-ui">
      {/* Left side: Brand Panel (55%) */}
      <aside className="hidden lg:flex flex-col w-[55%] bg-bg-base p-16 justify-center items-center">
        <div class="max-w-[520px] ml-auto space-y-12 mx-auto">
          <div className="space-y-4">
            <h1 className="text-[36px] font-semibold leading-[44px] text-text-primary">
              Code together,<br />in real time.
            </h1>
            <p className="text-[16px] leading-[24px] text-text-secondary">
              A collaborative IDE with live editing, voice chat, and instant code execution.
            </p>
          </div>

          {/* Feature Callouts */}
          <ul className="space-y-6">
            <li className="flex items-start space-x-4">
              <span className="text-[20px] shrink-0 mt-1">⚡</span>
              <div>
                <h3 className="text-text-primary font-semibold text-[14px]">Real-time sync</h3>
                <p className="text-text-secondary text-[13px]">CRDT-based editing. No conflicts, ever.</p>
              </div>
            </li>
            <li className="flex items-start space-x-4">
              <span className="text-[20px] shrink-0 mt-1">🎙</span>
              <div>
                <h3 className="text-text-primary font-semibold text-[14px]">Voice chat</h3>
                <p className="text-text-secondary text-[13px]">Audio-first collaboration built into the room.</p>
              </div>
            </li>
            <li className="flex items-start space-x-4">
              <span className="text-[20px] shrink-0 mt-1">▶</span>
              <div>
                <h3 className="text-text-primary font-semibold text-[14px]">Code execution</h3>
                <p className="text-text-secondary text-[13px]">Run code in 5 languages, output shared instantly.</p>
              </div>
            </li>
          </ul>

          <div className="pt-8">
            <p className="text-text-muted text-[11px] uppercase tracking-wider">Bahria University FYP · BSE 2026</p>
          </div>
        </div>
      </aside>

      {/* Right side: Auth Card (45%) */}
      <main className="flex-1 bg-surface flex flex-col items-center justify-center p-12 lg:p-16">
        <div className="w-full max-w-[380px] bg-bg-elevated border border-border-default rounded-radius-lg p-8 shadow-2xl">
          {/* Logo Section */}
          <div className="flex items-center justify-center mb-10 cursor-pointer" onClick={() => window.location.href = '/'}>
            <img src="/logo.png" className="h-28 object-contain" alt="CollabIDE Logo" />
          </div>

          {/* Tab Switcher */}
          <div className="flex mb-8 border-b border-border-default">
            <button
              id="tab-signin"
              className={`flex-1 pb-3 text-[14px] font-medium transition-colors ${
                isLogin ? 'text-text-primary border-b-2 border-accent-blue' : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => {
                setIsLogin(true);
                setError('');
                setMessage('');
              }}
            >
              Sign in
            </button>
            <button
              id="tab-register"
              className={`flex-1 pb-3 text-[14px] font-medium transition-colors ${
                !isLogin ? 'text-text-primary border-b-2 border-accent-blue' : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => {
                setIsLogin(false);
                setError('');
                setMessage('');
              }}
            >
              Create account
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-950/40 border border-accent-red/30 rounded-radius-md text-accent-red text-xs">
              {error}
            </div>
          )}

          {message && (
            <div className="mb-4 p-3 bg-green-950/40 border border-accent-green/30 rounded-radius-md text-accent-green text-xs">
              {message}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            {!isLogin && (
              <>
                <div className="space-y-1.5">
                  <label className="block text-text-secondary text-[13px]" htmlFor="reg-name">Display name</label>
                  <input
                    className="w-full h-[36px] px-3 bg-bg-elevated border border-border-default rounded-radius-md text-text-primary text-[14px] placeholder-text-muted focus:border-accent-blue outline-none"
                    id="reg-name"
                    placeholder="John Doe"
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-text-secondary text-[13px]">Choose Avatar Color</label>
                  <div className="flex gap-2.5">
                    {USER_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`w-6 h-6 rounded-full transition-all border ${
                          avatarColor === color ? 'ring-2 ring-accent-blue border-white' : 'border-transparent'
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
              <label className="block text-text-secondary text-[13px]" htmlFor="email">Email</label>
              <input
                className="w-full h-[36px] px-3 bg-bg-elevated border border-border-default rounded-radius-md text-text-primary text-[14px] placeholder-text-muted focus:border-accent-blue outline-none"
                id="email"
                placeholder="name@company.com"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="block text-text-secondary text-[13px]" htmlFor="password">Password</label>
                {isLogin && <a className="text-[11px] text-accent-blue hover:underline" href="#">Forgot password?</a>}
              </div>
              <div className="relative">
                <input
                  className="w-full h-[36px] px-3 pr-10 bg-bg-elevated border border-border-default rounded-radius-md text-text-primary text-[14px] placeholder-text-muted focus:border-accent-blue outline-none"
                  id="password"
                  placeholder="••••••••"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>

              {!isLogin && password && (
                <div className="space-y-1 mt-2">
                  <div className="text-[10px] text-text-muted">
                    Strength: {['Weak', 'Fair', 'Good', 'Strong'][strength - 1] || 'Too short'} (Min 8 chars, 1 upper, 1 num, 1 special)
                  </div>
                  <div className="flex gap-1 h-1.5 w-full bg-border-default/50 rounded-full overflow-hidden">
                    {[1, 2, 3, 4].map((step) => (
                      <div
                        key={step}
                        className={`flex-1 h-full rounded-full transition-all ${
                          strength >= step
                            ? strength === 4
                              ? 'bg-accent-green'
                              : strength >= 2
                              ? 'bg-accent-orange'
                              : 'bg-accent-red'
                            : 'bg-transparent'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              disabled={loading}
              className="w-full h-[36px] bg-accent-blue hover:opacity-90 active:scale-[0.98] text-white text-[14px] font-medium rounded-radius-md transition-all flex items-center justify-center space-x-2 mt-2"
            >
              <span>{loading ? 'Processing...' : isLogin ? 'Sign In' : 'Create Account'}</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
