/**
 * Fair Bucket Splitter
 *
 * Deterministic A/B bucketing using SHA-256 hashing. Bucket A is the top
 * `shareA` of the hash scores: 50/50 unless the caller passes another share.
 *
 * Bucket A → Velocity (GB, 50%)
 * Bucket B → Thrad (GB, 50%). US uses separate weighted selection.
 *
 * Usage:
 *   const bucket = await assignFairBucket();    // 50/50
 *   const bucket = await assignFairBucket(0.2); // A = 20%, B = 80%
 *   console.log(bucket); // "A" or "B"
 *
 *   // Check if user manually overrode:
 *   const isManual = isManualOverride();
 *
 *   // Manually set bucket:
 *   setFairBucket("A");
 *   setFairBucket("B");
 *
 *   // Clear assignment:
 *   clearFairBucket();
 */

const HASH_SCORE_RANGE = 4294967296; // 2^32
const FAIR_BUCKET_STORAGE_KEY = 'fair_bucket';
const FAIR_BUCKET_MANUAL_KEY = 'fair_bucket_manual';
const FAIR_BUCKET_SHARE_KEY = 'fair_bucket_share';

// ============================================================================
// Core Bucketing Logic
// ============================================================================

/**
 * Scores at or above this are Bucket A: the top `shareA` of the hash range
 * @param {number} shareA
 * @returns {number}
 */
function bucketAThreshold(shareA) {
  return (1 - shareA) * HASH_SCORE_RANGE;
}

/**
 * Assigns user to a fair bucket (A or B) based on IP + User Agent hash
 * Returns the stored assignment if it was drawn under this share or set by
 * hand; one drawn under another share is drawn again
 * @param {number} shareA - Bucket A's share of visitors (default: the stored one, else 0.5)
 * @returns {Promise<string>} "A" or "B"
 */
async function assignFairBucket(shareA = getSavedShare()) {
  const existing = getSavedBucket();
  const isManual = isManualOverride();
  if (existing && (isManual || getSavedShare() === shareA)) {
    console.log('[Splitter] Loaded existing bucket:', existing, isManual ? '(manual)' : '(automatic)');
    return existing;
  }

  const key = await buildHashInput();
  const score = await hashToUint32(key);

  // A bucket set by hand while the hash was pending stands: the draw is dropped.
  const setByHand = isManualOverride() ? getSavedBucket() : null;
  if (setByHand) return setByHand;

  const threshold = bucketAThreshold(shareA);
  const bucket = score >= threshold ? "A" : "B";

  saveBucket(bucket, shareA);
  setManualOverride(false);

  console.log('[Splitter] New assignment:', {
    bucket,
    score,
    threshold,
    hashInput: key.substring(0, 50) + '...'
  });

  return bucket;
}

/**
 * Get the bucket assignment without reassigning
 * @returns {string|null} "A", "B", or null if not assigned
 */
function getSavedBucket() {
  try {
    return localStorage.getItem(FAIR_BUCKET_STORAGE_KEY);
  } catch (e) {
    console.warn('[Splitter] localStorage access failed:', e);
    return null;
  }
}

/**
 * Bucket A's share the stored bucket was drawn under: 0.5 when none (or no
 * valid one) is stored, as before shares were stored. A stored 0 is a share.
 * @returns {number}
 */
function getSavedShare() {
  try {
    const stored = localStorage.getItem(FAIR_BUCKET_SHARE_KEY);
    const share = stored && stored.trim() ? Number(stored) : NaN;
    return share >= 0 && share <= 1 ? share : 0.5;
  } catch (e) {
    return 0.5;
  }
}

/**
 * Save bucket assignment
 * @param {string} bucketName - "A" or "B"
 * @param {number} [shareA] - the share it was drawn under (omitted for a manual set)
 */
function saveBucket(bucketName, shareA) {
  try {
    localStorage.setItem(FAIR_BUCKET_STORAGE_KEY, bucketName);
    if (shareA !== undefined) localStorage.setItem(FAIR_BUCKET_SHARE_KEY, String(shareA));
  } catch (e) {
    console.warn('[Splitter] Failed to save bucket:', e);
  }
}

/**
 * Check if current assignment is a manual override
 * @returns {boolean}
 */
function isManualOverride() {
  try {
    return localStorage.getItem(FAIR_BUCKET_MANUAL_KEY) === "true";
  } catch (e) {
    return false;
  }
}

/**
 * Set manual override flag
 * @param {boolean} isManual
 */
function setManualOverride(isManual) {
  try {
    if (isManual) {
      localStorage.setItem(FAIR_BUCKET_MANUAL_KEY, "true");
    } else {
      localStorage.removeItem(FAIR_BUCKET_MANUAL_KEY);
    }
  } catch (e) {
    console.warn('[Splitter] Failed to set manual override flag:', e);
  }
}

