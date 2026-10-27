# 冷啟動載入效能測量報告 (Cold Start Baseline)

## 1. 測量方法 (Method)
本測量依據 Issue #15 與美術規範 13.7 之要求進行，步驟如下：
* **測試工具**：Chrome DevTools (Network 面板)
* **快取設定**：勾選 `Disable cache` (停用快取)
* **網路模擬 Profile**：自訂 `10 Mbps` Down (10,000 Kbps / 20ms Latency) 以及 `Unthrottled` (不限速)
* **測試環境**：生產環境構建 `npm run build` 搭配 `npm run preview`
* **統計方式**：每種設定重複執行至少 3 次，取中位數 (Median)

## 2. 基準線測量結果 (Baseline Results)

### 10 Mbps 網路限速下 (Throttled)
* **到達標題畫面時間 (Time to Title)**：`6.43 s` *(美術規範 13.7 目標：3 s 內)*
* **總請求數 (Requests)**：`224` 個
* **總下載容量 (Transferred Bytes)**：`6,624 kB` (約 6.62 MB) *(美術規範 13.7 預算：Boot 與標題 1.5 MB 內)*

#### 資源類別拆分統計：
| 類別 (Category) | 請求數 | 傳輸容量 (Transferred) | 說明與主要來源 |
| --- | --- | --- | --- |
| **Fonts (字型)** | 98 | **5,486 kB** (約 5.49 MB) | Google Fonts 線上 Unicode-range 分片 (LXGW Wenkai TC / Noto Sans TC) |
| **JavaScript (JS)** | 1 | **407 kB** | 遊戲主邏輯與 Phaser 框架 Bundle (`index-DEdizp6s.js`) |
| **Images / Atlases / Portraits** | 37 | **0 kB** (Blob 解析) / 213 kB 資源 | 地圖圖集、UI 圖集與對話角色立繪 (由 JS 動態解析) |
| **Other / Maps / JSON** | 88 | **731 kB** | 房間地圖、Tileset JSON、音效與 Manifest 等資料 |
| **總計 (Total)** | **224** | **6,624 kB** (6.62 MB) | |

### Unthrottled (不限速) 下
* **到達標題畫面時間 (Time to Title)**：`2.80 s` (Finish: 3.01 s)
* **總請求數**：`224` 個
* **總下載容量**：`6.6 MB`

## 3. 載入瓶頸分析 (Where the time goes)
1. **Google Fonts 阻擋 (Font Gate)**：
   Google 伺服器將中文字型拆分為近百個 Unicode-range 切片。`src/view/text/fonts.ts` 中的 Font Gate 必須等待所有出現字元的分片下載完畢才允許顯示標題畫面[cite: 40, 41]，共產生 98 次請求並下載高達 5.49 MB 的數據[cite: 55]，是拖慢冷啟動的主要瓶頸[cite: 40]。
2. **BootScene 前置預載過多資源**：
   目前 `BootScene.ts` 在進入標題畫面之前，預先載入了所有章節的房間地圖、Tilesets 以及對話立繪[cite: 41]，導致總容量達 6.62 MB[cite: 55]，遠超出美術規範 13.7 規定的 1.5 MB 預算[cite: 41]。
3. **測試方法驗證**：
   在開發模式 (`npm run dev`) 搭配 `?fontDelay=4000` 測試時，標題頁顯示時間精準延遲約 4 秒[cite: 41]，證實量測點能正確反應字型載入門檻 (Font Gate) 的等待時間[cite: 41]。
   