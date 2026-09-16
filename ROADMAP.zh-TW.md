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

## v1.3 — 已釋出

**工作區 — 多分頁 UI**
- 分頁列取代原本單一工作區的 header。每個分頁有自己的工作區 + 檢視 +
  篩選 + 對焦 + viewport，存在 sessionStorage 並能跨重新整理 / 瀏覽器
  重啟還原
- `Cmd/Ctrl + 1..9` 跳到第 N 個分頁；可拖曳重排；每個工作區可 ⭐ 設為
  預設
- `WORKSPACE_<ID>_*` 環境變數結構，並保留單一 `LINEAR_API_KEY` 設定的
  legacy 模式
- 完成先前「UI 上的多工作區 / 多 team 切換」的 Likely 項目

**Project view**
- 新的最上層檢視，依 Linear project 把議題分組；跨 project 的 `blocks`
  edge 高亮；「(No project)」永遠釘在最後
- 側邊欄新增 Project 篩選維度（可與其他篩選組合）

**Layout — 多欄 bucket**
- Mix 與 Project 的 container 會依議題數量自動分成 2–3 欄；不再有過長
  的單欄堆疊

**Design-doc / git worktrees**
- 轉接器會掃描 `REPO_PATH` 下的所有 git worktree，去重避免同一議題出
  現兩次
- OpenSpec 與 Spectra 轉接器拆成獨立模組；Spectra 採用 v2.2.5+ 的新
  預設 `spec_dir`，並支援自訂的 `spec_dir`

**PWA**
- 加入 web app manifest 與 service worker；可從 Chrome / Edge URL 列
  或 Safari → File → Add to Dock 安裝。App shell 會預先快取；Linear
  資料與 SSE 串流維持純網路取得

**穩定性**
- Viewport 還原會贏過 ReactFlow 啟動時的 `fitView` 競賽
- Docker 容器內 SQLite 路徑釘在 `/app/data/graph.db`，避免 host 路徑
  外漏
- `data-dev/` host-only 開發目錄加進 gitignore，與 `data/` 完全分離，
  避免並行 SQLite WAL 寫入互相破壞

## v1.4 — 已釋出

**Quick switcher — `Cmd+K`**
- 模糊搜尋面板可跨所有開啟分頁查找議題；每一列顯示標題、識別碼與目前
  state chip
- 最近選過的項目浮到最上面；工具列另外配置快速啟動鈕
- 選定後相機平移到該議題，並保留詳情面板原本的開關狀態

**工作區筆記**
- 以工作區為範圍的 markdown 筆記；網格 + 列表檢視、封存 + 一鍵復原、
  `n` 切換 modal、開啟筆記後 `Cmd+E`（在 PWA 中也可 `Cmd+/`）切換
  Edit / Preview
- 筆記裡提到的 issue ID 會在旁邊內嵌顯示該議題的目前狀態

**導覽歷史**
- `Cmd/Ctrl + [ / ]` 在 view / filter / focus / chain 變動之間前後跳；
  undo 時連 viewport 也會還原

**詳情面板強化**
- 直接在面板顯示 Linear 的留言串，不再需要切到 Linear 才能看討論
- 點任一 metadata 值（state、priority、assignee、project、primary
  label）就能用它篩選畫布
- 寬模式拖拉上限放寬到視窗的 75 % / 1200 px；側邊模式也採用同一組
  上限。面板內字級可在 4 階獨立切換，與全域字體設定脫鉤
- 載入議題時改為光澤骨架佔位，取代原本純文字 "Loading…"
- 寬模式開啟時自動隱藏畫布行內查找，避免重疊
- focus 與面板解耦：點節點只會高亮、不會強制開啟面板；`Space` /
  `Enter` 才會打開；`Esc` 兩段式 — 先收起面板再清除 focus
- `d` 切換「focus 時自動開啟詳情面板」的偏好

