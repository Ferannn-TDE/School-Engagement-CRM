import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/common/Button';

export function MfaEnrollPage() {
  const navigate = useNavigate();
  const { refreshMfaLevel, signOut } = useAuth();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [enrolling, setEnrolling] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function startEnrollment() {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'authenticator-app',
      });

      if (enrollError) {
        setError(enrollError.message);
        setEnrolling(false);
        return;
      }

      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setEnrolling(false);
    }

    startEnrollment();
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError('');
    setVerifying(true);

    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setError(challengeError.message);
      setVerifying(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    });

    if (verifyError) {
      setError('Incorrect code. Check your authenticator app and try again.');
      setCode('');
      setVerifying(false);
      return;
    }

    await refreshMfaLevel();
    navigate('/', { replace: true });
  }

  async function handleCancel() {
    if (factorId) {
      await supabase.auth.mfa.unenroll({ factorId });
    }
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-neutral-100 shadow-sm p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 bg-siue-red rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">SoE</span>
          </div>
          <div>
            <p className="text-sm font-bold text-neutral-800 leading-tight">SIUE Engineering</p>
            <p className="text-xs text-neutral-400">Engagement CRM</p>
          </div>
        </div>

        <h2 className="text-xl font-bold text-neutral-800 mb-1">Set up two-factor login</h2>
        <p className="text-sm text-neutral-400 mb-6">
          This is required for all accounts. Scan the code below with an authenticator app (Google
          Authenticator, Microsoft Authenticator, Authy, etc.).
        </p>

        {enrolling && <p className="text-sm text-neutral-400">Generating your QR code…</p>}

        {!enrolling && qrCode && (
          <>
            <div className="flex justify-center mb-4">
              <img src={qrCode} alt="Scan this QR code with your authenticator app" className="w-40 h-40" />
            </div>

            {secret && (
              <div className="mb-6">
                <p className="text-xs text-neutral-400 mb-1">Can't scan it? Enter this key manually:</p>
                <p className="text-xs font-mono bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 break-all">
                  {secret}
                </p>
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-neutral-700 mb-1">
                  Enter the 6-digit code from your app
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-3 py-2 text-sm border border-neutral-200 rounded-lg tracking-widest text-center font-mono focus:outline-none focus:ring-2 focus:ring-siue-red/30 focus:border-siue-red"
                />
              </div>

              {error && (
                <p className="text-sm text-error" role="alert">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" loading={verifying} disabled={code.length !== 6}>
                Confirm and continue
              </Button>
            </form>

            <button
              type="button"
              onClick={handleCancel}
              className="text-sm text-neutral-400 hover:text-neutral-600 mt-6 w-full text-center"
            >
              Cancel and sign out
            </button>
          </>
        )}

        {!enrolling && !qrCode && error && (
          <p className="text-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
