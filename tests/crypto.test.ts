import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const key = randomBytes(32).toString("base64");

describe("令牌加密", () => {
  it("加密后能解回原文，且每次密文不同", () => {
    const a = encryptSecret("token-123", key);
    const b = encryptSecret("token-123", key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe("token-123");
  });

  it("密文被改动时解密失败", () => {
    const sealed = encryptSecret("token-123", key);
    const [iv, tag, data] = sealed.split(".");
    const tampered = Buffer.from(data, "base64");
    tampered[0] ^= 1;
    expect(() => decryptSecret([iv, tag, tampered.toString("base64")].join("."), key)).toThrow();
  });

  it("密钥长度不对时报错", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 字节/);
  });
});
