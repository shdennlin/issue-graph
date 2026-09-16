[English](troubleshooting.md) | **繁體中文**

# 疑難排解

## 我換了 `LINEAR_API_KEY`，但圖上還顯示舊工作區的議題

`issue-graph` 在 `data/graph.db` 中以 identifier 為 key 快取議題。如果把 `LINEAR_API_KEY` 換成另一個工作區，舊議題會留在快取中（identifier 不會與新議題衝突），污染整張圖。
下一次同步偵測到時會在 log 印出警告：

```
WARN: Cache holds far more issues than this sync returned. If you switched
LINEAR_API_KEY to a different workspace, POST /api/reset-cache to clear
stale data.
```

只要送一個 request 就能修好 — 會清掉 `issue_cache`、`label_cache`，以及綁在工作區上的 meta 項目（設計文件 payload、workflow states）。Snapshots、註解與同步歷史都會保留：

```bash
curl -X POST http://localhost:31415/api/reset-cache
curl -X POST http://localhost:31415/api/sync
```

或者，如果你想完全從零開始（連 snapshots 與註解都不要），停掉 server 然後 `rm data/graph.db data/graph.db-shm data/graph.db-wal`。

如果常常切換，請在 **設定 → Workspaces** 中分別加入每個 Linear 工作區。每個工作區有獨立資料庫，從分頁列切換完全不需要重置快取。請見 [工作區](advanced-workspaces.zh-TW.md)。
