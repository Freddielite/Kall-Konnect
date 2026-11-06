import bcrypt from 'bcryptjs';

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

// A real cost-12 hash of a random string, computed once. Comparing against
// it when no account exists makes "no such email" take as long as "wrong
// password", so response timing can't be used to discover which emails are
// registered.
let dummyHash;
async function getDummyHash() {
  dummyHash ??= await bcrypt.hash(`no-account-${Math.random()}`, 12);
  return dummyHash;
}

export async function verifyPassword(password, hash) {
  if (typeof password !== 'string') return false;
  if (!hash) {
    await bcrypt.compare(password, await getDummyHash());
    return false;
  }
  return bcrypt.compare(password, hash);
}
