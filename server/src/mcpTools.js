import { query } from './db.js';
import { pick, int, str, oneOf, bool, dateOnly, optional, CONTACT_FIELDS, RELATIONSHIPS, CALL_FREQUENCIES } from './lib/validate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FREQUENCY_DAYS = { weekly: 7, biweekly: 14, monthly: 30 };

function textResult(value, structuredKey) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: { [structuredKey]: value } };
}
function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export const tools = {
  who_to_call: {
    title: 'Who to call next',
    description: 'Suggest which contacts are overdue for a check-in, based on their call frequency and when they were last called.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many suggestions to return (default 5).' } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args, userId) => {
      const { limit } = pick(args, { limit: optional(int({ min: 1, max: 20 }), 5) });
      const { rows } = await query(
        'SELECT id, name, relationship, call_frequency, priority, is_favorite, last_called, snoozed_until FROM contacts WHERE user_id = $1 AND deleted_at IS NULL',
        [userId]
      );
      const now = Date.now();
      const suggestions = rows
        .filter((c) => !c.snoozed_until || new Date(c.snoozed_until).getTime() <= now)
        .map((c) => {
          const days = FREQUENCY_DAYS[c.call_frequency] ?? 14;
          const last = c.last_called ? new Date(c.last_called).getTime() : null;
          const daysSince = last === null ? null : Math.floor((now - last) / 86_400_000);
          const overdueBy = daysSince === null ? 9999 : daysSince - days;
          return {
            id: c.id, name: c.name, relationship: c.relationship, callFrequency: c.call_frequency,
            isFavorite: c.is_favorite, daysSinceLastCall: daysSince, overdueByDays: overdueBy,
          };
        })
        .sort((a, b) => b.overdueByDays - a.overdueByDays)
        .slice(0, limit);
      return textResult(suggestions, 'suggestions');
    },
  },

  list_contacts: {
    title: 'List contacts',
    description: "List the signed-in user's contacts, including relationship, call frequency, favorite flag, phone number, social usernames, and when they were last called.",
    inputSchema: {
      type: 'object',
      properties: {
        relationship: { type: 'string', enum: ['family', 'friend', 'colleague', 'acquaintance'] },
        favoritesOnly: { type: 'boolean' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args, userId) => {
      const { relationship, favoritesOnly, limit } = pick(args, {
        relationship: optional(oneOf(RELATIONSHIPS), undefined),
        favoritesOnly: optional(bool(), false),
        limit: optional(int({ min: 1, max: 200 }), 50),
      });
      const conditions = ['user_id = $1', 'deleted_at IS NULL'];
      const params = [userId];
      if (relationship) { params.push(relationship); conditions.push(`relationship = $${params.length}`); }
      if (favoritesOnly) conditions.push('is_favorite = true');
      params.push(limit);

      const { rows } = await query(
        `SELECT id, name, phone, instagram_username, snapchat_username, relationship, call_frequency,
                priority, is_favorite, last_called, birthday, anniversary
         FROM contacts WHERE ${conditions.join(' AND ')} ORDER BY name ASC LIMIT $${params.length}`,
        params
      );
      return textResult(rows, 'contacts');
    },
  },

  add_contact: {
    title: 'Add contact',
    description: 'Create a new contact for the signed-in user.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        phone: { type: 'string' },
        instagramUsername: { type: 'string' },
        snapchatUsername: { type: 'string' },
        relationship: { type: 'string', enum: ['family', 'friend', 'colleague', 'acquaintance'] },
        callFrequency: { type: 'string', enum: ['weekly', 'biweekly', 'monthly'] },
        isFavorite: { type: 'boolean' },
        birthday: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      required: ['name', 'relationship'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (rawArgs, userId) => {
      const args = pick(rawArgs, {
        name: CONTACT_FIELDS.name,
        phone: optional(CONTACT_FIELDS.phone, null),
        instagramUsername: optional(CONTACT_FIELDS.instagram_username, null),
        snapchatUsername: optional(CONTACT_FIELDS.snapchat_username, null),
        relationship: CONTACT_FIELDS.relationship,
        callFrequency: optional(oneOf(CALL_FREQUENCIES), 'weekly'),
        isFavorite: optional(bool(), false),
        birthday: optional(dateOnly(), null),
      });
      const { rows } = await query(
        `INSERT INTO contacts (user_id, name, phone, instagram_username, snapchat_username, relationship, call_frequency, is_favorite, birthday, platforms, priority)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, name, relationship, call_frequency, instagram_username, snapchat_username`,
        [
          userId, args.name, args.phone ?? null, args.instagramUsername ?? null, args.snapchatUsername ?? null,
          args.relationship, args.callFrequency ?? 'weekly', args.isFavorite ?? false, args.birthday ?? null,
          JSON.stringify(['phone']), 3,
        ]
      );
      return textResult(rows[0] ?? null, 'contact');
    },
  },

  log_call: {
    title: 'Log a call',
    description: "Record a call with a contact: saves a note and updates the contact's last-called timestamp.",
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', format: 'uuid' },
        note: { type: 'string', minLength: 1 },
        durationMinutes: { type: 'integer', minimum: 0, maximum: 600 },
      },
      required: ['contactId', 'note'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (args, userId) => {
      const { contactId, note, durationMinutes } = pick(args, {
        contactId: str({ min: 1, max: 64 }),
        note: str({ min: 1, max: 5000 }),
        durationMinutes: optional(int({ min: 0, max: 600 }), null),
      });
      if (!UUID.test(contactId)) return errorResult('Contact not found');
      const owns = await query(
        'SELECT 1 FROM contacts WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [contactId, userId]
      );
      if (owns.rowCount === 0) return errorResult('Contact not found');

      const { rows } = await query(
        `INSERT INTO call_notes (contact_id, user_id, content, duration)
         VALUES ($1,$2,$3,$4) RETURNING id, contact_id, content, duration, created_at`,
        [contactId, userId, note, durationMinutes]
      );
      await query('UPDATE contacts SET last_called = now() WHERE id = $1 AND user_id = $2', [contactId, userId]);
      return textResult(rows[0] ?? null, 'callNote');
    },
  },

  list_call_notes: {
    title: 'List call notes',
    description: "Read the signed-in user's recent call notes, optionally filtered to one contact.",
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string', format: 'uuid' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async (args, userId) => {
      const { contactId, limit } = pick(args, {
        contactId: optional(str({ min: 1, max: 64 }), undefined),
        limit: optional(int({ min: 1, max: 100 }), 20),
      });
      if (contactId && !UUID.test(contactId)) return errorResult('Contact not found');
      // Notes of a deleted contact stay hidden until it's restored or purged.
      const conditions = [
        'user_id = $1',
        'contact_id IN (SELECT id FROM contacts WHERE user_id = $1 AND deleted_at IS NULL)',
      ];
      const params = [userId];
      if (contactId) { params.push(contactId); conditions.push(`contact_id = $${params.length}`); }
      params.push(limit);

      const { rows } = await query(
        `SELECT id, contact_id, content, duration, created_at FROM call_notes
         WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,
        params
      );
      return textResult(rows, 'notes');
    },
  },
};

export function toolManifest() {
  return Object.entries(tools).map(([name, t]) => ({
    name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));
}
