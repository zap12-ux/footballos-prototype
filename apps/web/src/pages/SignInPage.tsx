import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { FocusOnNavigate } from '../app/FocusOnNavigate';
import { describeError, useApi } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';

type Step = 'credentials' | 'mfa' | 'recovery' | 'recovery_sent';

function safeNext(raw: string | null): string {
  // Only in-app paths; never an absolute URL from the query string.
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/app';
  return raw;
}

export function SignInPage() {
  const api = useApi();
  const { state, signIn, verifyMfa } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const id = useId();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [step]);

  if (state.status === 'authenticated') return <Navigate to={next} replace />;

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your staff email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await signIn({ email: email.trim(), password });
      if (result.kind === 'mfa_required') setStep('mfa');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.replace(/\s+/g, ''))) {
      setError('Enter the six-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyMfa({ code: code.replace(/\s+/g, '') });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitRecovery(e: FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Enter the email address of your staff account.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.auth.requestRecovery({ email: email.trim() });
      setStep('recovery_sent');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" tabIndex={-1} className="public-main narrow">
      <FocusOnNavigate title="Sign in · FootballOS" />
      <div className="card sign-in">
        {step === 'credentials' && (
          <form onSubmit={submitCredentials} noValidate aria-describedby={error ? `${id}-error` : undefined}>
            <h1>Sign in</h1>
            <p className="muted">Staff accounts are created by invitation from your head coach.</p>
            <label htmlFor={`${id}-email`}>Email</label>
            <input id={`${id}-email`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required aria-invalid={!!error && !email} />
            <label htmlFor={`${id}-password`}>Password</label>
            <input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!error && !password} />
            {error ? (
              <p className="field-error" id={`${id}-error`} role="alert">
                {error}
              </p>
            ) : null}
            <div className="btn-row">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <button type="button" className="link" onClick={() => setStep('recovery')}>
                Can&rsquo;t sign in?
              </button>
            </div>
          </form>
        )}

        {step === 'mfa' && (
          <form onSubmit={submitCode} noValidate>
            <h1>Verification code</h1>
            <p className="muted">
              Your account uses multi-factor sign-in. Enter the six-digit code from your authenticator app, or one of your recovery codes.
            </p>
            <label htmlFor={`${id}-code`}>Code</label>
            <input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!error} />
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="btn-row">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? 'Checking…' : 'Verify'}
              </button>
              <button type="button" className="link" onClick={() => setStep('credentials')}>
                Back
              </button>
            </div>
          </form>
        )}

        {step === 'recovery' && (
          <form onSubmit={submitRecovery} noValidate>
            <h1>Account recovery</h1>
            <p className="muted">
              Enter your staff email. If it matches an account, a recovery link is sent there. For a lost authenticator, use a recovery code or ask your head coach to reset MFA.
            </p>
            <label htmlFor={`${id}-recovery-email`}>Email</label>
            <input id={`${id}-recovery-email`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="btn-row">
              <button type="submit" className="primary" disabled={busy}>
                {busy ? 'Sending…' : 'Send recovery link'}
              </button>
              <button type="button" className="link" onClick={() => setStep('credentials')}>
                Back to sign in
              </button>
            </div>
          </form>
        )}

        {step === 'recovery_sent' && (
          <div role="status">
            <h1>Check your email</h1>
            <p>If an account exists for that address, a recovery link is on its way. It expires in 30 minutes.</p>
            <button type="button" onClick={() => setStep('credentials')}>
              Back to sign in
            </button>
          </div>
        )}
      </div>

      <p className="small muted">
        <Link to="/">Back to the landing page</Link>
      </p>
    </main>
  );
}
