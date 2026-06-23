/**
 * Client-side passkey (WebAuthn) helpers.
 *
 * Wraps @simplewebauthn/browser and the Zentra API into two simple methods:
 *   - registerPasskey()    : authed user binds Face ID / Touch ID / Hello to their account
 *   - signInWithPasskey()  : unauth user signs in via biometric, no email required
 *
 * On iOS Safari this triggers Face ID. On Android Chrome → fingerprint.
 * On macOS / Windows → Touch ID / Windows Hello.
 */

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
} from '@simplewebauthn/browser';
import { api, ApiError } from './api-client';

export const passkeysSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
};

export async function platformBiometricAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await platformAuthenticatorIsAvailable();
  } catch {
    return false;
  }
}

export async function registerPasskey(nickname?: string): Promise<void> {
  // Step 1: get options from server
  const options = await api<unknown>('/auth/passkey/register/options', { method: 'POST' });
  // Step 2: prompt the platform authenticator (Face ID, Touch ID, Hello, …)
  let attResp;
  try {
    attResp = await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'] });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    // User cancelled → swallow with a friendly message
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
      throw new Error('Passkey setup cancelled.');
    }
    throw new Error(e.message || 'Could not start passkey registration');
  }
  // Step 3: send back to server for verification + storage
  await api('/auth/passkey/register/verify', {
    method: 'POST',
    body: { response: attResp, nickname },
  });
}

export async function signInWithPasskey(): Promise<void> {
  const data = await api<{ challengeId: string; options: unknown }>(
    '/auth/passkey/login/options',
    { method: 'POST' },
  );
  let assertion;
  try {
    assertion = await startAuthentication({
      optionsJSON: data.options as Parameters<typeof startAuthentication>[0]['optionsJSON'],
    });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === 'NotAllowedError' || e.name === 'AbortError') {
      throw new Error('Sign-in cancelled.');
    }
    throw new Error(e.message || 'Could not start passkey sign-in');
  }
  await api('/auth/passkey/login/verify', {
    method: 'POST',
    body: { challengeId: data.challengeId, response: assertion },
  });
}

export interface Passkey {
  id: string;
  nickname: string;
  deviceType: 'platform' | 'cross-platform';
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export async function listPasskeys(): Promise<Passkey[]> {
  return api<Passkey[]>('/auth/passkeys');
}

export async function deletePasskey(id: string): Promise<void> {
  await api(`/auth/passkeys/${id}`, { method: 'DELETE' });
}

export async function renamePasskey(id: string, nickname: string): Promise<void> {
  await api(`/auth/passkeys/${id}`, { method: 'PATCH', body: { nickname } });
}

// Re-export ApiError for callers that need to inspect it.
export { ApiError };

// LocalStorage flag to avoid re-prompting the same device repeatedly.
const PROMPT_KEY = 'zentra:passkey-prompt-dismissed';

export function hasDismissedPasskeyPrompt(): boolean {
  if (typeof window === 'undefined') return true;
  try { return localStorage.getItem(PROMPT_KEY) === '1'; } catch { return true; }
}

export function dismissPasskeyPrompt(): void {
  try { localStorage.setItem(PROMPT_KEY, '1'); } catch { /* ignore */ }
}
