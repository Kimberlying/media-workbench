// 读取必需的环境变量；缺失时在用到的地方报错，而不是在构建时。
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，见 .env.example`);
  }
  return value;
}
