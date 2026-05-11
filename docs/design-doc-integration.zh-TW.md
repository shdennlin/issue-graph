[English](design-doc-integration.md) | **繁體中文**

# 設計文件整合

如果你的團隊把設計文件 / RFC / 變更提案以 markdown 檔的形式跟程式碼放在一起 — 在 **Spec-Driven Development（SDD）** 工作流程中很常見 — `issue-graph` 可以讀取它們，並在圖上顯示**每個議題的進度條**（例如 `4/9 tasks done`）。

> [!IMPORTANT]
> **目前支援的範圍：**
> - **佈局：** 只支援 [Spectra](https://spectra.5xcamp.us/) / [OpenSpec](https://openspec.dev/)。其他格式（ADR、自訂佈局、Notion exports……）不會自動偵測。
> - **轉接器查找的位置：** `<REPO_PATH>/<spec_dir>/changes/<name>/` — `REPO_PATH` 是 **repo 根目錄**，*不是* spec 資料夾。`<spec_dir>` 依工具決定：
>   - **OpenSpec：** 永遠是 `openspec/`（OpenSpec 自己寫死的）。
>   - **Spectra：** 讀取 `.spectra.yaml` 的 `spec_dir`，fallback 到 `docs/specs/`（v2.2.5+ 預設值），再 fallback 到 `openspec/`（舊版 / 過渡期）。
> - **每個 change 必要的檔案：** `proposal.md`（可選的 frontmatter / 「Linear」行用來指定議題 ID）以及含有 `- [ ]` / `- [x]` checkbox 的 `tasks.md`，用來計算進度條。

> [!NOTE]
> **本工具所謂的「spec」** — 指的是一份*變更提案* / *一個交付批次*：一個出貨單位的設計 + 任務 + 範圍（通常 1–3 週）。這是 [Spectra](https://spectra.5xcamp.us/)、[OpenSpec](https://openspec.dev/) 與 [GitHub Spec Kit](https://github.com/github/spec-kit) 採用的現代 AI 輔助 SDD 框架 — 與長期存在、跨多次迭代的「設計即決策紀錄」型 spec（[ADRs](https://adr.github.io/)、Python PEPs、IETF RFCs）不同。圖上的多 spec 警告（卡片上的「⚠ N specs」）就是基於這種批次導向的框架。

![設計文件檢視 — 只顯示有連結提案的議題，每個都有從 proposal 的 tasks.md 推算的進度條](screenshots/designdoc.png)

## 1. 指向你的 repo

在 `.env` 設定一個絕對路徑：

```bash
REPO_PATH=/path/to/your/repo
```

`REPO_PATH` 是 **repo 根目錄**。轉接器會在底下解析 spec 資料夾。純 OpenSpec 專案資料夾永遠是 `openspec/`。Spectra 專案（存在 `.spectra.yaml` 或 `.spectra/`）資料夾來自 `.spectra.yaml` 中的 `spec_dir`，fallback 到 `docs/specs/`（Spectra v2.2.5+ 預設）再到 `openspec/`（舊版 / 過渡期）。實際查找路徑為：

```text
<REPO_PATH>/<spec_dir>/changes/<change-name>/{proposal.md, tasks.md}
```

`bun run dev` 與 `docker compose up` 用法相同 — Docker 下會把路徑 bind-mount 到容器內同樣的位置，後端兩種模式都用同樣的方式讀取。路徑**必須**是絕對路徑。

如果在 `<REPO_PATH>` 底下找不到可用的 spec 資料夾，整合會靜默停用 — 沒有錯誤，UI 也不會出現設計文件篩選。

> [!TIP]
> 想看看提案長什麼樣？看 [`demo-repo/`](../demo-repo) — 一個範例 `openspec/` 目錄，本專案的截圖就是用它產生的。設定 `REPO_PATH=/absolute/path/to/issue-graph/demo-repo` 就能載入。

## 2. 把議題連結到設計文件 change

轉接器會依序嘗試**三種策略**並合併結果。挑一個適合你工作流程的就好 — 不需要全部用：

| 策略 | 何時使用 | 範例 |
|---|---|---|
| **A. Frontmatter** *（建議新團隊用）* | 想要機器可讀、可複製貼上的慣例。資料夾改名也不會壞。 | `proposal.md` 開頭：<br>`---`<br>`linear: [PROJ-123, PROJ-456]`<br>`---` |
| **B. 資料夾名稱** | 想在檔案系統 / `git status` 上一眼看到連結。 | 把 change 目錄改名為 `openspec/changes/PROJ-123-checkpoint-resume/` |
| **C. Regex 行** *（舊版 / 非正式）* | 既有提案已用「Related Linear issues: PROJ-105, PROJ-107」這類敘述。 | `proposal.md` 中任何提到「linear」的行 — 該行上的 ID 會被擷取出來。 |

**範例 — 三種寫法產生同樣的連結：**

```markdown
<!-- A. Frontmatter -->
---
linear: [PROJ-123]
---
# Refactor authentication
```

```text
<!-- B. Folder name -->
openspec/changes/PROJ-123-refactor-auth/proposal.md
```

```markdown
<!-- C. Regex line -->
Linear: PROJ-123

# Refactor authentication
```

```markdown
<!-- C. Regex line, "Related" form -->
Related Linear issues: PROJ-105 (resume), PROJ-107, PROJ-70
```

## 3. 用 Coverage 報表驗證

點擊工具列的 **📊 按鈕** 開啟 Coverage modal。會顯示：

- 掃到的 change 總數、已連結 / 未連結各幾個
- 依策略拆分（`5 frontmatter / 2 folder / 6 regex`）
- 每個 change 的列表 — 點「Unlinked」篩選看到底哪些提案需要補上 Linear ID
- 沒有連結到設計文件的進行中議題（已開始 / 未開始） — 也就是沒有書面計畫的進行中工作

用這份報表決定該在哪裡補上結構。最常見的工作流程：

1. 開 Coverage → 切到 **Unlinked** 篩選
2. 對每個你在意的未連結 change，在 `proposal.md` 加上 `--- linear: [PROJ-XXX] ---`
3. 點橫幅的 🔄 Refresh
4. 再開一次 Coverage 確認數字有變動

資料來自上一次同步 — 編輯檔案後請 refresh 才看得到更新。

## 4. 其他佈局

自動偵測器認得 OpenSpec 與 Spectra 佈局（包含 Spectra 可設定的 `spec_dir`）。其他格式 — ADRs、自家格式、Notion exports — 架構上支援在 `src/backend/designdoc/` 底下加入更多轉接器（例如 `rfc-folder`、`notion-export`）。每個轉接器要實作 `types.ts` 中的 `DesignDocAdapter` 介面；只要符合 proposal.md / tasks.md / checkbox 慣例的佈局都可以直接重用 `scanner.ts`，只需要定義自己的 `detect()` 與 spec-dir 解析邏輯。兩個參考實作請見 `openspec.ts` 與 `spectra.ts`。
