# Weekly BuildOps refresh

Runs Mondays at noon from a Claude scheduled task (Claude in Chrome must be connected,
with BuildOps logged in). Read-only in BuildOps.

1. Open a live.buildops.com tab.
2. Run `buildops-refresh.js` in that tab (Claude in Chrome: javascript_exec with the file's contents).
   It reads every Active/Draft agreement, each site on them, visit history, assets,
   jobs, projects and visit details. Progress is saved in the tab's localStorage
   (`__alpine_refresh`), so if it's interrupted, running it again resumes.
3. When finished it opens https://alpinehvac.github.io/alpine-portal/refresh.html
   (the person running it must be signed in to the portal with a sales account).
4. Review the counts and click **Apply refresh**.

Nothing entered in the portal is overwritten: renewal notes, checklist marks,
CLEAR reports and sent/reviewed status are kept. Property instructions (site
credentials) and dollar balances are never read.
