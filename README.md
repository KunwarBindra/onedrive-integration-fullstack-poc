# 📁 OneDrive Fullstack POC – React + Node.js + Microsoft Graph API

This is a Proof-of-Concept (POC) fullstack application built with **React (JavaScript)** and **Node.js (Express)** that integrates with **Microsoft OneDrive** using **Microsoft Graph API** and **OAuth 2.0 delegated user flow**.

The app enables users to:
- Authenticate via Microsoft
- Perform **CRUD operations** on OneDrive files and folders
- View files shared with them
- Share files/folders with users or groups (within or across orgs)
- Assign access permissions (view/edit)

---

## 🧩 Tech Stack

| Layer     | Stack                     |
|-----------|---------------------------|
| Frontend  | React.js (JavaScript)     |
| Backend   | Node.js + Express         |
| Auth      | Microsoft OAuth 2.0       |
| API       | Microsoft Graph API       |

---

## ⚙️ Features

- 🔐 Microsoft OAuth 2.0 login (delegated access)
- 📁 List/Create/Update/Delete files and folders
- 🔄 Upload files (<4MB)
- 👀 View items shared with user
- 📤 Share files with internal/external users or groups
- ✅ Assign roles: read-only / write

---

## 🔐 Prerequisites

- Node.js `v18+`
- Microsoft 365 Developer Account or Business Account
- Azure AD App Registration

---

## 🧭 Setup Instructions

### 1️⃣ Create Azure AD App

1. Visit: [Azure Portal – App Registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **"New registration"**
3. Fill in:
   - Name: `onedrive-fullstack-poc`
   - Supported account types: `Accounts in any organizational directory`
   - Redirect URI: `http://localhost:5000/auth/callback` (for dev)

4. Once registered, go to:
   - `Authentication` → Enable:
     - ✅ Access tokens
     - ✅ ID tokens
   - `Certificates & Secrets` → Add a **client secret**
   - `API Permissions` → Add delegated Graph API permissions:
     - `Files.ReadWrite.All`
     - `offline_access`
     - `User.Read`
     - `Group.Read.All`

> 🛡️ If you're not an admin, send the **admin consent link** to your tenant admin:
> ```
> https://login.microsoftonline.com/common/adminconsent?client_id=YOUR_CLIENT_ID
> ```

---

### 2️⃣ Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/onedrive-fullstack-poc.git
cd onedrive-fullstack-poc
```

---

### 3️⃣ Backend Setup

```bash
cd backend
npm install
```

#### Create `.env` file:

```env
PORT=5000
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
REDIRECT_URI=http://localhost:5000/auth/callback
SCOPES=Files.ReadWrite.All offline_access User.Read Group.Read.All
```

```bash
npm start
```

---

### 4️⃣ Frontend Setup

```bash
cd ../frontend
npm install
npm start
```

App will be live at: `http://localhost:3000`

---

## 🔄 OAuth Flow Summary

1. Frontend opens Microsoft OAuth login URL
2. Microsoft redirects to `/auth/callback` with auth code
3. Backend exchanges auth code for access & refresh tokens
4. Backend stores token in memory (or session) for this POC
5. Frontend interacts with your Express API, not Graph API directly

---

## 📂 Folder Structure

```
onedrive-fullstack-poc/
├── backend/
│   ├── index.js
│   ├── routes/
│   │   └── drive.js
│   ├── services/
│   │   └── graph.js
│   └── .env
└── frontend/
    ├── public/
    ├── src/
    │   ├── components/
    │   ├── pages/
    │   └── App.js
    └── .env
```

---

## 💡 Future Improvements

- Refresh token storage (Redis/DB)
- Role-based org permissions
- Support >4MB file chunked uploads
- Document preview and versioning
- Audit logging for HIPAA compliance

---

## ❓FAQs

**Can I use personal OneDrive accounts?**  
🔒 No. Only **business/work accounts** support Graph API with `Files.ReadWrite.All` scope.

**Can I register an app as a developer?**  
✅ Yes. Use Microsoft 365 Developer Program or your org account.

**Can I test with personal tenants?**  
🧪 Yes, by using the [Microsoft 365 Developer Program](https://developer.microsoft.com/en-us/microsoft-365/dev-program).

---

## 🙌 Acknowledgements

- [Microsoft Graph API Docs](https://learn.microsoft.com/en-us/graph/)
- [Microsoft Identity Platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/)