**跨平台鍵盤標籤**
- `Cmd/⌘` 在 Windows/Linux 顯示為 `Ctrl`；`Delete` 顯示為 `Backspace`。
  集中在 `src/frontend/lib/platform.ts`，可用 `?platform=windows` 或
  `localStorage.ig-platform` 在 QA 階段強制覆寫

**i18n — 英文 + 繁體中文**
- 自家寫的小型字典 + Zustand 撐起的語系 store；預設英文，zh-TW 從
  Settings → Language 啟用；存 localStorage
- 翻譯涵蓋 Toolbar、Settings、快速鍵備忘卡、Onboarding、Sync banner、
  modal header、FilterPanel、DetailPanel、NotesModal、檢視標籤
- 加上 `README.zh-TW.md` 與 `docs/`、`ROADMAP.md` 中對應的繁中版本。
  `docs/PRD.md` 刻意只保留英文

**鏈隔離 — 跨檢視一致**
- 鏈隔離的進入與離開現在在每個檢視（dependency、mix、project）都一致
  運作，切換時保留 viewport

**篩選側邊欄翻新**
- 篩選區段可摺疊，header 改為 sticky 並顯示啟用中的篩選計數；每個區段
  有自己的清除按鈕。加上語意 icon 與分隔線，掃讀速度更快

**Markdown 表格**
- 設計文件與筆記裡的表格現在會畫框線與斑馬條，結構化資料更好讀

**Settings — 顯示作用中的 label-group**
- 目前作用中的 bucket / type label group 直接顯示在 Settings 與 Mix
  tooltip 裡，隨時知道排版是依哪一組 schema

**打磨**
- Header 列：TabBar 與 SyncBanner 合併成單一列
- Settings：區段加分隔線、footer 動作改成 sticky
- Shortcuts modal：拉寬，採用響應式 2 欄排版
- Toolbar：低頻動作收進 overflow 選單；改用 `lucide` icon + 扁平按鈕
- Mix container 依 bucket 各自上強調色
- ContextMenu / 行內查找 / IssueNode 的 glyph 換成 `lucide` icon；
  modal header 統一改用共用的 `ModalHeader`

**穩定性**
- 相機置中改用最新建好的節點座標（切換檢視或 `F5` 後不會再有偏移）
- Quick switcher 啟動後現在不論詳情面板開關都能可靠 pan（用自寫 rAF
  tween 繞過壞掉的 d3-transition 路徑）
- 切換工作區時清掉殘留的 focused-note 暫存，避免筆記 modal 卡在
  「載入筆記中…」

**開發體驗**
- 採用 React-hooks v7 推薦規則組
- 透過 `rollup-plugin-visualizer` 提供可選用的 bundle 組成報表

## v1.5 — 已釋出

**Write-back — 以你自己的身分編輯議題**
- 狀態、指派對象、優先度、標籤與留言都能直接在細節面板編輯。
  `PATCH /api/issues/:id` 與 `POST /api/issues/:id/comments` 帶的是呼叫者
  **自己的** Linear OAuth token，所以「這個人有沒有權限寫」與「是誰寫的」
  兩個問題都由 Linear 回答
- 伺服器端不保存任何人的 token — 沒有 session 表、沒有名冊欄位、沒有
  `setting` 列。伺服器只確認「有」附上憑證就轉發出去，有效與否是 Linear 的答案
- 由 `LINEAR_OAUTH_CLIENT_ID` 控制。沒設就等於寫入路由一律回 401，
  升級不會平白長出一塊可變更的介面。讀取仍然使用工作區儲存的金鑰 —
  同步是共用的背景拉取，不是某個人的行為
- 標籤以 delta（新增/移除）傳遞而非整組取代：圖只是快取，整組取代會把
  上次同步後在上游新增的標籤蓋掉

**篩選面板 — 從側欄改為浮動 facet 面板**
- 固定寬度的側欄移除。改為浮在畫布左上角的小面板，一列一個已套用的篩選，
  沒用到的維度完全不佔垂直空間
- `+ 篩選` 開啟串聯選單：左邊列維度，值從 hover 的那一列旁邊飛出，附勾選框與計數
- 選單的搜尋框會模糊比對**所有維度的值**，不只是維度名稱——打 `bug` 找得到
  `Type › Bug`。依分數排序，上限 12 筆
