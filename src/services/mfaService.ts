import { supabase } from './supabase';
import type { AuthenticatorAssuranceLevels, Factor } from '@supabase/supabase-js';

/** What the enrollment UI needs to show the user before they can verify. */
export interface TotpEnrollment {
  factorId: string;
  /** SVG data URI from Supabase — render directly in an <img>. No QR library needed. */
  qrCode: string;
  /** Text fallback, for authenticator apps that can't scan. */
  secret: string;
  uri: string;
}

/**
 * Session assurance level.
 *
 * `current`/`next` come straight from Supabase. `challengeRequired` is the only
 * combination that means "signed in, but not finished": a verified factor exists
 * and this session hasn't answered it yet.
 */
export interface AalState {
  current: AuthenticatorAssuranceLevels | null;
  next: AuthenticatorAssuranceLevels | null;
  /** A verified factor exists and this session is still at aal1. */
  challengeRequired: boolean;
  /** This session has cleared MFA. */
  satisfied: boolean;
}

export async function getAal(): Promise<AalState> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  const { currentLevel, nextLevel } = data;
  return {
    current: currentLevel,
    next: nextLevel,
    challengeRequired: currentLevel === 'aal1' && nextLevel === 'aal2',
    satisfied: currentLevel === 'aal2',
  };
}

/** Every factor on the account, verified or not. */
export async function listAllFactors(): Promise<Factor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.all;
}

/** Verified TOTP factors only — these are the ones that can answer a challenge. */
export async function listVerifiedTotpFactors(): Promise<Factor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return data.totp;
}

/**
 * The factor to challenge at login. Null means nothing is enrolled.
 */
export async function getChallengeableFactorId(): Promise<string | null> {
  const factors = await listVerifiedTotpFactors();
  return factors[0]?.id ?? null;
}

/**
 * Start TOTP enrollment and return the QR code to display.
 *
 * Abandoned enrollments leave `unverified` factors behind, and Supabase rejects a
 * second enroll that reuses their friendly name. Clearing them first means the user
 * can restart enrollment as many times as they need instead of hitting an opaque
 * "factor already exists" error. Verified factors are never touched.
 */
export async function enrollTotp(friendlyName = 'Authenticator'): Promise<TotpEnrollment> {
  const existing = await listAllFactors();
  for (const factor of existing) {
    if (factor.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (error) throw error;

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/**
 * Submit a 6-digit code. Used for both jobs the code does:
 * activating a new factor during enrollment, and answering the challenge at login.
 *
 * On success during enrollment the factor becomes `verified` and the session is
 * promoted to aal2 — which signs out every other session on the account.
 */
export async function verifyTotpCode(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: code.trim(),
  });
  if (error) throw error;
}

/** Remove a factor. Supabase requires the session to be at aal2 to unenroll a verified one. */
export async function unenrollFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}
