# Basecamp report mailer

Emails new **Report a problem** and automatic error reports from Basecamp to the XSite support team.

Basecamp saves each report in Firestore (`support_reports`). This Google Apps Script checks every 5 minutes, emails anything new, and marks it emailed. A person's report arrives as its own email (with their screenshot, and Reply goes to them). Errors caught automatically arrive as one digest per check, so a bad change can't flood the inbox.

It runs on a Google account that is a member of the Firebase project, so there are no keys or passwords anywhere. Free, and it doesn't need the Blaze plan.

## Set up (once, about 5 minutes)

1. Sign in to Google with the account that has access to the Firebase project, and go to **script.google.com**. Click **New project** and name it `Basecamp report mailer`.
2. Click the gear (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.
3. Back in the editor, open `appsscript.json` and replace everything in it with this folder's `appsscript.json`. Open `Code.gs` and replace everything with this folder's `Code.gs`. Save.
4. **Project Settings > Script properties > Add script property**: Property `REPORT_TO`, Value: the email addresses to send to, separated by commas. Save.
5. In the editor, choose `setup` in the function list and click **Run**. Google asks for permission: choose the account, then **Advanced > Go to Basecamp report mailer**, then **Allow**. (The warning appears because it's your own script, not a published app.)
6. A "Basecamp report mailer is on" email arrives. Done.

## Changing who gets the emails

Edit `REPORT_TO` in Project Settings > Script properties. No code change needed.

## If emails stop

Open the script and click **Executions** on the left. Each 5-minute run is listed with any error.
