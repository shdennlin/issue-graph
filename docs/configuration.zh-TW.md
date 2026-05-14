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

### 哪裡可以確認目前生效的設定

不用自己猜最後選到的是哪一個 group。**設定 → 後端** 會列出目前生效的 **bucket label group** 與 **type label group**，並標明來源（自動偵測 / `PRIMARY_GROUP` 環境變數 / `label-schema.yaml`）。把游標停在 toolbar 上的 Mix 按鈕，tooltip 也會顯示目前依哪個 label group 分組。

## 完整控制（`label-schema.yaml`）

若想完整控制每個標籤群組與前綴的呈現方式，請在 `LABEL_SCHEMA_PATH`（預設 `/app/data/label-schema.yaml`）放一個 YAML 檔。完整範例請見 `label-schema.example.yaml`。檔案支援熱重載 — 編輯後點擊橫幅中的「Refresh」即可生效，無需重啟容器。
