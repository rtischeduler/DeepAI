/**
 * Fair Bucket Splitter
 *
 * Deterministic 50/50 A/B bucketing using SHA-256 hashing
 *
 * Bucket A (score >= 2^31) → Koah ad system
 * Bucket B (score < 2^31) → Gravity/Thrad ad system
 *
 * Usage:
 *   const bucket = await assignFairBucket();
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

const EXACT_MIDDLE_POINT = 2147483648; // 2^31
const FAIR_BUCKET_STORAGE_KEY = 'fair_bucket';
const FAIR_BUCKET_MANUAL_KEY = 'fair_bucket_manual';

// ============================================================================
// Core Bucketing Logic
// ============================================================================

/**
 * Assigns user to a fair bucket (A or B) based on IP + User Agent hash
 * Returns existing assignment if already stored
 * @returns {Promise<string>} "A" or "B"
 */
async function assignFairBucket() {
  const existing = getSavedBucket();
  if (existing) {
    const isManual = isManualOverride();
    console.log('[Splitter] Loaded existing bucket:', existing, isManual ? '(manual)' : '(automatic)');
    return existing;
  }

  const key = await buildHashInput();
  const score = await hashToUint32(key);
  const bucket = score >= EXACT_MIDDLE_POINT ? "A" : "B";

  saveBucket(bucket);
  setManualOverride(false);

  console.log('[Splitter] New assignment:', {
    bucket,
    score,
    threshold: EXACT_MIDDLE_POINT,
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
 * Save bucket assignment
 * @param {string} bucketName - "A" or "B"
 */
function saveBucket(bucketName) {
  try {
    localStorage.setItem(FAIR_BUCKET_STORAGE_KEY, bucketName);
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
 * @returns {Promise<string>} New bucket assignment
 */
async function clearFairBucket() {
  try {
    localStorage.removeItem(FAIR_BUCKET_STORAGE_KEY);
    localStorage.removeItem(FAIR_BUCKET_MANUAL_KEY);
    console.log('[Splitter] Cleared bucket assignment');
  } catch (e) {
    console.warn('[Splitter] Failed to clear bucket:', e);
  }

  return await assignFairBucket();
}

/**
 * Get what the hash-based assignment would be (without changing stored value)
 * @returns {Promise<string>} "A" or "B"
 */
async function getHashBasedBucket() {
  const key = await buildHashInput();
  const score = await hashToUint32(key);
  return score >= EXACT_MIDDLE_POINT ? "A" : "B";
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
