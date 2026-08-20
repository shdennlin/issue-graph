[English](README.md) | **繁體中文**

# issue-graph

自架的唯讀議題相依關係圖檢視器。從 Linear 拉取資料，繪製議題、分組與 `blocks` 關係的互動式圖表。選擇性地搭配本地設計文件進度。

![Issue Graph — 相依檢視，詳情面板顯示所選議題的設計文件進度、blocks/blocked-by 與註解](docs/screenshots/dependency.png)

## 它能呈現什麼

- **相依檢視（Dependency view）** — 議題之間的 `blocks` 連線。預設首頁。回答「我接下來該做什麼？」。
- **混合檢視（Mix view）** — 依可設定的 Linear 標籤群組（`service`、`module`、`team`、`area` — 自動偵測）將議題分到容器中；跨容器的 `blocks` 連線以紅色強調。
- **專案檢視（Project view）** — 依 Linear 專案分組。每個專案是一個容器；跨專案的 `blocks` 連線會被強調。
- **設計文件檢視（Design-doc view）** — 只顯示有連結到設計文件變更的議題。
- **子議題階層** — Linear 的上層／子議題關係。在相依檢視中以紫色連線呈現（按 `h` 切換，預設關閉），每張父卡片上會顯示 `3/7` 的完成進度標記；詳情面板會列出上層議題與各個子議題。

## 五分鐘快速啟動

```bash
git clone https://github.com/<owner>/issue-graph
cd issue-graph
mkdir -p data
docker compose up -d --build
open http://localhost:31415
```

開啟後會看到設定畫面。輸入工作區名稱、貼上 Linear 個人 API 金鑰
（Linear → Settings → API → Create Personal API Key）後儲存即可。接著後端會從
Linear 拉取進行中與最近的議題、掃描 `REPO_PATH` 下的設計文件（選用），然後渲染
相依圖。

不需要 `.env`。API 金鑰儲存在伺服器端的 `data/workspaces.db`，永遠不會回傳到
瀏覽器 — API 只會回報「是否已設定」。

> [!WARNING]
> **請勿在沒有驗證的情況下將此 port 暴露到 LAN 或網際網路。**
> `issue-graph` **沒有內建身份驗證**。寫入端點（`POST /api/sync`、
> `POST/DELETE /api/annotations`、`POST /api/settings`）對任何能連到該 port
> 的人都是開放的。預設的 Docker compose 將 `31415` 綁在所有介面 — 自用
> `localhost` 沒問題；如果需要遠端存取，請放在反向代理之後並加上身份驗證
> （Tailscale、Cloudflare Access、basic-auth nginx 等）。

### 設定

`.env` 沒有任何必填項目。工作區直接在應用程式內管理；`.env` 只承載伺服器在
「能打開資料庫之前」就需要知道的少數設定 — 資料放哪、綁哪個 port、log 等級 —
而且全部都有預設值。詳見 [`.env.example`](.env.example)。

有一項刻意不開放設定：Linear API endpoint。能改這個值的人就能把應用程式指向
自己的主機，並在下一次同步時收到你的 API 金鑰（在 `Authorization` 標頭裡），
因此它固定寫在原始碼中。

### 多個 Linear 工作區

在 **設定 → Workspaces** 中想加幾個就加幾個。每個工作區除了名稱之外還需要一個
簡短代號（像 `client-a` 這樣的 slug）；這個代號會出現在網址的 `?w=client-a`，
同時也是它快取資料夾的名稱 — 所以重新輸入用過的代號會接回原本的快取，而不必
從頭重新同步。

建立工作區後，左上角會變成 **分頁列**。每個分頁都有自己的工作區、篩選、檢視
與視窗位置，因此你可以同時開兩個工作區（或同一工作區的兩個檢視）並在中間切換而
不失去脈絡。拖曳分頁可重新排序，`Cmd/Ctrl + 1..9` 跳到第 N 個分頁。切換分頁
（或工作區）不需要重新啟動後端，更換 API 金鑰同樣不需要。

每個工作區擁有獨立的本地資料：

```text
data/workspaces.db              <- 名冊：名稱、API 金鑰、webhook secret
data/workspaces/personal/graph.db   <- 議題快取；刪掉重新同步即可
data/workspaces/client-a/graph.db
```

