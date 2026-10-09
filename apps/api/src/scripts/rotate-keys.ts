/**
 * Re-encrypts every token and secret setting with the active ENCRYPTION_KEY.
 * Run after moving the old key to ENCRYPTION_KEYS_PREVIOUS; remove the old key once this reports 0 remaining.
 */
const { cipher, settingContext, tokenContext } = await import('../lib/encryption.js');
const { prisma } = await import('../lib/prisma.js');

let rotated = 0;
let cursor: string | undefined;

for (;;) {
  const members = await prisma.member.findMany({
    where: { OR: [{ accessTokenEnc: { not: null } }, { refreshTokenEnc: { not: null } }] },
    select: { id: true, discordId: true, accessTokenEnc: true, refreshTokenEnc: true },
    orderBy: { id: 'asc' },
    take: 500,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  if (members.length === 0) break;

  for (const member of members) {
    const reencrypt = (value: string | null, kind: 'access' | 'refresh') => {
      if (!value || !cipher.needsRotation(value)) return value;
      const context = tokenContext(member.discordId, kind);
      return cipher.encrypt(cipher.decrypt(value, context), context);
    };
    const accessTokenEnc = reencrypt(member.accessTokenEnc, 'access');
    const refreshTokenEnc = reencrypt(member.refreshTokenEnc, 'refresh');
    if (accessTokenEnc !== member.accessTokenEnc || refreshTokenEnc !== member.refreshTokenEnc) {
      // Guarded on the old ciphertext so a concurrent token refresh is never overwritten.
      const { count } = await prisma.member.updateMany({
        where: { id: member.id, accessTokenEnc: member.accessTokenEnc, refreshTokenEnc: member.refreshTokenEnc },
        data: { accessTokenEnc, refreshTokenEnc },
      });
      rotated += count;
    }
  }
  cursor = members.at(-1)!.id;
}

const settings = await prisma.setting.findMany({ where: { encrypted: true } });
for (const setting of settings) {
  if (!cipher.needsRotation(setting.value)) continue;
  const context = settingContext(setting.key);
  await prisma.setting.update({
    where: { key: setting.key },
    data: { value: cipher.encrypt(cipher.decrypt(setting.value, context), context) },
  });
  rotated += 1;
}

console.log(`Re-encrypted ${rotated} record(s) with the active key.`);
await prisma.$disconnect();
process.exit(0);
