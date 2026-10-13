#!/usr/bin/env python3
"""
把工作台的每日资讯日报写进 Obsidian（替代原来 fetch_ai_radar.py 的归档部分）。

在 Mac 上用 cron 每天跑一次，时间排在工作台资讯雷达（北京时间 7 点）之后，例如：
  30 7 * * *  WORKBENCH_URL=https://你的工作台域名 DIGEST_TOKEN=口令 /usr/bin/python3 /路径/obsidian_sync.py

写入（与原脚本相同的目录）：
  <Vault>/AI 资讯/AI每日素材/ai_radar_YYYYMMDD.md
  <Vault>/AI 资讯/今日X推文/x_posts_YYYYMMDD.md
  <Vault>/AI 资讯/利他素材/altruism_perks_YYYYMMDD.md
  <Vault>/AI 资讯/AI资讯全归档.md   （按日期倒序汇总 AI每日素材，当天重跑会覆盖当天那一节）

只用标准库。可选参数：日期 YYYY-MM-DD（默认今天，按北京时间）。
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

VAULT = os.environ.get("OBSIDIAN_VAULT", os.path.expanduser("~/Documents/Obsidian Vault"))
BASE = os.path.join(VAULT, "AI 资讯")


def fetch_digest(day):
    url = os.environ["WORKBENCH_URL"].rstrip("/") + "/api/digest?day=" + day
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["DIGEST_TOKEN"]})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def rebuild_master_archive():
    src = os.path.join(BASE, "AI每日素材")
    days = {}
    for name in os.listdir(src):
        m = re.search(r"(\d{8})\.md$", name)
        if m:
            with open(os.path.join(src, name), encoding="utf-8") as f:
                days[m.group(1)] = f.read()
    lines = ["# AI 资讯全归档", "", "> 每天由 obsidian_sync.py 从工作台更新，最新的在最上面。", ""]
    for d in sorted(days, reverse=True):
        lines += ["---", "", f"## {d[:4]}-{d[4:6]}-{d[6:]}", "", days[d], ""]
    with open(os.path.join(BASE, "AI资讯全归档.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    beijing = datetime.now(timezone(timedelta(hours=8)))
    day = sys.argv[1] if len(sys.argv) > 1 else beijing.strftime("%Y-%m-%d")
    digest = fetch_digest(day)
    for rel, content in digest["files"].items():
        path = os.path.join(BASE, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        print("已写入", path)
    rebuild_master_archive()
    print("已更新 AI资讯全归档.md")


if __name__ == "__main__":
    main()
