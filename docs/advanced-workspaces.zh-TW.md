[English](advanced-workspaces.md) | **繁體中文**

# 進階工作區設定檔

預設情況下還是用一支 `LINEAR_API_KEY`。工作區設定檔是給經常在多個 Linear 工作區之間切換、希望各自保留獨立快取資料的人用的。

## 設定檔 id 與名稱

設定檔 id 來自環境變數名稱中間那一段：

```env
WORKSPACE_CLIENT_A_NAME=Client A
WORKSPACE_CLIENT_A_LINEAR_API_KEY=lin_api_xxx
```

這定義了設定檔 id `client_a`。`NAME` 只是 UI 上顯示的標籤。

預設情況下，設定檔資料儲存在：

```text
data/workspaces/<profile-id>/graph.db
```

例如：

```text
data/workspaces/client_a/graph.db
```

只在你有特定理由時才覆寫路徑：

```env
WORKSPACE_CLIENT_A_SQLITE_PATH=/app/data/client-a.db
```

## 作用中的工作區

`WORKSPACE_ACTIVE` 選擇初始作用中的設定檔：

```env
WORKSPACE_ACTIVE=client_a
```

當你從 UI 切換時，`issue-graph` 會在本地記住選擇，下次載入頁面時開的就是同一個工作區。這個 runtime 狀態存在 `data/` 底下，由 app 自行管理。

如果 app 開的工作區不是你預期的，用左上角標籤的選擇器切回去。

## Docker 與多個 repo 路徑

SQLite 資料用預設的 Compose volume 就行：

```yaml
volumes:
  - ./data:/app/data
```

設計文件掃描則不一樣：Docker 只能讀到 mount 進容器的 host 路徑。如果不同設定檔用了不同的 `WORKSPACE_<ID>_REPO_PATH`，每個 repo 路徑都要 mount。

複製範例 override：

```bash
cp docker-compose.override.example.yml docker-compose.override.yml
```

然後編輯路徑：

```yaml
services:
  app:
    volumes:
      - ./data:/app/data
      - /Users/you/workspace/proj-a:/Users/you/workspace/proj-a:ro
      - /Users/you/workspace/proj-b:/Users/you/workspace/proj-b:ro
```

如果想要同一份 `.env` 同時適用於本機開發與 Docker，左右兩邊請用同樣的絕對路徑：

```env
WORKSPACE_PROJ_A_REPO_PATH=/Users/you/workspace/proj-a
WORKSPACE_PROJ_B_REPO_PATH=/Users/you/workspace/proj-b
```

如果只跑 Docker，可以把 repo mount 在容器內專用的前綴底下，例如 `/repos/proj-a`，但這樣本機 `bun run dev` 就看不到那些路徑，除非 host 上也有這些路徑存在。

## 即時設計文件更新的疑難排解

即時設計文件更新只監看作用中設定檔的 `REPO_PATH`。

如果編輯 `tasks.md` 或 `proposal.md` 沒有更新圖：

1. 確認左上角的工作區選擇器指向你正在編輯 repo 的設定檔。
2. 確認 spec 目錄存在於 `WORKSPACE_<ID>_REPO_PATH` 底下 — OpenSpec 專案是 `openspec/`，Spectra 專案則是 `spec_dir` 解析到的位置（預設 `docs/specs/`；見 `.spectra.yaml`）。
3. 在 Docker 下，確認 repo 路徑有 mount 進容器。
4. 編輯完 `.env` 後重啟後端；UI 切換工作區本身不需要重啟。
