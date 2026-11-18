# 自動化工程師 刷題網站

純靜態網頁（HTML + JS），不需要後端，可直接放在 GitHub Pages。

## 功能
- 自選題號範圍（第 N 題到第 M 題）與要刷的題數
- 隨機抽題 / 依題號順序；每次重新打亂選項（「以上皆是」、數字大小排列、圖形選項會固定順序）
- 每題作答後立刻看答案，或做完交卷再看
- 錯題本：只刷上次答錯的題、只刷沒做過的題、交卷後一鍵重刷錯題
- 作答紀錄存在瀏覽器 localStorage（不上傳）

## 在本機開啟
直接雙擊 `index.html` 即可（題庫是以 `<script>` 載入，不需要伺服器）。

## 補題目
1. 把新題目寫進 `source/` 下新的 `.txt`（例如 `q009.txt`），每行一題：
   ```
   題目|選項A|選項B|選項C|選項D|答案(A~D)|旗標(可省略)|備註(可省略)
   ```
   - 旗標 `F`：固定選項順序；`FIG`：選項是原書的圖
   - 選項含「以上皆是/皆非」會自動固定順序
2. 執行 `python scripts/build_data.py` 重新產生 `data/questions.js`
3. 提交並推送到 GitHub，網站就會更新

題號依檔名排序後依序累計，所以新增檔案只會接在最後面，不影響既有題號。

## 題目附圖（選用）
把圖片存成 `images/q064.jpg`（`q` + 三位數題號），重新執行 build 後，該題就會自動顯示圖片。

## 部署到 GitHub Pages
```
git init
git add .
git commit -m "init quiz site"
gh repo create automation-quiz --public --source=. --push
```
接著到 repo 的 Settings → Pages，Source 選 `main` 分支、`/ (root)`，
幾分鐘後網站就在 `https://<你的帳號>.github.io/automation-quiz/`。
