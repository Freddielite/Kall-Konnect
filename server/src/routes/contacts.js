import { Router } from 'express';
import { query } from '../db.js';
import { broadcastToUser } from '../ws.js';

export const contactsRouter = Router();

// ── Contacts ────────────────────────────────────────────────────────────

contactsRouter.get('/contacts', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM contacts WHERE user_id = $1 ORDER BY created_at DESC',
    [req.userId]
  );
  res.json(rows);
});

contactsRouter.post('/contacts', async (req, res) => {
  const c = req.body ?? {};
  try {
    const { rows } = await query(
      `INSERT INTO contacts (
         user_id, name, phone, phone_secondary, whatsapp_phone, avatar, relationship,
         last_called, call_frequency, platforms, priority, is_favorite, birthday,
         anniversary, snoozed_until, custom_template, template_tone,
         instagram_username, snapchat_username
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        req.userId, c.name, c.phone ?? null, c.phone_secondary ?? null, c.whatsapp_phone ?? null,
        c.avatar ?? null, c.relationship, c.last_called ?? null, c.call_frequency,
        JSON.stringify(c.platforms ?? []), c.priority ?? 0, c.is_favorite ?? false,
        c.birthday ?? null, c.anniversary ?? null, c.snoozed_until ?? null,
        c.custom_template ?? null, c.template_tone ?? null,
        c.instagram_username ?? null, c.snapchat_username ?? null,
      ]
    );
    broadcastToUser(req.userId, { type: 'contacts' });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('create contact error:', err);
    res.status(400).json({ error: err.message });
  }
});

const PATCHABLE_CONTACT_FIELDS = [
  'name', 'phone', 'phone_secondary', 'whatsapp_phone', 'relationship', 'last_called',
  'call_frequency', 'platforms', 'priority', 'is_favorite', 'birthday', 'anniversary',
  'snoozed_until', 'custom_template', 'template_tone', 'instagram_username', 'snapchat_username',
];

contactsRouter.patch('/contacts/:id', async (req, res) => {
  const updates = req.body ?? {};
  const setClauses = [];
  const values = [];
  for (const field of PATCHABLE_CONTACT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      values.push(field === 'platforms' ? JSON.stringify(updates[field]) : updates[field]);
      setClauses.push(`${field} = $${values.length}`);
    }
  }
  if (setClauses.length === 0) return res.json({ ok: true });

  values.push(req.params.id, req.userId);
  try {
    const { rowCount } = await query(
      `UPDATE contacts SET ${setClauses.join(', ')} WHERE id = $${values.length - 1} AND user_id = $${values.length}`,
      values
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Contact not found' });
    broadcastToUser(req.userId, { type: 'contacts' });
    res.json({ ok: true });
  } catch (err) {
    console.error('update contact error:', err);
    res.status(400).json({ error: err.message });
  }
});

contactsRouter.delete('/contacts/:id', async (req, res) => {
  const { rowCount } = await query('DELETE FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  if (rowCount === 0) return res.status(404).json({ error: 'Contact not found' });
  broadcastToUser(req.userId, { type: 'contacts' });
  res.status(204).end();
});

// ── Call notes ──────────────────────────────────────────────────────────

contactsRouter.get('/call-notes', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM call_notes WHERE user_id = $1 ORDER BY created_at DESC',
    [req.userId]
  );
  res.json(rows);
});

contactsRouter.post('/call-notes', async (req, res) => {
  const { contact_id, content, duration } = req.body ?? {};
  if (!contact_id || !content) return res.status(400).json({ error: 'contact_id and content are required' });

  try {
    // Ownership check: the contact must belong to this user (no RLS to catch this for us).
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND user_id = $2', [contact_id, req.userId]);
    if (owns.rowCount === 0) return res.status(404).json({ error: 'Contact not found' });

    const { rows } = await query(
      `INSERT INTO call_notes (contact_id, user_id, content, duration)
       VALUES ($1, $2, $3, $4) RETURNING id, contact_id, content, duration, created_at`,
      [contact_id, req.userId, content, duration ?? null]
    );
    broadcastToUser(req.userId, { type: 'contacts' });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('create call note error:', err);
    res.status(400).json({ error: err.message });
  }
});

// ── Special dates ───────────────────────────────────────────────────────

contactsRouter.get('/special-dates', async (req, res) => {
  const { rows } = await query(
    'SELECT * FROM special_dates WHERE user_id = $1 ORDER BY date ASC',
    [req.userId]
  );
  res.json(rows);
});

// Replaces all special dates for one contact in one call (mirrors the
// delete-then-insert pattern the frontend already used against Supabase).
contactsRouter.put('/contacts/:id/special-dates', async (req, res) => {
  const contactId = req.params.id;
  const dates = Array.isArray(req.body?.dates) ? req.body.dates : [];

  try {
    const owns = await query('SELECT 1 FROM contacts WHERE id = $1 AND user_id = $2', [contactId, req.userId]);
    if (owns.rowCount === 0) return res.status(404).json({ error: 'Contact not found' });

    await query('DELETE FROM special_dates WHERE contact_id = $1', [contactId]);

    for (const sd of dates) {
      if (!sd.label?.trim() || !sd.date) continue;
      await query(
        'INSERT INTO special_dates (user_id, contact_id, label, date) VALUES ($1, $2, $3, $4)',
        [req.userId, contactId, sd.label.trim(), sd.date]
      );
    }
    broadcastToUser(req.userId, { type: 'contacts' });
    res.json({ ok: true });
  } catch (err) {
    console.error('replace special dates error:', err);
    res.status(400).json({ error: err.message });
  }
});
