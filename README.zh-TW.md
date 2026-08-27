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

## 篩選

篩選器是一個浮在圖表左上角的小面板，**只列出你實際套用的條件**——沒用到的維度完全不佔空間。

- **`+ 篩選`** 開啟串聯選單：左邊是維度，該維度的值從旁邊飛出，附勾選框與即時計數。
  搜尋框會**同時搜尋所有維度的「值」**，所以打 `bug` 就能找到 `Type › Bug`，不需要先記得它歸在哪個維度底下。
- **`是` / `不是`** — 點任何多選列的運算子即可反轉。反轉時值旁邊的數字會隱藏：
  那個數字的意思是「選了之後還剩幾張」，而一旦選取代表排除，它就不是在回答你的問題了。
- **近期動態** 篩的是「什麼時候變的」而不是「它是什麼」——今天 / 7 天 / 30 天，
  可選擇比對建立時間或更新時間。
- **釘選**（選項上的圖釘）會把常用的值排到該維度清單最上面。釘選是每個瀏覽器、每個工作區各自獨立的。

有兩個篩選**預設就開著**，它們會以一般的列呈現、可以像其他條件一樣清除：已完成與已取消的 issue 被隱藏，六個狀態大類只顯示四個。

### 儲存檢視

把目前的檢視 + 篩選組合命名存起來，之後一鍵回到它。儲存的檢視放在**伺服器上**，
所以連到同一台實例的每個人看到的是同一份清單——要把「我每天早上看的那個版面」交給同事，就是用這個。

面板會顯示你目前所在的檢視名稱，一旦你改動篩選就標上 `*`，並同時提供**儲存變更**與**捨棄變更**。
視窗標題和分頁標籤也會帶上檢視名稱，開多個視窗時特別有用。

> 儲存的檢視存在該工作區的 `graph.db`，重置快取後仍會保留。本工具**沒有身分驗證**（見下方警告），
> 所以任何連得到這台伺服器的人都能修改或刪除任何檢視。

## 五分鐘快速啟動

```bash
git clone https://github.com/shdennlin/issue-graph
cd issue-graph
mkdir -p data
docker compose up -d --build
open http://localhost:31415
```

開啟後會看到設定畫面。輸入工作區名稱、貼上 Linear 個人 API 金鑰
（Linear → Settings → API → Create Personal API Key）後儲存即可。金鑰在存進去之前
會先跟 Linear 驗證，所以打錯會當場告訴你，而不是之後變成一張空白的圖。接著後端會從
Linear 拉取進行中與最近的議題、掃描 `REPO_PATH` 下的設計文件（選用），然後渲染
相依圖。

不需要 `.env` — `docker compose` 沒有這個檔案也跑得起來。API 金鑰儲存在伺服器端的
`data/workspaces.db`，永遠不會回傳到瀏覽器 — API 只會回報「是否已設定」。

> [!WARNING]
> **這個應用程式沒有內建身份驗證。** 任何能連到該 port 的人都能讀取所有工作區的議題
> 資料，並呼叫寫入端點（`POST /api/sync`、`POST/DELETE /api/annotations`、
> `PATCH /api/settings`，以及會接收 API 金鑰的工作區路由）。
>
> 因此 Docker compose 只綁在 `127.0.0.1`。需要遠端存取時，請在前面加一層有驗證的入口，
> 而不是把綁定範圍放寬 — 在 Tailscale 主機上，`tailscale serve --bg 31415` 能連到
> loopback 綁定並提供 HTTPS，而 PWA 本來就需要它（service worker 需要 secure context，
> 直接用 `http://<tailnet-ip>:31415` 會靜默失去離線支援）。Cloudflare Access 或加了
> 驗證的 nginx 也同樣可行。
>
> 唯一的例外是 `POST /api/webhooks/linear`，它本來就設計成要公開，並且有 HMAC 驗證。
> 只暴露那一條路徑 — 例如 `tailscale funnel --bg --set-path=/linear-hook
> http://localhost:31415/api/webhooks/linear` — 絕對不要整個 port。

### 設定

`.env` 沒有任何必填項目。工作區直接在應用程式內管理；`.env` 只承載伺服器在
「能打開資料庫之前」就需要知道的少數設定 — 資料放哪、綁哪個 port、log 等級 —
而且全部都有預設值。詳見 [`.env.example`](.env.example)。

有一項刻意不開放設定：Linear API endpoint。能改這個值的人就能把應用程式指向
自己的主機，並在下一次同步時收到你的 API 金鑰（在 `Authorization` 標頭裡），
因此它固定寫在原始碼中。

### 即時更新（選用）

預設情況下快取依 TTL 更新，所以在 Linear 改了議題要等下一次同步才看得到。設定
webhook 之後幾秒內就會出現。

1. **設定共用密鑰。** 設定 → Webhook，填一組夠長的隨機字串後儲存。這一步必須在
   新增工作區之後 —— 密鑰是存在工作區那一列上的，不是全域設定。
