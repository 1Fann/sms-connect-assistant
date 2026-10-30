import { parsePhoneNumberFromString, AsYouType, type CountryCode } from 'libphonenumber-js/max';
export type { CountryCode };
// Full international metadata, same approach as Asterisk Assistant. Display never changes dial identity.
export function formatPhone(raw: string, region: CountryCode = 'CN'): string {
  if (!/^\+?[\d ().-]+$/.test(raw) || raw.replace(/\D/g,'').length <= 6) return raw;
  const phone = parsePhoneNumberFromString(raw, region);
  if(!phone?.isValid()) return raw;
  const formatted = raw.trim().startsWith('+') ? phone.formatInternational() : phone.formatNational();
  if(formatted.replace(/\D/g,'') !== raw.replace(/\D/g,'')) {
    const typed = new AsYouType(region).input(raw);
    return typed.replace(/\D/g,'') === raw.replace(/\D/g,'') ? typed : raw;
  }
  return formatted;
}
export function identity(raw: string, region: CountryCode = 'CN'): string {
  let n=raw.replace(/[\s().-]/g,'');
  if(region==='CN' && /^86(1[3-9]\d{9})$/.test(n)) n='+'+n;
  const p=parsePhoneNumberFromString(n,region);
  return p?.isValid() ? p.number : n;
}
