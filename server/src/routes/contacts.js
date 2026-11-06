import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { broadcastToUser } from '../ws.js';
import {
  pick, str, int, dateOnly, timestamp, arrayOf, optional, ValidationError,
  CONTACT_FIELDS, CONTACT_CREATE_FIELDS,
} from '../lib/validate.js';

export const contactsRouter = Router();

/** How long a deleted contact can be restored before purgeDeletedContacts
 * (run daily from jobs/cron.js) removes it for good. */
export const RESTORE_WINDOW_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 404 for anything that isn't a UUID, before it reaches Postgres. */
contactsRouter.param('id', (req, res, next, id) => {
  if (!UUID.test(id)) return res.status(404).json({ error: 'Contact not found' });
  next();
});

// ── Pagination ──────────────────────────────────────────────────────────
//
// Keyset ("cursor") pagination, newest first: each page asks for rows
// strictly older than the last one it saw, so page 400 costs the same as
// page 1 (an OFFSET would scan and discard every earlier row), and a
// contact added mid-scroll can't shift rows between pages.
//
// The cursor is opaque to clients: base64url of "<created_at ISO>|<id>".

const MAX_PAGE = 500;

function encodeCursor(row) {
  return Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length > 200) throw new ValidationError('cursor is invalid');
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || Number.isNaN(Date.parse(at)) || !UUID.test(id ?? '')) throw new ValidationError('cursor is invalid');
  return { at, id };
}

function pageParams(req) {
  const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw new ValidationError(`limit must be a whole number from 1 to ${MAX_PAGE}`);
  }
  return { limit, cursor: req.query.cursor ? decodeCursor(req.query.cursor) : null };
}

/** Runs a newest-first keyset query and returns { items, nextCursor }.
 * `where` uses $1 for the user id; cursor/limit params are appended. */
async function paginate(sql, where, userId, { limit, cursor }) {
  const params = [userId];
  let keyset = '';
  if (cursor) {
    params.push(cursor.at, cursor.id);
    keyset = ` AND (created_at, id) < ($2::timestamptz, $3::uuid)`;
  }
  params.push(limit + 1); // one extra row tells us whether another page exists
  const { rows } = await query(
    `${sql} WHERE ${where}${keyset} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params
  );
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
}

// ── Contacts ────────────────────────────────────────────────────────────

contactsRouter.get('/contacts', async (req, res) => {
  const page = await paginate(
    'SELECT * FROM contacts', 'user_id = $1 AND deleted_at IS NULL', req.userId, pageParams(req)
  );
  res.json(page);
});

/** Recently deleted contacts, for the "Restore" list. */
contactsRouter.get('/contacts/deleted', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, relationship, deleted_at,
            deleted_at + make_interval(days => $2) AS purge_after
       FROM contacts WHERE user_id = $1 AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC`,
    [req.userId, RESTORE_WINDOW_DAYS]
  );
  res.json(rows);
});

contactsRouter.post('/contacts', async (req, res) => {
  const c = pick(req.body ?? {}, CONTACT_CREATE_FIELDS);
  const columns = Object.keys(c);
  const values = columns.map((k) => (k === 'platforms' ? JSON.stringify(c[k]) : c[k]));
  const { rows } = await query(
    `INSERT INTO contacts (user_id, ${columns.join(', ')})
     VALUES ($1, ${columns.map((_, i) => `$${i + 2}`).join(', ')})
     RETURNING id`,
    [req.userId, ...values]
  );
  broadcastToUser(req.userId, { type: 'contacts' });
  res.status(201).json(rows[0]);
});

contactsRouter.patch('/contacts/:id', async (req, res) => {
  const updates = pick(req.body ?? {}, CONTACT_FIELDS, { partial: true });
  const fields = Object.keys(updates);
  if (fields.length === 0) return res.json({ ok: true });

  const values = fields.map((f) => (f === 'platforms' ? JSON.stringify(updates[f]) : updates[f]));
  values.push(req.params.id, req.userId);
  const { rowCount } = await query(
    `UPDATE contacts SET ${fields.map((f, i) => `${f} = $${i + 1}`).join(', ')}
      WHERE id = $${values.length - 1} AND user_id = $${values.length} AND deleted_at IS NULL`,
    values
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Contact not found' });
  broadcastToUser(req.userId, { type: 'contacts' });
  res.json({ ok: true });
});

/** Soft delete: hidden everywhere at once, restorable for RESTORE_WINDOW_DAYS. */
contactsRouter.delete('/contacts/:id', async (req, res) => {
  const { rowCount } = await query(
    'UPDATE contacts SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [req.params.id, req.userId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Contact not found' });
  broadcastToUser(req.userId, { type: 'contacts' });
  res.status(204).end();
});