- chip 改為對齊的列而非膠囊：維度、運算子、值、清除。結構由欄位對齊承擔，
  整個面板只保留一圈外框

**可反轉的條件**
- 任何多選篩選都能反轉（`是` ↔ `不是`），存成 `Filters.negated`，
  URL 只用一個 `neg=` 參數，新增維度自動支援
- 反轉時值的計數會隱藏——計數是 leave-one-out（「選了還剩幾張」），
  一旦選取代表排除，那個數字就在回答錯誤的問題

**儲存檢視**
- 具名的檢視 + 篩選快照，存在新的 `saved_view` 表，每個工作區各自獨立，
  連到同一台實例的所有人共用。重置快取後仍保留
- 存的是 URL query string 而非結構化 JSON，讓 `urlSync` 維持唯一編解碼器，
  檢視不可能與 URL 的表達能力脫節
- 面板顯示目前所在的檢視、偏離時標 `*`，並提供儲存變更／捨棄變更。
  視窗標題與分頁標籤也會帶上名稱

**儲存檢視 — 可重新排序，名稱隨時看得到**
- 拖曳即可重新排序清單。目前檢視的名稱在載入當下就會出現在篩選握把、
  分頁列與視窗標題上，而不是等你第一次打開面板才出現
- 檢視可以記錄「不設狀態篩選」並且真的照做

**近期動態篩選**
- `不限 / 今天 / 7 天 / 30 天`，可比對 `createdAt` 或 `updatedAt`。
  「今天」指當地午夜起算；滾動窗口與 `staleDays` 的算法一致

**近期動態不再只看 `updatedAt`**
- 可以輸入任意區間（`6h`、`1.5d`），取代原本固定的 any/today/7d/30d 清單，
  卡片上也會顯示距離跨過門檻多久了
- 「有人把關聯指向這個議題」不再算成它自己有動靜。`recencyIgnoreLinked`
  預設開啟，只有在關掉時才會把 `recentlinks` 寫進 URL —
  不再讓單一時間戳決定「到底有沒有事情發生」

**篩選面板自動收合**
- 面板可以收成一個小握把，滑過去再展開；釘選可以讓它一直開著，而且釘選
  仍是預設值。收合時握把上會顯示生效中的篩選數量，所以面板藏起來時，
  「它正在篩選」這件事不會跟著藏起來

**篩選選單分組與計數**
- 篩選維度改以 Quick / Attributes / Labels / Time 分組，不再是一條依實作
  順序排列的長清單；每一列加大，並帶上符合的卡片數量

**釘選篩選值**
- 釘選的值排到該維度清單最上面。存 localStorage 並依工作區分 key——
  釘選存的是原始 label / project id，在別的工作區沒有意義

**Linear push 式更新**
- `POST /api/webhooks/linear` 接收 Linear 的 HMAC 簽章推播，把一串連續事件
  收斂成一次同步，再透過既有的 SSE channel 廣播 `issues-changed`，
  議題編輯不必等快取 TTL 就會出現
- 只要對外公開那一條路徑（例如 path-scoped 的 Tailscale funnel）；
  它是唯一設計成可以從外部連到的路由

**工作區設定移出 `.env`**
- 名冊（名稱、API 金鑰、webhook secret）改存在 `data/workspaces.db`，並透過
  設定畫面與設定頁管理，遠端部署不再需要 shell 權限才能新增 Linear 工作區。
  取代 v1.3 的 `WORKSPACE_<ID>_*` 環境變數結構與單一金鑰的相容模式
- **破壞性變更：** 不再支援每個工作區各自的 `REPO_PATH`，改為單一伺服器層級
  設定。既有部署啟動時名冊是空的，需要重新輸入工作區 — 使用相同代號即可
  接回原本的快取資料

