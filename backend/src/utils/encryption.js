const crypto = require('crypto');

const REQUIRED_KEY_BYTES = 32;
const IV_LENGTH = 12;
const ALGORITHM = 'aes-256-gcm';

const getKey = () => {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
  if (!secret) {
    throw new Error('TOKEN_ENCRYPTION_KEY is not configured');
  }
  const hash = crypto.createHash('sha256').update(secret).digest();
  return hash.subarray(0, REQUIRED_KEY_BYTES);
};

const encrypt = (plainText) => {
  if (plainText == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
};

const decrypt = (payload) => {
  if (!payload) return null;
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) return null;
  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const encryptedText = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
  return decrypted.toString('utf8');
};

module.exports = {
  encrypt,
  decrypt,
};