2. **只公開 webhook 這一條路徑。** 它是唯一設計成可以從外部連到的路由，其他全部
   都必須留在 loopback 後面。在 Tailscale 主機上：

   ```bash
   tailscale funnel --bg --set-path=/linear-hook \
     http://localhost:31415/api/webhooks/linear
   ```

3. **在 Linear 註冊。** Settings → API → Webhooks → 新增，URL 填
   `https://<你的主機>.ts.net/linear-hook?w=<工作區代號>`，密鑰貼上同一組。`?w=`
   決定這次推播要送到哪個工作區，所以一個 funnel 掛載就能服務全部工作區。

推播會做 HMAC 驗證、時間戳過期就拒絕、有流量上限，而且一連串事件會收斂成一次同步。
設定 → Webhook 會顯示接受／拒絕的次數 —— 更新突然不來的時候值得看一眼，因為 webhook
默默停掉的樣子跟「圖沒更新」長得一模一樣。

另外，密鑰跟著工作區那一列走，所以移除再重新加入工作區之後要重設一次。

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

## 部署到伺服器

上面那段就是完整的安裝流程 —— 伺服器也是同樣三個指令。差別在於連線方式、時區，
以及**不該帶過去的東西**。

```bash
git clone https://github.com/shdennlin/issue-graph
cd issue-graph && mkdir -p data
docker compose up -d --build
```

**不要把筆電上的 `.env` 複製過去。** 全新伺服器根本不需要它，而裡面過期的
`REPO_PATH` 會讓 Compose 在主機上建出一個空目錄 —— 設計文件掃描器接著就會對著
空的掃。除非有明確理由，直接不要放 `.env`。

**設定時區。** `docker-compose.yml` 釘的是 `TZ: Asia/Taipei`，請改成你的。容器
預設 UTC，而每日快照是照本地時間觸發，時區設錯就只是快照在奇怪的時間跑。

**決定怎麼連進去。** 這個應用程式沒有身份驗證，所以 Compose 只綁 `127.0.0.1`，
前面必須有一層帶驗證的入口。在 Tailscale 主機上就一行：

```bash
tailscale serve --bg 31415
```

它連得到 loopback 綁定，同時提供 HTTPS —— 而你本來就需要 HTTPS：這個 PWA 會註冊
service worker，而 service worker 需要 secure context，直接用
`http://<tailnet-ip>:31415` 會靜默失去離線支援。Cloudflare Access 或加了驗證的
nginx 也一樣可行。**不要**為了省事把綁定放寬成 `0.0.0.0` —— 那等於把所有工作區的
議題資料、以及會接收 API 金鑰的那些路由，公開給任何連得到這台主機的人。

**設計文件功能會是關閉的**，因為 repo 沒有 checkout 在那台機器上。對伺服器來說這
正是預期狀態；需要的話請見[工作區](docs/advanced-workspaces.zh-TW.md)。

接著開啟網址，用設定表單加入工作區，跟本機完全一樣。**沒有任何設定需要透過 SSH。**

### 更新

```bash
git pull && docker compose up -d --build
```

`data/` 是 bind mount，會保留下來。schema migration 會在啟動時自動執行。名冊、
金鑰、快取的議題更新後都還在。

### 搬移執行個體

複製 `data/workspaces.db` —— 名冊和憑證都在裡面。`data/workspaces/<id>/` 是快取，
想保留快照歷史就一起帶，不然留著讓第一次同步從 Linear 重新填也可以。

## 客製化

`issue-graph` 會自動偵測常見的 Linear 標籤群組名稱（分組用：
`service|component|owner|module|team|area|domain`，圖示用：`type|kind|category`）。
若使用不同命名規則或想透過 `label-schema.yaml` 完整控制，請見
**[Customizing labels and icons](docs/configuration.zh-TW.md)**。

## 備份策略

這裡幾乎沒有東西需要備份。`issue-graph` 是 Linear 的一個 view：刪掉快取，下一次
同步就會重建。

唯一的例外是 **`data/workspaces.db`** —— 幾 KB，存放工作區名冊、API 金鑰與 webhook
secret。它無法重建，不過「重建」也不過就是把每個工作區重新輸入一次。
`data/workspaces/<id>/` 底下全部都是快取；只有快照歷史和註解救不回來，而這兩者本來
就不被當成需要長期保存的資料。

本專案沒有備份腳本。真要備份的話 `rsync` 整個 `data/` 目錄即可 —— 但要注意那會一併
複製你的 API 金鑰，目的地請比照辦理。

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
http://localhost:31415/?w=team_a&view=project&proj=p1&priority=1,2&recent=7d&neg=priority&q=auth&focus=PROJ-123
```

把連結貼到聊天室 — 隊友看到的就是同一個檢視。`view=` 的合法值有
`dependency`、`mix`、`project`、`milestone`、`designdoc`。`w=` 參數依 id 選擇工作區設定檔，
`neg=` 列出哪些維度的選取被反轉，`q=` 帶的是搜尋框的內容。

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
bun run test:smoke  # control plane 檢查；需要 Bun（vitest 載不了 bun:sqlite）
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