**修復**
- 四個篩選維度（專案、里程碑、狀態名稱、搜尋）從未寫進 URL：分享連結會掉，
  上一步會靜默清空。新的純 `filterCodec` 統一掌管三處註冊，
  並有涵蓋每個維度的往返測試
- 具體 Linear 狀態原本會一次蓋掉所有大類，讓狀態樹表現得像互斥選項。
  現在名稱只在自己的大類內細分
- 點畫布無法關閉 app 內任何下拉選單——React Flow 的 d3-drag 會停止事件傳播，
  冒泡階段的監聽器永遠不會觸發
- 預設就生效的約束（只看進行中、六個大類只顯示四個）現在會顯示成可清除的列，
  不再是一個暗示「沒有任何篩選」的空面板
- Raycast 深層連結會把畫面上既有的篩選清掉；連結帶的參數現在是合併而非取代
- 關掉 app 再打開後，分頁沒有回到你離開時的位置
- Quick switcher 每個符合的「狀態群組」列一行，而不是每個議題一行，
  而且沒辦法用編號找到議題
- 在 quick switcher 搜尋時，可能拿到別的分頁的結果
- 設定頁最後兩個區塊跑出了它們該待的頁面
- 「傳入的關聯不算動靜」這個結論下得太強：`passesRecency` 直接回傳 false，
  等於斷言「這裡什麼都沒發生」，但實際成立的只是「`updatedAt` 不能再作證」。
  在實際工作區上量測，它藏掉了最近 7 天建立的 17 個議題中的 8 個。
  現在只被關聯撞到的情況會退回去看 `createdAt` 與新增的 `lastCommentAt`

**移除**
- `Filters.activeOnly` —— 對「狀態」這個維度的第二個篩選器，而 `stateTypes`
  已經擁有它。在預設值時它什麼也沒做；唯一能讓它生效的方式就是跟狀態清單牴觸，
  然後它會贏 —— 勾了 Completed，圖卻是空的。一個維度，一個篩選器。
  `savedViewMatch` 仍然忽略它的 `active=` 參數，讓移除前存下的檢視繼續比對得上
- `Filters.tagIds`：從初版就有儲存與序列化，但 `applyFilters` 從未讀取它。
  它原本要做的事早已由 `orphanValues` 實作

## v1.6 — 接下來

- [ ] 非 localhost 部署的選用驗證（basic-auth 或 token gate）
- [ ] 把剩下的 v7 hook-rule 違規（`set-state-in-effect`、`purity`）遷移完，目前是逐個呼叫點壓抑警告
- [ ] 把 `/api/export` 的 JSON 結構文件化，讓使用者能在上面建自己的工具

## v1.7+ — 大概會做

- [ ] **GitHub Issues 後端** — 跟 Linear 同樣的 `Source` 介面；對 OSS 團隊價值高
- [ ] **Mix view 排版改進** — bucket-as-container 的排版超過約 15 個節點就太擠：
  - 可摺疊的 bucket（點 header 摺成 `▶ docs (3)` chip）
  - 每個 bucket 自動密度（大 bucket 自動切換到精簡卡片；小 bucket 維持完整細節）
  - 縮放感知的 bucket 摘要（縮小時把卡片換成狀態計數 chip 例如 `backend ◯3 ⏳2 ✓1`）
  - 拖曳重新排序 bucket
- [ ] Timeline view — 把每日 snapshot 資料展現出來（已經有持久化；只缺 UI）

## 也許 — 不承諾

- [ ] **Jira 後端** — 環境變數結構在 `docs/PRD.md` §10 已草擬
- [ ] Plane / GitLab issue 後端
- [ ] 主題化的圖匯出（嵌字型的 SVG）

## 不會做

- 取代 Linear/Jira/GitHub UI — 這是個 *visualizer*，不是 tracker
- 多租戶 SaaS hosting — 設計上就是 self-hosted
- Mobile app — desktop-first；mobile web view 應該還是能用，但不會有原生 app

---

如果你想做 **v1.6** 或 **v1.7+** 的東西，請先開 issue 對齊範圍。
**Maybe** 項目請在開工前先開 issue 看看意願。
