import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "自媒体工作台",
  description: "从选题到复盘的一站式内容工作台",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
