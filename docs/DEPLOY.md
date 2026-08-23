# 部署到 Render(含 PostgreSQL)

系統分成三塊:**PostgreSQL 資料庫**、**後端 API**、**前端網站**。
本機開發完全不用改、不用裝 PostgreSQL(本機維持 SQLite);只有部署到 Render 時,
後端建置腳本會自動把資料庫切換成 PostgreSQL,資料存在獨立的 Postgres 服務,
**不會因為重新部署或休眠而被清空**。

---

## 一、前置:把最新程式碼推到 GitHub

Render 是從 GitHub repo 拉程式碼,所以先確定要部署的分支(例如 `main` 或 `dev`)是最新的:

```bash
git push origin dev
```

---

## 二、部署(擇一)

### 方式 A:一鍵藍圖(推薦,最省事)

1. 到 [Render](https://render.com) 註冊 / 登入(用 GitHub 登入)。
2. **New → Blueprint** → 選這個 repo → Render 會自動讀根目錄的 `render.yaml`。
3. 它會一次建立:免費 PostgreSQL + 後端 API + 前端網站。按 **Apply** 開始部署。
4. 等三個都變綠(第一次約 5~10 分鐘)。

> 若 Blueprint 出問題,改用下面「方式 B」手動建,一樣的結果。

### 方式 B:手動建立(三步)

**① 建資料庫**
New → PostgreSQL → 名稱 `scheduling-db` → Plan 選 **Free** → Create。
建好後在該資料庫頁面複製 **Internal Database URL**(給後端用)。

**② 建後端 API**
New → Web Service → 選 repo →
- Root Directory:`server`
- Runtime:`Node`
- Build Command:`npm install && npm run render:build`
- Start Command:`npm run start`
- Plan:**Free**
- Environment 環境變數:
  - `DATABASE_URL` = 剛剛複製的 Internal Database URL
  - `GEMINI_MODEL` = 你要用的型號(例如 `gemini-2.5-flash`)
  - `GEMINI_API_KEY` = **先留空**(見下方「AI 開關」)
- Create Web Service。建好後複製它的網址,例如 `https://scheduling-api.onrender.com`。

**③ 建前端網站**
New → Static Site → 選 repo →
- Root Directory:`client`
- Build Command:`npm install && npm run build`
- Publish Directory:`dist`
- Environment 環境變數:
  - `VITE_API_URL` = 後端網址(步驟②複製的那個,結尾不要加 `/`)
- 加一條 Redirect/Rewrite 規則(給 react-router):Source `/*` → Destination `/index.html` → Action `Rewrite`
- Create Static Site。

---

## 三、部署後的三個收尾動作

1. **確認前端指到正確後端**
   前端的 `VITE_API_URL` 必須等於後端實際網址。若不同,到前端服務的 Environment 改掉,再 **Manual Deploy → Clear build cache & deploy**(前端的網址是 build 時寫進去的,改了要重 build)。

2. **首次資料**
   後端 `render:build` 已經會自動灌一次示範資料(冪等:之後重部署不會再清)。
   若想重灌乾淨資料,在後端服務的 **Environment** 暫時加 `FORCE_SEED=1` → 重新部署一次 → 再把它移除。

3. **AI(Gemini)開關**
   - 平常 `GEMINI_API_KEY` **留空** → AI 顯示未啟用,其他功能全正常,不會燒你的額度。
   - 要 demo AI 時:在後端 Environment 填入 key → 等重新部署好 → demo → demo 完把 key 清掉。
   - (更省事的做法:AI 那段用本機錄進 demo 影片,線上永遠不填 key。)

---

## 四、demo 前檢查清單

- [ ] **提早 5 分鐘打開網址暖機** —— Render 免費服務閒置 15 分鐘會休眠,第一次開要等 30~50 秒喚醒。
- [ ] 打開網站確認資料在(產品/機台/訂單都有);沒有的話用上面「FORCE_SEED」重灌。
- [ ] 若要現場展示 AI,先確認 key 已填、`GEMINI_MODEL` 型號叫得動(本機先測一次)。
- [ ] 前端能正常打到後端(打開任一頁有資料出現,就代表通了)。

---

## 五、常見問題

- **前端打得到後端嗎?** 後端已開放 CORS(接受任何來源),所以只要 `VITE_API_URL` 填對就通。
- **資料會不會不見?** 不會。資料在獨立的 PostgreSQL 服務,後端重部署 / 休眠都不影響。(注意:Render **免費 PostgreSQL 有使用期限**,過期資料庫會被停用,demo 期間沒問題,長期要留意。)
- **第一次開很慢?** 正常,免費方案休眠後首次喚醒較慢,暖機一下就好。
- **本機還能跑嗎?** 完全照舊 —— 本機用 SQLite,不受這些部署設定影響。`npm run dev` / `npm test` 一切不變。
