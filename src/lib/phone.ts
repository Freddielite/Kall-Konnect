/** wa.me wants digits only: no spaces, dashes or leading plus. */
export function normalizePhoneForWhatsApp(phone: string): string {
  return phone.replace(/[\s\-+]/g, '');
}
