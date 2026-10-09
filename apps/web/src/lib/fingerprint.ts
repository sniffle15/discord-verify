/**
 * Coarse, privacy-preserving device fingerprint used only to flag likely alt accounts.
 * Only stable, low-entropy browser traits are used (no canvas/audio probing), and the server
 * re-hashes the value with a secret key before storing it.
 */
export async function computeFingerprint(): Promise<string | null> {
  try {
    const traits = [
      navigator.userAgent,
      navigator.language,
      (navigator.languages ?? []).join(','),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      String(navigator.hardwareConcurrency ?? ''),
      String((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? ''),
      String(navigator.maxTouchPoints ?? ''),
    ].join('|');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(traits));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
