import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/common/Button';

export function MfaVerifyPage() {
  const navigate = useNavigate();
  const { refreshMfaLevel, signOut } = useAuth();

  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loadingFactor, setLoadingFactor] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function loadFactor() {
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        setError(listError.message);
        setLoadingFactor(false);
        return;
      }

      const verifiedTotp = data.totp.find((f) => f.status === 'verified');
      if (!verifiedTotp) {
        navigate('/mfa/enroll', { replace: true });
        return;
      }

      setFactorId(verifiedTotp.id);
      setLoadingFactor(false);
    }

    loadFactor();
  }, [navigate]);

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
      setError('Incorrect code. Try again.');
      setCode('');
      setVerifying(false);
      return;
    }

    await refreshMfaLevel();
    navigate('/', { replace: true });
  }

  async function handleSignOut() {
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

        <h2 className="text-xl font-bold text-neutral-800 mb-1">Enter your code</h2>
        <p className="text-sm text-neutral-400 mb-6">
          Open your authenticator app and enter the current 6-digit code.
        </p>

        {loadingFactor && <p className="text-sm text-neutral-400">Loading…</p>}

        {!loadingFactor && factorId && (
          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-neutral-700 mb-1">
                6-digit code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
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
              Verify
            </Button>
          </form>
        )}

        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm text-neutral-400 hover:text-neutral-600 mt-6 w-full text-center"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