其中只有第一個值得備份：它很小、存放你的憑證，而且無法重建。`graph.db` 只是快取。

移除工作區只會刪掉名冊中的那一筆，資料夾會原封不動保留 — 不會有東西在按下刪除
之後被銷毀。

`重設目前工作區資料` 只會清除目前作用中的設定檔快取。其他工作區資料庫不會被動到。

關於設定檔命名、Docker mount，以及多個 repo 的設計文件掃描，請見
[Advanced workspace profiles](docs/advanced-workspaces.zh-TW.md)。

### 設計文件整合（選用）

如果你的團隊以 markdown 檔形式撰寫設計文件 / RFC / 變更提案，並放在程式碼旁邊，
`issue-graph` 可以掃描它們，顯示 **每個議題的進度條**，並提供「只看有設計文件」的檢視篩選。

> [!IMPORTANT]
> 目前只支援 [Spectra](https://spectra.5xcamp.us/) / [OpenSpec](https://openspec.dev/)
> 的目錄佈局，提案檔案位於 `<REPO_PATH>/<spec_dir>/changes/<name>/proposal.md` 與 `tasks.md`。
> `<spec_dir>` 在 OpenSpec 是 `openspec/`；Spectra 則來自 `.spectra.yaml` 中的
> `spec_dir`（預設為 `docs/specs/`，過渡期會 fallback 到 `openspec/`）。其他格式
> （ADR、自訂佈局）不會自動偵測。

請見 **[Design-doc integration](docs/design-doc-integration.zh-TW.md)** 了解完整設定、
三種連結策略（frontmatter / 資料夾名稱 / `Linear: PROJ-123` 行），以及 Coverage 報表流程。

![設計文件檢視 — 只顯示有連結提案的議題，每個都有從 proposal 的 tasks.md 推算的進度條](docs/screenshots/designdoc.png)

### 安裝為桌面應用程式（選用）

`issue-graph` 隨附 web app manifest 與 service worker，啟動後可以裝成獨立視窗：

- **Chrome / Edge：** 點擊網址列的 **install** 圖示（或 `⋮` → *Install Issue Graph*）。
- **Safari (macOS)：** *File* → *Add to Dock*。

Service worker 只會預先快取 app shell（HTML / CSS / JS / icons）。Linear 資料與 SSE 事件
串流都只走網路，所以工作區資料永遠不會被舊快取覆蓋。解除安裝會反向清除兩者 — 不會
在磁碟上留下殘餘。

## 客製化

`issue-graph` 會自動偵測常見的 Linear 標籤群組名稱（分組用：
`service|component|owner|module|team|area|domain`，圖示用：`type|kind|category`）。
若使用不同命名規則或想透過 `label-schema.yaml` 完整控制，請見
**[Customizing labels and icons](docs/configuration.zh-TW.md)**。

## 備份策略

- **每日 SQLite 備份**：`scripts/backup.sh` 透過 cron 執行，本地保留 30 天於 `data/backups/`。
- **若 SQLite volume 遺失**：下一次同步會從 Linear 重新填入議題資料。快照歷史（最多 1 年）
  與使用者新增的註解會遺失。
- **異地備份**：本工具刻意不內建任何雲端儲存的憑證處理。需要異地備份的維運者請自行
  加上 rsync/rclone 工作，指向 `data/backups/`。

## 架構

- **單一 Docker 映像**，同時跑後端（Hono + Bun 內建的 SQLite）與前端（React + React Flow + dagre）。
- **可插拔的後端轉接器**（`src/backend/sources/`） — v1 為 Linear；未來可能有 Jira / Plane / GitHub Projects。
- **可插拔的設計文件轉接器**（`src/backend/designdoc/`） — v1 為 [Spectra](https://spectra.5xcamp.us/) / [OpenSpec](https://openspec.dev/)。

完整設計理念請見 [`docs/PRD.md`](docs/PRD.md)（英文）。

## 後端

- **v1**：[Linear](https://linear.app)（透過個人 API 金鑰，唯讀）
- **未來**（架構已準備好）：Jira、Plane、GitHub Projects

## URL 深層連結

當前作用的工作區、檢視、所有篩選、聚焦的節點與主題都會編碼進 URL：

```
http://localhost:31415/?w=team_a&view=project&bucket=svc1,svc2&priority=1,2&focus=PROJ-123&theme=dark
```

把連結貼到聊天室 — 隊友看到的就是同一個檢視。`view=` 的合法值有
`dependency`、`mix`、`project`、`designdoc`。`w=` 參數依 id 選擇工作區設定檔。

## 鍵盤

在應用程式中按 `?` 看完整快速鍵清單。重點：

- `Cmd/Ctrl + F` — 在畫布上搜尋；`Enter` 跳到下一個結果並把鍵盤焦點還給畫布
- `Cmd/Ctrl + Shift + F` — 聚焦工具列篩選搜尋框
- `Cmd/Ctrl + 1..9` — 切換到分頁列中的第 N 個分頁（每個分頁有自己的篩選 / 檢視 / 視窗位置）
- `c` / `Shift + C` — 對聚焦議題啟用鏈隔離（保留位置 / 自動排版）
- `r` — 切換「相關」連線顯示
- `h` — 切換子議題階層連線顯示（紫色連線；同時會把 1 層的上層／子議題帶進鏈隔離）
- `Shift + R` — 重新排版（重跑 dagre，置中於聚焦議題）
- `Esc` — 逐層關閉：搜尋 → 右鍵選單 → 聚焦議題 → 鏈隔離
- `Cmd/Ctrl + click` 節點 — 多選
- `Cmd/Ctrl + Shift + S` — 將目前畫布存成 PNG 截圖
- 在節點上按右鍵 — 開啟右鍵選單
- 在節點上雙擊 — 在 Linear 中開啟

> [!NOTE]
> **以桌面為先。** Hover 高亮與上述鍵盤快速鍵都假設你有實體鍵盤與指標裝置。在觸控
> 裝置上基本功能仍可用（點擊聚焦／釘選、捏合縮放、拖曳平移、工具列／詳情面板），
> 但快速 hover 掃視的流程無法轉移。

## Raycast 擴充套件

[`integrations/raycast/`](integrations/raycast/) 內附一個 [Raycast](https://raycast.com) 擴充套件 — **跨所有工作區**模糊搜尋已快取的議題，不用先開應用程式就能直接跳到某個議題。

- **Search Issues** — 輸入即可依 id、標題、負責人或工作區名稱篩選。結果會依狀態分組（Triage → In Progress → Todo → Backlog → Completed → Canceled），最常開的議題會浮到上面（frecency）。
- **行內詳情**（`⌘D`）— 狀態、優先級、負責人、截止日（逾期標紅）、標籤、專案、里程碑、相依關係、子議題、留言數 — 全部讀自本地快取，不發額外請求。
- **直接開進 PWA** — 透過 `web+issuegraph://` URL scheme,作業系統會把它導進已安裝的 PWA,並聚焦該議題、開啟詳情面板（就是 Linear `linear://` 的 PWA 版）。沒裝 PWA 時用瀏覽器 fallback（`⌥↵`）也能用。

安裝（需要 Raycast 應用程式）：

```bash
cd integrations/raycast
bun install
bun run dev        # = ray develop — 把指令匯入 Raycast
```

`ray develop` 跑一次就完成匯入；即使之後停掉 dev 程序,擴充套件仍會留在 Raycast 裡可用。若你的主機不是 `http://localhost:31415`,請把 **Issue Graph URL** 指向你的主機。完整的動作清單、`web+issuegraph://` scheme,以及如何讓連結落在 PWA 視窗,請見 [`integrations/raycast/README.md`](integrations/raycast/README.md)。

## 開發

```bash
bun install
bun run dev        # 後端 + 前端同時啟動（Vite 將 /api 代理到 :31415）
bun run typecheck
bun run lint
bun run test
bun run build      # 正式版建置 → dist/ + build/
```

## 疑難排解

常見問題（例如更換 `LINEAR_API_KEY` 後快取陳舊、空白頁重設等）請見
**[Troubleshooting](docs/troubleshooting.zh-TW.md)**。

## Roadmap

請見 [ROADMAP.md](ROADMAP.zh-TW.md) 了解規劃中、可能會做、以及明確不在範圍內的項目。
原始的工程 PRD 為了歷史脈絡保留在 [`docs/PRD.md`](docs/PRD.md)（英文）。

## 授權

[MIT](LICENSE)
