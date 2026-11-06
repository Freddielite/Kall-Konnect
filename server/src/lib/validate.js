/**
 * Server-side validation. The forms in the app validate too, but anything
 * can POST to this API directly, so every write path checks its input here
 * and rejects it with a 400 that names the field — instead of passing it to
 * Postgres and echoing the raw constraint error back to the client.
 *
 * Each `field` spec is a function (value) => cleanedValue that throws a
 * ValidationError. `pick(body, specs, { partial })` applies them.
 */

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const fail = (field, why) => {
  throw new ValidationError(`${field} ${why}`);
};

// ── Primitive specs ─────────────────────────────────────────────────────

export const str = ({ min = 0, max, trim = true, nullable = false } = {}) => (v, field) => {
  if (v === null || v === undefined || v === '') {
    if (nullable) return null;
    if (min === 0 && v === '') return '';
    fail(field, 'is required');
  }
  if (typeof v !== 'string') fail(field, 'must be text');
  const s = trim ? v.trim() : v;
  if (s.length < min) fail(field, min === 1 ? 'is required' : `must be at least ${min} characters`);
  if (max !== undefined && s.length > max) fail(field, `must be at most ${max} characters`);
  if (nullable && s === '') return null;
  return s;
};

export const oneOf = (values, { nullable = false } = {}) => (v, field) => {
  if ((v === null || v === undefined) && nullable) return null;
  if (!values.includes(v)) fail(field, `must be one of: ${values.join(', ')}`);
  return v;
};

export const bool = () => (v, field) => {
  if (typeof v !== 'boolean') fail(field, 'must be true or false');
  return v;
};

export const int = ({ min, max, nullable = false } = {}) => (v, field) => {
  if ((v === null || v === undefined) && nullable) return null;
  if (!Number.isInteger(v)) fail(field, 'must be a whole number');
  if (min !== undefined && v < min) fail(field, `must be at least ${min}`);
  if (max !== undefined && v > max) fail(field, `must be at most ${max}`);
  return v;
};

/** A real calendar date as YYYY-MM-DD (rejects 2026-02-30). */
export const dateOnly = ({ nullable = true } = {}) => (v, field) => {
  if ((v === null || v === undefined || v === '') && nullable) return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(field, 'must be a date (YYYY-MM-DD)');
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2200) {
    fail(field, 'is not a real date');
  }
  return v;
};

/** An ISO-8601 timestamp; returned as an ISO string in UTC. */
export const timestamp = ({ nullable = true, notInFutureBy } = {}) => (v, field) => {
  if ((v === null || v === undefined || v === '') && nullable) return null;
  if (typeof v !== 'string' || v.length > 40) fail(field, 'must be a date and time');
  const t = Date.parse(v);
  if (Number.isNaN(t)) fail(field, 'must be a date and time');
  if (notInFutureBy !== undefined && t > Date.now() + notInFutureBy) fail(field, 'cannot be in the future');
  return new Date(t).toISOString();
};

export const arrayOf = (item, { max = 100 } = {}) => (v, field) => {
  if (!Array.isArray(v)) fail(field, 'must be a list');
  if (v.length > max) fail(field, `must have at most ${max} items`);
  return v.map((x, i) => item(x, `${field}[${i}]`));
};

export const timeOfDay = () => (v, field) => {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(field, 'must be a time (HH:MM)');
  return v;
};

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const timeZone = () => (v, field) => {
  if (!isValidTimeZone(v)) fail(field, 'must be an IANA timezone such as Africa/Lagos');
  return v;
};

/** Image for a contact: a data: URL from a vCard photo, or an https URL.
 * Anything else (javascript:, http:, arbitrary text) is refused. */
export const avatarUrl = () => (v, field) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') fail(field, 'must be text');
  if (v.length > 100_000) fail(field, 'image is too large');
  if (!/^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(v) && !/^https:\/\/\S+$/.test(v)) {
    fail(field, 'must be an image');
  }
  return v;
};

// ── Applying specs ──────────────────────────────────────────────────────

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Validates `body` against `specs`. With `partial`, only keys present in the
 * body are checked (PATCH); otherwise a missing key is passed as undefined,
 * so a spec decides whether it's required. Unknown keys are ignored.
 */
export function pick(body, specs, { partial = false } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const out = {};
  for (const [key, spec] of Object.entries(specs)) {
    if (partial && !has(body, key)) continue;
    const value = spec(body[key], key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Wraps a spec so an absent value gets a default instead of failing. */
export const optional = (spec, fallback) => (v, field) =>
  v === undefined ? fallback : spec(v, field);

// ── Shared field sets ───────────────────────────────────────────────────

export const RELATIONSHIPS = ['family', 'friend', 'colleague', 'acquaintance'];
export const CALL_FREQUENCIES = ['weekly', 'biweekly', 'monthly'];
export const CONTACT_TONES = ['warm', 'casual', 'friendly'];

const phone = str({ max: 40, nullable: true });
const handle = str({ max: 100, nullable: true });

export const CONTACT_FIELDS = {
  name: str({ min: 1, max: 200 }),
  phone,
  phone_secondary: phone,
  whatsapp_phone: phone,
  relationship: oneOf(RELATIONSHIPS),
  last_called: timestamp({ notInFutureBy: 24 * 3600_000 }),
  call_frequency: oneOf(CALL_FREQUENCIES),
  platforms: arrayOf(str({ min: 1, max: 40 }), { max: 20 }),
  priority: int({ min: 0, max: 10 }),
  is_favorite: bool(),
  birthday: dateOnly(),
  anniversary: dateOnly(),
  snoozed_until: timestamp(),
  custom_template: str({ max: 2000, nullable: true }),
  // Free text in older rows; the copy layer only acts on these three.
  template_tone: oneOf(CONTACT_TONES, { nullable: true }),
  instagram_username: handle,
  snapchat_username: handle,
};

/** Fields required on create, with the defaults the old INSERT applied. */
export const CONTACT_CREATE_FIELDS = {
  ...Object.fromEntries(
    Object.entries(CONTACT_FIELDS).map(([k, spec]) => [k, optional(spec, undefined)])
  ),
  name: CONTACT_FIELDS.name,
  relationship: CONTACT_FIELDS.relationship,
  call_frequency: CONTACT_FIELDS.call_frequency,
  avatar: avatarUrl(),
  platforms: optional(CONTACT_FIELDS.platforms, []),
  priority: optional(CONTACT_FIELDS.priority, 0),
  is_favorite: optional(CONTACT_FIELDS.is_favorite, false),
};

/** The password rule, in one place. bcrypt ignores everything past 72
 * bytes, so a longer password would silently match any string sharing
 * its first 72 bytes; refuse it instead. */
export const PASSWORD_MIN = 8;
export const password = () => (v, field) => {
  if (typeof v !== 'string' || v.length === 0) fail(field, 'is required');
  if (v.length < PASSWORD_MIN) fail(field, `must be at least ${PASSWORD_MIN} characters`);
  if (Buffer.byteLength(v, 'utf8') > 72) fail(field, 'must be at most 72 bytes');
  return v;
};

/** Normalized email: trimmed and lowercased. Deliberately permissive on
 * the local part (plus signs, apostrophes, dots all legal) — the
 * verification email is the real check. */
export function normalizeEmail(v) {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (e.length < 3 || e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

export const email = () => (v, field) => {
  const e = normalizeEmail(v);
  if (!e) fail(field, 'must be a valid email address');
  return e;
};
