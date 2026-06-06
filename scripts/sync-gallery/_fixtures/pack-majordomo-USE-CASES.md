# Use Cases — tw-ecommerce-majordomo

> 把 29 個 `tw-ecom-*` skills 與 12 個 MCP servers 組合起來，可以服務的台灣電商情境。

---

## 1. 開店建置

### 1.1 在 Shopline 開新店，全套金物流發票串接

**情境：** 客戶要在 Shopline 開新店，需要同步把信用卡 / ATM / 超商代碼 / 超商取貨付款 / 電子發票串好。

**Prompt 範例：**
```
我要在 Shopline 開新店，幫我規劃金流（含信用卡 + ATM + 超商代碼 + 超商取貨付款）、
物流（黑貓 + 7-11 賣貨便）、電子發票（B2C 雲端發票 + 載具），給我串接順序與每段要驗證的 callback。
```

**會用到的 skills：** `tw-ecom-dtc-shopline`、`tw-ecom-payment-ecpay`、`tw-ecom-logistics-cvs`、`tw-ecom-invoice-ezpay`

**會用到的 MCPs：** `shopline`、`ecpay`、`ecpay-logistics`、`ezpay-einvoice`

**注意：** 超商取貨付款（COD）= ECPay 金流 + ECPay 物流綁定，必須走 combined 流程。發票要在出貨後 48 小時內開立。

---

### 1.2 從 Marketplace 起步：Shopee + momo 同時上架

**情境：** 新品牌沒有 DTC 站，先用 Shopee + momo 雙 marketplace 起步。

**Prompt 範例：**
```
我是新品牌，先不開 DTC，想在蝦皮和 momo 同時上架。幫我比較兩邊的上架審核、價格機制、出貨 SLA。
```

**會用到的 skills：** `tw-ecom-channel-strategy`、`tw-ecom-marketplace-shopee`、`tw-ecom-marketplace-momo`

**會用到的 MCPs：** 第一階段 marketplace API 主要靠 skill 內容；之後做 vendor portal 整合可加 `buy123-vendor`。

**注意：** momo 有 best-price 強制比價條款；蝦皮的 SIP 跨境計畫會自動同步商品到他國。

---

## 2. 商品 / 上架

> （其餘情境略）
