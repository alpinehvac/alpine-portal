# Alpine HVAC Internal Portal — GitHub Pages Setup Guide

## What you're setting up
A private-feeling internal portal hosted for free on GitHub Pages.
Your URL will be: https://YOUR-USERNAME.github.io/alpine-portal/

---

## Step 1 — Create a GitHub account
1. Go to https://github.com
2. Click **Sign up** and create an account (use your work email)
3. Verify your email address

---

## Step 2 — Create a new repository
1. Once logged in, click the **+** icon (top right) → **New repository**
2. Set the name to: `alpine-portal`
3. Set visibility to **Private** ← important for internal use
4. Check **Add a README file**
5. Click **Create repository**

---

## Step 3 — Upload your portal files
1. Inside your new repository, click **Add file** → **Upload files**
2. Drag and drop ALL files from the `alpine-portal` folder:
   - `index.html`
   - `dashboard.html`
   - `auth.js`
   - `tech-recruiting.html`
   - `bdr-recruiting.html`
   *(and any future .html files)*
3. Scroll down, add commit message: "Initial portal upload"
4. Click **Commit changes**

---

## Step 4 — Enable GitHub Pages
1. In your repository, click **Settings** (top tab bar)
2. In the left sidebar, click **Pages**
3. Under "Source", select **Deploy from a branch**
4. Set Branch to **main**, folder to **/ (root)**
5. Click **Save**
6. Wait ~2 minutes, then refresh — you'll see your live URL

---

## Step 5 — Access your portal
Your portal will be live at:
**https://YOUR-USERNAME.github.io/alpine-portal/**

Share this URL with your team. They'll hit the login page first.

---

## Adding new pages later
1. Build the new HTML file (we'll do this together in chat)
2. Go to your GitHub repository
3. Click **Add file** → **Upload files**
4. Upload the new file
5. Add it to the `PAGES` array in `dashboard.html` (we'll handle this too)

---

## Changing usernames or passwords
1. In your repository, click on `auth.js`
2. Click the **pencil icon** (Edit this file)
3. Find the `USERS` section at the top
4. Update names, usernames, or passwords
5. Click **Commit changes**

Changes go live within ~1 minute.

---

## Notes on security
- GitHub Pages are technically public URLs — anyone with the link can try to log in
- The login system protects your content from casual discovery
- For a future upgrade, we can add password-protected private hosting via Netlify
- Never store highly sensitive data (SSNs, financial account numbers) in these pages
