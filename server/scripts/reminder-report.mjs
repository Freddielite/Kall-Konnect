// Do reminders work? For each kind of reminder over the last N days:
// how many were sent, how many were opened (tapped), and how many were
// followed by a logged call to that person within 48 hours ("acted").
// Plus how many people have switched each kind off — the honest signal for
// whether a kind is welcome (HANDOVER: is the quiet-day nudge supportive or
// annoying?).
//
// Usage: npm run reminder-report [-- --days 30]
//
// Tracking starts with migration 016; reminders older than that show as
// never opened or acted on.

const { query, pool } = await import('../src/db.js');

const args = process.argv.slice(2);
const daysArg = args.indexOf('--days');
const days = daysArg >= 0 ? Math.max(1, parseInt(args[daysArg + 1], 10) || 30) : 30;
const pct = (n, d) => (d > 0 ? `${Math.round((100 * n) / d)}%`.padStart(5) : '    –');

const { rows } = await query(
  `SELECT type,
          count(*)::int AS sent,
          count(opened_at)::int AS opened,
          count(acted_at)::int AS acted,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM acted_at - created_at) / 3600)
            FILTER (WHERE acted_at IS NOT NULL) AS median_hours_to_call
     FROM notifications
    WHERE created_at > now() - make_interval(days => $1)
    GROUP BY type ORDER BY sent DESC`,
  [days]
);

console.log(`\nReminders, last ${days} days\n`);
console.log('  type            sent  opened   acted  median time to call');
let tSent = 0, tOpen = 0, tAct = 0;
for (const r of rows) {
  tSent += r.sent; tOpen += r.opened; tAct += r.acted;
  const median = r.median_hours_to_call == null ? '' : `${Number(r.median_hours_to_call).toFixed(1)} h`;
  console.log(`  ${r.type.padEnd(14)} ${String(r.sent).padStart(5)}   ${pct(r.opened, r.sent)}   ${pct(r.acted, r.sent)}  ${median}`);
}
if (rows.length === 0) console.log('  (none sent)');
else console.log(`  ${'all'.padEnd(14)} ${String(tSent).padStart(5)}   ${pct(tOpen, tSent)}   ${pct(tAct, tSent)}`);

const { rows: [u] } = await query(
  `SELECT count(*)::int AS users,
          count(*) FILTER (WHERE notifications_enabled)::int AS enabled,
          count(*) FILTER (WHERE quiet_day_nudges = false)::int AS quiet_off,
          count(*) FILTER (WHERE notification_categories->>'streak_risk' = 'false')::int AS streak_risk_off,
          count(*) FILTER (WHERE notification_categories->>'streak' = 'false')::int AS streak_off,
          count(*) FILTER (WHERE notification_categories->>'follow_up' = 'false')::int AS follow_up_off,
          count(*) FILTER (WHERE notification_categories->>'first_call' = 'false')::int AS first_call_off
     FROM user_preferences`
);
console.log(`\nSettings (${u.users} users, ${u.enabled} with reminders on)\n`);
for (const [label, n] of [
  ['quiet-day nudges off', u.quiet_off],
  ['evening streak nudge off', u.streak_risk_off],
  ['streak milestones off', u.streak_off],
  ['follow-up reminders off', u.follow_up_off],
  ['new-contact reminders off', u.first_call_off],
]) {
  console.log(`  ${label.padEnd(28)} ${String(n).padStart(4)}  ${pct(n, u.enabled)}`);
}

const { rows: [s] } = await query(
  "SELECT count(*)::int AS n FROM contacts WHERE remind_next_on IS NOT NULL AND deleted_at IS NULL"
);
console.log(`\n  "Remind me tomorrow" pending: ${s.n}\n`);
await pool.end();
