export interface ParsedVCardContact {
  name: string;
  phone?: string;
  email?: string;
  avatar?: string; // data URL, if a photo was embedded
}

/**
 * Unfold vCard "folded" lines: a line starting with a single space or tab
 * is a continuation of the previous line (RFC 6350 §3.2).
 */
function unfoldLines(raw: string): string[] {
  const rawLines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function decodeQuotedPrintable(value: string): string {
  return value
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Parses a single "PROP;PARAMS:VALUE" line into its parts. */
function splitLine(line: string): { prop: string; params: Record<string, string>; value: string } | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;

  const head = line.slice(0, colonIdx);
  let value = line.slice(colonIdx + 1);

  const parts = head.split(';');
  const prop = parts[0].toUpperCase();
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const [key, val] = parts[i].split('=');
    if (key && val) params[key.toUpperCase()] = val.toUpperCase();
  }

  if (params['ENCODING'] === 'QUOTED-PRINTABLE') {
    value = decodeQuotedPrintable(value);
  }

  return { prop, params, value };
}

/**
 * Parses raw .vcf file contents (one or many concatenated VCARD blocks)
 * into a flat list of contacts. Tolerant of vCard 2.1/3.0/4.0 quirks from
 * iOS, Android, Google, and Outlook exports.
 */
export function parseVCardFile(raw: string): ParsedVCardContact[] {
  const lines = unfoldLines(raw);
  const contacts: ParsedVCardContact[] = [];

  let current: ParsedVCardContact | null = null;
  let fallbackFromN: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      current = { name: '' };
      fallbackFromN = undefined;
      continue;
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      if (current) {
        if (!current.name.trim() && fallbackFromN) current.name = fallbackFromN;
        if (current.name.trim()) contacts.push(current);
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = splitLine(line);
    if (!parsed) continue;
    const { prop, params, value } = parsed;

    switch (prop) {
      case 'FN':
        current.name = value.trim();
        break;
      case 'N': {
        // N:Family;Given;Middle;Prefix;Suffix
        const bits = value.split(';').map(s => s.trim()).filter(Boolean);
        if (bits.length > 0) {
          const given = value.split(';')[1]?.trim();
          const family = value.split(';')[0]?.trim();
          fallbackFromN = [given, family].filter(Boolean).join(' ') || bits.join(' ');
        }
        break;
      }
      case 'TEL':
        if (!current.phone) {
          current.phone = value.trim();
        }
        break;
      case 'EMAIL':
        if (!current.email) {
          current.email = value.trim();
        }
        break;
      case 'PHOTO':
        if (params['ENCODING'] === 'B' || params['ENCODING'] === 'BASE64' || value.length > 100) {
          const type = (params['TYPE'] || 'JPEG').toLowerCase();
          if (!current.avatar) {
            current.avatar = `data:image/${type};base64,${value.trim()}`;
          }
        }
        break;
      default:
        break;
    }
  }

  // Deduplicate by name+phone (some exports repeat a contact across groups)
  const seen = new Set<string>();
  return contacts.filter(c => {
    const key = `${c.name.toLowerCase()}|${c.phone || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
