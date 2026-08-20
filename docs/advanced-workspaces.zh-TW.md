[English](advanced-workspaces.md) · [繁體中文](advanced-workspaces.zh-TW.md)

# 工作區（Workspaces）

工作區直接在應用程式中管理 — **設定 → Workspaces**，或全新安裝時看到的設定畫面。
已經沒有 `WORKSPACE_*` 環境變數設定；名冊存放在 `data/workspaces.db`。

## 代號（id）

每個工作區除了顯示名稱之外都有一個簡短代號。應用程式會依名稱建議一個
（`Client A` → `client-a`），你也可以自行修改。

這個代號不只是裝飾：

- 它會出現在網址的 `?w=client-a`，因此連結可以指定工作區分享
- 它是該工作區議題快取資料夾的名稱，
  `data/workspaces/client-a/graph.db`

因為代號決定資料路徑，**重新輸入用過的代號會接回原本的快取**，不需要從頭同步。
這也是為什麼這個欄位是可見且可編輯的，而不是隱藏的自動產生值。

代號只能使用小寫英文、數字與連字號，且必須以英文或數字開頭。由於代號會變成
資料夾名稱，伺服器會自行驗證，而不是信任表單。

## 什麼東西存在哪裡

```text
data/workspaces.db                   名冊：名稱、API 金鑰、webhook secret，
                                     以及哪一個是預設工作區
data/workspaces/<id>/graph.db        該工作區的議題、標籤、註記、筆記與快照快取
```

`workspaces.db` 很小、存放你的憑證，而且無法重建 — 這才是值得備份的檔案。
`graph.db` 只是快取；刪掉重新同步是修復壞掉快取的正常手段，代價只有一次同步。

憑證刻意**不**放在 `graph.db`，原因正是如此。

## 移除工作區

刪除工作區只會移除名冊中的那一筆，`data/workspaces/<id>/` 會原封不動留在磁碟上。
不會有東西在按下刪除之後被銷毀；若你確定要清掉資料，請自行刪除該資料夾。

API 金鑰與 webhook secret 會跟著名冊那筆一起消失，所以重新加入相同代號時要重新
輸入憑證 — 快取的議題會回來，機密不會。

## 更換憑證

編輯工作區的 API 金鑰會在下一次同步生效，不需要重新啟動。

## 設計文件與 `REPO_PATH`

> [!NOTE]
> **不再支援每個工作區各自的 repo 路徑。** `REPO_PATH` 是單一的伺服器層級環境
> 變數，設計文件監看器會跟著目前的預設工作區。
>
> 這是刻意的取捨。若把路徑存在每個工作區上，它就必須能從設定表單編輯，而一個
> 「把檔案掃描器指向任意絕對路徑」的表單欄位，在一個沒有身份驗證的應用程式裡
> 等同於任意檔案讀取。如果你需要多個 repo 的設計文件進度，請一個 repo 跑一個
> 執行個體。

在 `.env` 中設定：

```env
REPO_PATH=/Users/you/workspace/proj-a
```

在 Docker 下，這個路徑也必須掛載進容器，並且兩邊使用相同的絕對路徑，這樣同一份
`.env` 才能同時適用於 `bun run dev` 與 Compose：

```yaml
services:
  app:
    volumes:
      - ./data:/app/data
      - /Users/you/workspace/proj-a:/Users/you/workspace/proj-a:ro
```

不設定 `REPO_PATH` 就會完全停用設計文件掃描 — 在沒有 checkout repo 的遠端伺服器
上，這正是正確的選擇。

### 修改沒有反映出來時

1. 確認 `REPO_PATH` 底下有 spec 目錄 — OpenSpec 專案是 `openspec/`，Spectra 專案
   則是 `spec_dir` 解析出來的目錄（預設 `docs/specs/`，見 `.spectra.yaml`）。
2. 在 Docker 下，確認 repo 已掛載進容器。
3. 修改 `REPO_PATH` 後要重新啟動後端。在 UI 切換工作區不需要重啟，改 `.env` 需要。
