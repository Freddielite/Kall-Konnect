// Lists accounts that share an email address in different case, flagged by
// migration 012. Each group is one person with two (or more) accounts;
// merge them with:  npm run merge-accounts -- --keep <id> --remove <id>
//
// Usage: npm run email-conflicts

const { query, pool } = await import('../src/db.js');

const { rows } = await query(`
  SELECT lower(u.email) AS address, u.id, u.email, u.created_at,
         u.password_hash IS NOT NULL AS has_password, u.google_sub IS NOT NULL AS has_google,
         (SELECT count(*) FROM contacts c WHERE c.user_id = u.id AND c.deleted_at IS NULL)::int AS contacts,
         (SELECT count(*) FROM call_notes n WHERE n.user_id = u.id)::int AS notes,
         (SELECT max(created_at) FROM refresh_tokens r WHERE r.user_id = u.id) AS last_sign_in
    FROM users u
   WHERE u.email_case_conflict
   ORDER BY lower(u.email), u.created_at`);

if (rows.length === 0) {
  console.log('No case-duplicate accounts. Nothing to merge.');
} else {
  let current = null;
  for (const r of rows) {
    if (r.address !== current) {
      current = r.address;
      console.log(`\n${r.address}`);
    }
    const signIn = r.last_sign_in ? new Date(r.last_sign_in).toISOString().slice(0, 10) : 'never';
    console.log(
      `  ${r.id}  stored as ${JSON.stringify(r.email)}  created ${r.created_at.toISOString().slice(0, 10)}  ` +
        `last sign-in ${signIn}  ${r.contacts} contacts, ${r.notes} notes` +
        `${r.has_password ? '' : '  (no password)'}${r.has_google ? '  (Google)' : ''}`
    );
  }
  console.log('\nKeep the account the person actually uses (usually most recent sign-in), then:');
  console.log('  npm run merge-accounts -- --keep <id> --remove <id>          (preview)');
  console.log('  npm run merge-accounts -- --keep <id> --remove <id> --yes    (do it)');
}
await pool.end();
