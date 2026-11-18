#!/usr/bin/env python3
"""把 source/*.txt 的題目轉成網站使用的 data/questions.js。

每一行一題，用 | 分隔：
  題目 | 選項A | 選項B | 選項C | 選項D | 答案(A~D) | 旗標 | 備註(可省略)

旗標(可省略，可組合)：
  F    選項順序固定，不打亂（例如「以上皆是」、數字大小排列）
  FIG  選項是原書的圖，需對照原書（同樣不打亂）

題號：依檔名排序後，依序累計編號（q001.txt 在前、q002.txt 在後…）。
之後補拍新的題目時，新增 q009.txt、q010.txt…，再執行本程式即可，
既有題號不會改變。

用法：python scripts/build_data.py
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYWORDS = ("以上皆", "皆非", "皆是", "皆可", "均可", "皆不適合", "皆有可能")


def main():
    files = sorted(glob.glob(os.path.join(ROOT, "source", "*.txt")))
    if not files:
        sys.exit("source/ 內沒有 .txt 檔")
    questions = []
    for path in files:
        with open(path, encoding="utf-8") as f:
            for lineno, line in enumerate(f, 1):
                line = line.rstrip("\n")
                if not line.strip():
                    continue
                p = line.split("|")
                if len(p) < 6 or p[5].strip() not in list("ABCD"):
                    sys.exit(f"格式錯誤：{os.path.basename(path)} 第 {lineno} 行")
                stem, opts, ans = p[0].strip(), [x.strip() for x in p[1:5]], "ABCD".index(p[5].strip())
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
                img = os.path.join(ROOT, "images", f"q{q['id']:03d}.jpg")
                if os.path.exists(img):
                    q["img"] = f"images/q{q['id']:03d}.jpg"
                    # 有原書附圖就不需要文字版的圖形描述
                    q["q"] = re.sub(r"【圖：[^】]*】", "", q["q"])
                    q["q"] = re.sub(r"（[^（）]*請對照原書圖[^（）]*）", "", q["q"]).strip()
                questions.append(q)
    out = os.path.join(ROOT, "data", "questions.js")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write("// 由 scripts/build_data.py 自動產生，請勿手動修改，改 source/*.txt 即可\n")
        f.write("window.QUESTIONS = ")
        json.dump(questions, f, ensure_ascii=False, indent=0)
        f.write(";\n")
    print(f"完成：共 {len(questions)} 題 -> data/questions.js")


if __name__ == "__main__":
    main()
