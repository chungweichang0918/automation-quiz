#!/usr/bin/env python3
"""把 source/<科目>/*.txt 的題目轉成網站使用的 data/<科目>.js 與 data/subjects.js。

資料夾結構：
  source/<科目代號>/subject.json   科目資訊（name、short、icon、order、desc）
  source/<科目代號>/q001.txt ...   題目，依檔名排序後依序累計題號
  images/<科目代號>/q064.jpg       （選用）第 64 題的原書附圖

題目格式，每行一題，用 | 分隔：
  題目 | 選項A | 選項B | 選項C | 選項D | 答案(A~D) | 旗標(可省略) | 備註(可省略)

旗標(可省略，可組合)：
  F    選項順序固定，不打亂（例如「以上皆是」、數字大小排列）
  FIG  選項是原書的圖，需對照原書（同樣不打亂）

新增科目：建立 source/<代號>/subject.json，放進題目 .txt，再執行本程式。
補題：在該科目資料夾新增 q013.txt…（舊題號不會改變）。

用法：python scripts/build_data.py
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYWORDS = ("以上皆", "皆非", "皆是", "皆可", "均可", "皆不適合", "皆有可能")


def build_subject(sid, folder):
    meta = {"name": sid, "short": sid, "icon": "📘", "order": 99, "desc": ""}
    meta_path = os.path.join(folder, "subject.json")
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            meta.update(json.load(f))
    questions = []
    for path in sorted(glob.glob(os.path.join(folder, "*.txt"))):
        with open(path, encoding="utf-8") as f:
            for lineno, line in enumerate(f, 1):
                line = line.rstrip("\n")
                if not line.strip():
                    continue
                p = line.split("|")
                if len(p) < 6 or p[5].strip() not in list("ABCD"):
                    sys.exit(f"格式錯誤：{os.path.relpath(path, ROOT)} 第 {lineno} 行")
                stem = p[0].strip()
                opts = [x.strip() for x in p[1:5]]
                ans = "ABCD".index(p[5].strip())
                flags = p[6].strip().upper() if len(p) > 6 else ""
                note = p[7].strip() if len(p) > 7 else ""
                fig = "FIG" in flags
                fixed = fig or "F" in flags or any(k in o for o in opts for k in KEYWORDS)
                q = {"id": len(questions) + 1, "q": stem, "opts": opts, "ans": ans}
                if fixed:
                    q["fixed"] = True
                if fig:
                    q["fig"] = True
                if note:
                    q["note"] = note
                rel = f"images/{sid}/q{q['id']:03d}.jpg"
                if os.path.exists(os.path.join(ROOT, rel)):
                    q["img"] = rel
                    # 有原書附圖就不需要文字版的圖形描述
                    q["q"] = re.sub(r"【圖：[^】]*】", "", q["q"])
                    q["q"] = re.sub(r"（[^（）]*請對照原書圖[^（）]*）", "", q["q"]).strip()
                questions.append(q)
    out = os.path.join(ROOT, "data", f"{sid}.js")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write("// 由 scripts/build_data.py 自動產生，請勿手動修改，改 source/ 即可\n")
        f.write("window.QBANKS = window.QBANKS || {};\n")
        f.write(f"window.QBANKS[{json.dumps(sid)}] = ")
        json.dump(questions, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    with_img = sum(1 for q in questions if "img" in q)
    meta.update({"id": sid, "count": len(questions)})
    print(f"{meta['name']}（{sid}）：{len(questions)} 題，{with_img} 題附圖 -> data/{sid}.js")
    return meta


def main():
    subjects = []
    base = os.path.join(ROOT, "source")
    for name in sorted(os.listdir(base)):
        folder = os.path.join(base, name)
        if os.path.isdir(folder):
            subjects.append(build_subject(name, folder))
    if not subjects:
        sys.exit("source/ 內沒有科目資料夾")
    subjects.sort(key=lambda s: (s.get("order", 99), s["id"]))
    with open(os.path.join(ROOT, "data", "subjects.js"), "w", encoding="utf-8") as f:
        f.write("// 由 scripts/build_data.py 自動產生\n")
        f.write("window.SUBJECTS = ")
        json.dump(subjects, f, ensure_ascii=False, indent=1)
        f.write(";\n")
    # 版本戳記：給 Service Worker 用，內容有變就換快取
    import time
    with open(os.path.join(ROOT, "data", "version.js"), "w", encoding="utf-8") as f:
        f.write(f'window.APP_VERSION = "{time.strftime("%Y%m%d%H%M%S")}";\n')


if __name__ == "__main__":
    main()
