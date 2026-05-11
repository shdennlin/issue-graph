[English](ROADMAP.md) | **繁體中文**

# Roadmap

只是方向，不是承諾。下面任何項目都歡迎發 issue 與 PR。

## v1.0 — 已釋出

- Linear 後端（唯讀同步、可設定的 team / scope）
- 檢視：dependency、mix、design-doc
- [Spectra](https://spectra.5xcamp.us/) / [OpenSpec](https://openspec.dev/) 轉接器（frontmatter、資料夾名稱、regex 行三種策略）
- SQLite 持久化、每日 snapshot 加保留期限
- 註解、設定頁、PNG 匯出
- 自動偵測標籤 schema，可選的 `label-schema.yaml` 覆寫
- 單一 binary Docker 映像

## v1.1 — 已釋出

- 統一 `REPO_PATH` 環境變數（取代 `REPO_HOST_PATH` / 容器內 `/repo` 的拆分 — `bun run dev` 與 `docker compose up` 行為一致）；`REPO_PATH` 非絕對路徑時啟動會警告
- `POST /api/reset-cache` endpoint 清掉 issue + label 快取與綁工作區的 meta（保留註解、snapshots、同步歷史）
- Settings → 「Reset cache & re-sync」按鈕 — 把 `LINEAR_API_KEY` 換到不同工作區後一鍵恢復
- 同步時若快取數量 >> 同步數量會警告（用啟發式判斷「你大概換了工作區」）
- `demo-repo/` — 跟著 repo 出貨的範例 `openspec/` 目錄，展示三種連結策略
- README 主視覺 + 設計文件截圖、GitHub `[!WARNING]` / `[!TIP]` alert 語法
- 文件對齊：拿掉 1.0 之前的 phase 用語與過時的檢視名稱（Bucket / Timeline）

## v1.2 — 已釋出

**鏈隔離（Chain isolation）**
- 右鍵 → 「Isolate chain」 / 「Isolate chain (auto-layout)」 — 把 dependency view 篩成沿著 `blocks` edge 的連通分量（雙向、遞移）；auto-layout 變體會重跑 dagre 並重新對焦相機
- 鍵盤：`c` / `Shift+C` 啟動隔離；工具列 chip 顯示節點數與清除（×）；URL 同步為 `?chain=<id>`
- 鏈根的視覺強調（★ 徽章 + 強調環）
- 鏈會略過其他篩選器，避免 off-state 的 blocker 切碎鏈
- 鏈牽涉到目前快取窗口外的議題時會出現「Load full history」提示（點擊後把範圍延伸到 365 天）
- Related toggle 開啟時，會展開一跳的 `related` 鄰居
- 清除鏈隔離時自動重新排版（離開時不會重疊）

**Related edges**
- 工具列 toggle 把 `related` 關係疊加為虛線灰邊（預設關閉；URL 同步為 `?related=1`）
- 雙向去重，每對只畫一條
- `r` 鍵切換

**視覺掃描**
- Hover 高亮：hover 任何卡片或 edge → 它的鄰居維持不透明，其他降到約 15%
- 對焦自動暗化：點擊卡片時自動把非鄰居暗化
- 每張卡片的 connectivity 徽章：右下角 `⇨3 ⇦2 ╍1` 顯示全域 blocks-out / blocked-by / related 計數
- 更大的箭頭（22 → 36），預設縮放下也能看清方向

**Layout 基礎**
- 統一的 fitView pipeline，由 `measuredHeights` 收斂後驅動（取代三個 `setTimeout` 的 hack；不再有靠時序猜的相機 frame）
- 手動重排：`<Controls>` 中的 ⤴ 按鈕與 `Shift+R` 鍵盤；如果有對焦議題會以它為中心（不會迷失位置）

**鍵盤 / 易發現性**
- `?` 與工具列 ⌨ 按鈕開啟鍵盤快速鍵備忘卡（modal 列出所有快速鍵，依類別分組）
- `Cmd+Shift+F` 聚焦工具列篩選搜尋（並全選）
- 畫布內查找（`Cmd+F`）：Enter 提交 + 設定對焦議題 + blur，讓畫布快速鍵（`c`、`Shift+R` 等）作用在命中項；關閉時保留查詢；重新開啟時全選
- Esc 逐層撥開順序：Find → 右鍵選單 → 對焦議題（關閉 DetailPanel） → 鏈隔離

**工作區身份**
- Settings → Backend 顯示目前的 Linear 工作區為可點擊的 Linear 連結（解決早先的「Detect workspace change」v1.2 項目）
- 同步偵測到 `viewer.organization.urlKey` 與上次不同時跳紅色橫幅，可一鍵「Open Settings」 / 「Dismiss」
- `INSTANCE_LABEL` 改名為「Display label」（原本叫「Instance」名稱誤導），加上 tooltip 說明只是顯示用
- Reset cache & re-sync 流程：阻擋式 overlay 顯示階段進度 + 自動重載頁面（不再有「成功了嗎？」的疑問）
- 「Loading…」與「⏳ Syncing…」的 SyncBanner 標籤區分快取讀取與真實 Linear 同步

**即時更新**（部分實現先前「WebSocket live updates」的 Maybe 項目 — 改用 SSE 實作）
- `REPO_PATH/openspec/` 上的檔案監聽器（debounce 500ms） — 在 IDE 改 `tasks.md` 的 checkbox，約 ½ 秒內進度條就會更新，不需手動重新整理
- 新增 `GET /api/events` SSE endpoint，搭配 in-process pub/sub
- 前端 `EventSource` 訂閱者 + `refetchSilent` graphStore action
- 可見分頁上每 30 秒背景輪詢，會撈到後端 TTL 觸發的同步，不需手動重新整理

**設定**
- Cache TTL 可從 Settings → Backend 編輯（原本只能改 `.env` + 重啟）；範圍 10 秒–24 小時

**開發體驗**
- `dev:server` 新增 `SERVE_STATIC=false` 環境旗標，避免過時的 `dist/` 蓋掉正在跑的 Vite dev server
- Vite ↔ 後端 port 衝突：自動位移 `VITE_PORT` 並大聲警告，不再靜默失敗
- Dev 環境下後端根目錄 `/` 302 重導到 Vite — 使用者只需要記住一個 URL

**Lint / 衛生**
- 5 個既存 react-hooks / 未使用 disable 的警告全部清除（解決「Resolve the 4 known `react-hooks/exhaustive-deps` warnings」v1.2 項目）

## v1.3 — 接下來

- [ ] 非 localhost 部署的選用驗證（basic-auth 或 token gate）
- [ ] 把剩下的 v7 hook-rule 違規（`set-state-in-effect`、`purity`）遷移完
- [ ] 把 `/api/export` 的 JSON 結構文件化，讓使用者能在上面建自己的工具

## v1.4+ — 大概會做

- [ ] **GitHub Issues 後端** — 跟 Linear 同樣的 `Source` 介面；對 OSS 團隊價值高
- [ ] UI 上的多工作區 / 多 team 切換（目前綁在 env）
- [ ] Saved views（具名的篩選組合，不只是 URL params）
- [ ] **Mix view 排版改進** — bucket-as-container 的排版超過約 15 個節點就太擠：
  - 可摺疊的 bucket（點 header 摺成 `▶ docs (3)` chip）
  - 每個 bucket 自動密度（大 bucket 自動切換到精簡卡片；小 bucket 維持完整細節）
  - 縮放感知的 bucket 摘要（縮小時把卡片換成狀態計數 chip 例如 `backend ◯3 ⏳2 ✓1`）
  - 拖曳重新排序 bucket
- [ ] Timeline view — 把每日 snapshot 資料展現出來（已經有持久化；只缺 UI）
- [ ] Linear push 式更新 — 擴充 SSE channel 廣播 Linear webhooks，這樣議題變化（不只是設計文件編輯）也能不靠輪詢就出現

## 也許 — 不承諾

- [ ] **Jira 後端** — 環境變數結構在 `docs/PRD.md` §10 已草擬
- [ ] Plane / GitLab issue 後端
- [ ] 讀寫模式（從圖本身做狀態轉換）
- [ ] 主題化的圖匯出（嵌字型的 SVG）

## 不會做

- 取代 Linear/Jira/GitHub UI — 這是個 *visualizer*，不是 tracker
- 多租戶 SaaS hosting — 設計上就是 self-hosted
- Mobile app — desktop-first；mobile web view 應該還是能用，但不會有原生 app

---

如果你想做 **v1.2** 或 **v1.3+** 的東西，請先開 issue 對齊範圍。
**Maybe** 項目請在開工前先開 issue 看看意願。
