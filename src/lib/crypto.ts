import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// 平台授权令牌的加解密：AES-256-GCM。密钥是 32 字节，以 base64 放在 TOKEN_ENCRYPTION_KEY。
// 密文格式：base64(iv).base64(tag).base64(ciphertext)

function loadKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("缺少环境变量 TOKEN_ENCRYPTION_KEY");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY 必须是 32 字节的 base64");
  return key;
}

export function encryptSecret(plain: string, rawKey = process.env.TOKEN_ENCRYPTION_KEY): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(sealed: string, rawKey = process.env.TOKEN_ENCRYPTION_KEY): string {
  const key = loadKey(rawKey);
  const [iv, tag, data] = sealed.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data) throw new Error("密文格式不对");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