/**
 * Manually set bucket (override automatic assignment)
 * @param {string} bucket - "A" or "B"
 */
function setFairBucket(bucket) {
  if (bucket !== "A" && bucket !== "B") {
    console.error('[Splitter] Invalid bucket:', bucket, '- must be "A" or "B"');
    return;
  }

  saveBucket(bucket);
  setManualOverride(true);

  console.log('[Splitter] Manual override set:', bucket);
}

/**
 * Clear bucket assignment and reassign
 * @param {number} shareA - Bucket A's share of visitors (default: the stored one, else 0.5)
 * @returns {Promise<string>} New bucket assignment
 */
async function clearFairBucket(shareA = getSavedShare()) {
  try {
    localStorage.removeItem(FAIR_BUCKET_STORAGE_KEY);
    localStorage.removeItem(FAIR_BUCKET_MANUAL_KEY);
    console.log('[Splitter] Cleared bucket assignment');
  } catch (e) {
    console.warn('[Splitter] Failed to clear bucket:', e);
  }

  return await assignFairBucket(shareA);
}

/**
 * Get what the hash-based assignment would be (without changing stored value)
 * @param {number} shareA - Bucket A's share of visitors (default: the stored one, else 0.5)
 * @returns {Promise<string>} "A" or "B"
 */
async function getHashBasedBucket(shareA = getSavedShare()) {
  const key = await buildHashInput();
  const score = await hashToUint32(key);
  return score >= bucketAThreshold(shareA) ? "A" : "B";
}

// ============================================================================
// IP and Hash Input Building
// ============================================================================

/**
 * Get user's IP address from GeoIP API
 * @returns {Promise<string>}
 */
async function getMyIpAddress() {
  try {
    // Use global getGeoIP if available
    if (typeof getGeoIP === 'function') {
      const data = await getGeoIP();
      const ip = String((data && data.ip) || "").trim();
      if (ip) return ip;
    }
  } catch (e) {
    console.warn('[Splitter] getGeoIP failed:', e);
  }

  // Fallback to random identifier if IP detection fails
  const randomId = `random-${Math.random().toString(36).substring(2, 15)}`;
  console.warn('[Splitter] IP detection failed, using random identifier');
  return randomId;
}

/**
 * Build hash input from IP + User Agent
 * @returns {Promise<string>}
 */
async function buildHashInput() {
  const ip = await getMyIpAddress();

  let ua = "";
  try {
    ua = String(navigator.userAgent || "");
  } catch (e) {
    console.warn('[Splitter] Failed to get user agent:', e);
    ua = "";
  }

  return (ip + "|" + ua).trim().toLowerCase();
}

// ============================================================================
// Hashing Functions
// ============================================================================

/**
 * Hash text to uint32 using SHA-256, with fallbacks
 * Exception-driven fallbacks: SHA-256 -> FNV-1a -> crypto.getRandomValues -> Math.random
 * @param {string} text
 * @returns {Promise<number>}
 */
async function hashToUint32(text) {
  const normalized = String(text);

  // Try modern path: TextEncoder + crypto.subtle.digest + DataView/Uint8Array
  try {
    let bytes;
    try {
      bytes = new TextEncoder().encode(normalized);
    } catch (e) {
      bytes = new Uint8Array(strToUtf8Bytes(normalized));
    }

    const buffer = await crypto.subtle.digest("SHA-256", bytes);

    try {
      const view = new DataView(buffer);
      return view.getUint32(0, false) >>> 0;
    } catch (e) {
      const u8 = new Uint8Array(buffer);
      return (((u8[0] << 24) | (u8[1] << 16) | (u8[2] << 8) | (u8[3])) >>> 0);
    }
  } catch (e) {
    console.warn('[Splitter] SHA-256 failed, using FNV-1a fallback');
  }

  // Deterministic fallback: FNV-1a 32-bit
  try {
    return fnv1a32(normalized);
  } catch (e) {
    console.warn('[Splitter] FNV-1a failed, using random fallback');
  }

  // Random fallback: crypto.getRandomValues, else Math.random
  try {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] >>> 0;
  } catch (e) {
    return Math.floor(Math.random() * 0x100000000) >>> 0;
  }
}

/**
 * Manual UTF-8 encoding via encodeURIComponent percent escapes
 * @param {string} str
 * @returns {number[]}
 */
function strToUtf8Bytes(str) {
  const enc = encodeURIComponent(str);
  const bytes = [];
  for (let i = 0; i < enc.length; i++) {
    const ch = enc[i];
    if (ch === "%") {
      bytes.push(parseInt(enc.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0));
    }
  }
  return bytes;
}

/**
 * FNV-1a 32-bit hash
 * @param {string} str
 * @returns {number}
 */
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

// ============================================================================
// Auto-log on load
// ============================================================================

console.log('[Splitter] Fair bucket splitter loaded. Usage: await assignFairBucket()');
