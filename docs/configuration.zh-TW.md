[English](configuration.md) | **繁體中文**

# 自訂標籤與圖示

`issue-graph` 利用 Linear 標籤把議題分到容器（Mix view）並挑選前綴圖示。提供兩種層級的客製化方式。

## 快速覆寫（環境變數）

預設情況下，`issue-graph` 會自動偵測符合 `service|component|owner|module|team|area|domain` 的標籤群組（用來把議題分到容器），以及 `type|kind|category` 的標籤群組（用來挑選前綴圖示）。

如果你的團隊用不同的命名 — 例如把容器稱為「squads」 — 設定：

```bash
PRIMARY_GROUP=squad
TYPE_GROUP=Type
TYPE_ICONS={"Bug":"🐛","Feature":"✨","Spike":"🔬"}
```

重新啟動後，Mix view 容器、篩選側邊欄與節點圖示都會套用覆寫值。

## 完整控制（`label-schema.yaml`）

若想完整控制每個標籤群組與前綴的呈現方式，請在 `LABEL_SCHEMA_PATH`（預設 `/app/data/label-schema.yaml`）放一個 YAML 檔。完整範例請見 `label-schema.example.yaml`。檔案支援熱重載 — 編輯後點擊橫幅中的「Refresh」即可生效，無需重啟容器。
