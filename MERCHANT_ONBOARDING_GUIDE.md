# 🚀 JazzCash Payment Gateway Plugin — Merchant Installation & Onboarding Guide

> **Ultra Digital Connect (UDC) Sub-Merchant Gateway Integration**  
> Allow any Shopify store owner (sub-merchant) to accept **JazzCash Mobile Wallet** payments seamlessly on their store.

---

## 📌 How It Works (Architecture Overview)

```
[ Customer Checkout ] 
        │ (Selects JazzCash Mobile Wallet)
        ▼
[ Thank You Page ] ──► [ Red Payment Banner ]
                                │ (Clicks "Pay Now")
                                ▼
               [ Standalone JazzCash Payment Portal ]
                                │ (Enters Mobile Number)
                                ▼
           [ Ultra Digital Connect Central Gateway ]
                (api.ultradigital.cc/api/payment)
                                │
                      [ 2FA MPIN Prompt on Phone ]
                                │
                     [ Transaction Verified & Logged ]
```

- **Master Gateway:** Powered by Ultra Digital Connect (`api.ultradigital.cc`).
- **Sub-Merchant Identification:** Each Shopify store operates as a sub-merchant (e.g., `Cheezious`).
- **Zero Merchant Integration Friction:** Store owners do NOT need their own JazzCash merchant account — they connect using their assigned Gateway API Key and Sub-Merchant Name.

---

## 🛠️ Step 1: Install the Plugin on Shopify Store

1. Open the installation URL provided by Ultra Digital Connect:
   ```text
   https://shopify-jazzcash-plugin-production.up.railway.app/auth?shop=YOUR-STORE-NAME.myshopify.com
   ```
2. Click **Install App** in the Shopify Admin authorization prompt.

---

## 🔑 Step 2: Configure Sub-Merchant Dashboard

1. After installation, open **Apps** > **Jaazcash** in Shopify Admin.
2. In the dashboard, enter your credentials provided by Ultra Digital Connect:
   - **Sub-Merchant Name:** e.g., `Cheezious`
   - **Gateway API Key:** e.g., `udc_live_cheezious_xxxxxx`
3. Click **Save Settings**.

---

## 💳 Step 3: Enable Payment Method in Shopify Settings

1. In Shopify Admin, go to **Settings** > **Payments**.
2. Scroll down to **Manual payment methods** > click **Add manual payment method** > **Create custom payment method**.
3. Set **Custom payment method name** to:
   ```text
   JazzCash Mobile Wallet
   ```
4. In **Additional details**, enter:
   ```text
   Pay instantly using your JazzCash Mobile Account. You will enter your mobile number and approve the 2FA MPIN prompt on your phone after completing the order.
   ```
5. Click **Activate**.

---

## 🎨 Step 4: Add Payment Extension to Checkout (Required)

1. Go to **Settings** > **Checkout**.
2. Next to your checkout configuration, click **Edit** (opens Checkout Editor).
3. Select **Thank you** page view at the top dropdown.
4. In the left sidebar, click **`+ Add block`** under the **Main** (or **Order summary**) section.
5. Search for **`jazzcash-thankyou-ui`** and select it.
6. Click the black **Save** button in the top right corner.

---

## 🛒 Customer Experience & Payment Flow

1. **Checkout:** Customer adds items to cart and proceeds to checkout.
2. **Payment Selection:** Customer selects **JazzCash Mobile Wallet** and clicks **Complete order**.
3. **Thank You Page:** On order confirmation, the **`⚠️ Complete Your JazzCash Payment`** banner appears automatically.
4. **Payment Portal:** Customer clicks **`👉 Pay Now with JazzCash Mobile Wallet`**.
5. **Authorization:** Customer enters their 11-digit JazzCash mobile number (e.g. `03001234567`) and submits.
6. **2FA Prompt:** A USSD 2FA MPIN prompt appears directly on their mobile screen.
7. **Verification:** Customer enters their 4-digit JazzCash MPIN → Payment is verified instantly in real time!

---

## 📊 Monitoring Earnings & Logs

Sub-merchants can view real-time transactions and earnings anytime:
- **Central Dashboard:** `https://api.ultradigital.cc`
- **Shopify Plugin App Index:** View local store transaction history in Shopify Admin > **Apps** > **Jaazcash**.

---

## ❓ Frequently Asked Questions (FAQ)

### 1. Does the store owner need a JazzCash corporate merchant account?
**No.** All payments process through Ultra Digital Connect's master JazzCash account, and funds are automatically attributed to the sub-merchant's account.

### 2. What happens if a customer closes the Thank You page without paying?
The order remains created in Shopify as **Unpaid**. The customer can reopen their Order Confirmation link from their email anytime and click **Pay Now with JazzCash**.

### 3. How are refunds or chargebacks handled?
Refunds can be initiated through the Ultra Digital Connect central portal (`api.ultradigital.cc`) or via the Shopify Admin order page.

---

*Need support? Contact Ultra Digital Connect Team.*
