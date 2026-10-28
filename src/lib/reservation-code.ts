const CODE_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function getPublicReservationCode(value: string | null | undefined) {
  const source = String(value ?? "").trim();
  if (!source) return "BZA-RESERVA";

  let hashA = 2166136261;
  let hashB = 16777619;

  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + index;
    hashB = Math.imul(hashB, 2166136261);
  }

  const bytes = [
    (hashA >>> 24) & 31,
    (hashA >>> 19) & 31,
    (hashA >>> 14) & 31,
    (hashA >>> 9) & 31,
    (hashB >>> 24) & 31,
    (hashB >>> 19) & 31,
    (hashB >>> 14) & 31,
    (hashB >>> 9) & 31,
  ];

  return `BZA-${bytes.map((byte) => CODE_ALPHABET[byte]).join("")}`;
}
