"use client";

import { useEffect, useRef } from "react";

// 把浏览器时区偏移随表单提交，服务端据此把 datetime-local 换成 UTC
export function TzOffsetInput() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = String(new Date().getTimezoneOffset());
  }, []);
  return <input ref={ref} type="hidden" name="tz_offset" defaultValue="0" />;
}
