function normalizePhone(raw, countryCode = '+55') {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  const cc = countryCode.replace(/\D/g, '');

  if (digits.startsWith(cc) && digits.length > cc.length + 7) {
    return `+${digits}`;
  }

  return `+${cc}${digits}`;
}

module.exports = { normalizePhone };
