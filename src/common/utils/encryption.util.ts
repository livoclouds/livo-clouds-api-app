import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encrypt(plaintext: string, keyHex: string): EncryptedPayload {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decrypt(
  ciphertext: string,
  iv: string,
  authTag: string,
  keyHex: string,
): string {
  try {
    const key = Buffer.from(keyHex, 'hex');
    const ivBuf = Buffer.from(iv, 'base64');
    const authTagBuf = Buffer.from(authTag, 'base64');
    const ciphertextBuf = Buffer.from(ciphertext, 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, ivBuf, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTagBuf);

    return decipher.update(ciphertextBuf).toString('utf8') + decipher.final('utf8');
  } catch {
    throw new Error('Decryption failed');
  }
}

export function verifyHmacSha256(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}
