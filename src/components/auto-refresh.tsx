"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 后台任务还在跑时，隔几秒重新取一次页面数据，转写、整理好了自动显示
export function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