contactsRouter.post('/contacts/:id/restore', async (req, res) => {
  const { rowCount } = await query(
    'UPDATE contacts SET deleted_at = NULL WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL',
    [req.params.id, req.userId]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'Contact not found' });
  broadcastToUser(req.userId, { type: 'contacts' });
  res.json({ ok: true });
});

/** Deletes contacts soft-deleted more than RESTORE_WINDOW_DAYS ago, with
 * their notes and dates (ON DELETE CASCADE). Called daily by jobs/cron.js. */
export async function purgeDeletedContacts() {
  const { rowCount } = await query(
    `DELETE FROM contacts WHERE deleted_at IS NOT NULL
        AND deleted_at < now() - make_interval(days => $1)`,
    [RESTORE_WINDOW_DAYS]
  );
  return rowCount;
}

async function ownsLiveContact(contactId, userId, db = { query }) {
  if (typeof contactId !== 'string' || !UUID.test(contactId)) return false;
  const { rowCount } = await db.query(
    'SELECT 1 FROM contacts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [contactId, userId]
  );
  return rowCount > 0;
}

// ── Call notes ──────────────────────────────────────────────────────────

const LIVE_CONTACT_OF_USER = 'contact_id IN (SELECT id FROM contacts WHERE user_id = $1 AND deleted_at IS NULL)';

contactsRouter.get('/call-notes', async (req, res) => {
  const page = await paginate(
    'SELECT * FROM call_notes', `user_id = $1 AND ${LIVE_CONTACT_OF_USER}`, req.userId, pageParams(req)
  );
  res.json(page);
});

const CALL_NOTE_FIELDS = {
  contact_id: str({ min: 1, max: 64 }),
  content: str({ min: 1, max: 5000 }),
  duration: optional(int({ min: 0, max: 24 * 3600, nullable: true }), null),
  // Backdated for a call logged after the fact; a few minutes of clock
  // skew between phone and server is tolerated.
  called_at: optional(timestamp({ notInFutureBy: 5 * 60_000 }), null),
};

contactsRouter.post('/call-notes', async (req, res) => {
  const { contact_id, content, duration, called_at } = pick(req.body ?? {}, CALL_NOTE_FIELDS);
  // Ownership check: the contact must belong to this user (no RLS to catch this for us).
  if (!(await ownsLiveContact(contact_id, req.userId))) {
    return res.status(404).json({ error: 'Contact not found' });
  }
  const { rows } = await query(
    `INSERT INTO call_notes (contact_id, user_id, content, duration, called_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()))
     RETURNING id, contact_id, content, duration, called_at, created_at`,
    [contact_id, req.userId, content, duration, called_at]
  );
  broadcastToUser(req.userId, { type: 'contacts' });
  res.status(201).json(rows[0]);
});

// ── Special dates ───────────────────────────────────────────────────────

contactsRouter.get('/special-dates', async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM special_dates WHERE user_id = $1 AND ${LIVE_CONTACT_OF_USER} ORDER BY date ASC`,
    [req.userId]
  );
  res.json(rows);
});

const specialDate = (v, field) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ValidationError(`${field} must be an object`);
  return {
    label: str({ min: 1, max: 100 })(v.label, `${field}.label`),
    date: dateOnly({ nullable: false })(v.date, `${field}.date`),
  };
};

/** Blank rows (an empty label or no date) are dropped rather than
 * rejected: the edit form submits its empty "add another" row, and the
 * previous version of this route skipped those silently too. */
function readSpecialDates(body) {
  const raw = body?.dates;
  if (!Array.isArray(raw)) throw new ValidationError('dates must be a list');
  const filled = raw.filter((sd) => !(sd && typeof sd === 'object' && (!String(sd.label ?? '').trim() || !sd.date)));
  return arrayOf(specialDate, { max: 50 })(filled, 'dates');
}

// Replaces all special dates for one contact. One transaction: previously
// a failure halfway through the inserts left the contact with only some of
// its dates, having already deleted the rest.
contactsRouter.put('/contacts/:id/special-dates', async (req, res) => {
  const contactId = req.params.id;
  const dates = readSpecialDates(req.body);

  const found = await withTransaction(async (client) => {
    if (!(await ownsLiveContact(contactId, req.userId, client))) return false;
    await client.query('DELETE FROM special_dates WHERE contact_id = $1 AND user_id = $2', [contactId, req.userId]);
    for (const sd of dates) {
      await client.query(
        'INSERT INTO special_dates (user_id, contact_id, label, date) VALUES ($1, $2, $3, $4)',
        [req.userId, contactId, sd.label, sd.date]
      );
    }
    return true;
  });
  if (!found) return res.status(404).json({ error: 'Contact not found' });
  broadcastToUser(req.userId, { type: 'contacts' });
  res.json({ ok: true });
});
