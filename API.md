# Basecamp API

For tools that update Basecamp on their own, like Jake's Claude doing the morning dashboard refresh.

**Address:** `https://northamerica-northeast1-alpine-hvac-portal.cloudfunctions.net/api`

**Key:** an owner makes one on Users & Settings > API keys. It's shown once. Keep it in the tool's settings or a secret store, never in GitHub, email or chat. Send it on every call:

```
Authorization: Bearer alp_xxxxxxxxxx_...
Content-Type: application/json
```

A key only does what was ticked when it was made. Owners can switch it off or replace it at any time, and every change is logged on that page.

## Calls

| Call | Needs | What it does |
|---|---|---|
| `GET /whoami` | any key | Key name and what it can do. Use it to test. |
| `GET /context` | context:read | Business Context log. Add `?since=2026-11-01` for recent entries only. |
| `POST /context` | context:append | Adds 1 to 50 entries. Never changes or removes existing ones. |
| `GET /cash` | cash:read | Financial Position data, as the page shows it. |
| `PUT /cash` | cash:write | Replaces it. Same file the page's Update data box takes. |
| `GET /profit` | profit:read | The Profit Position part (`profit`, `profitMix`). |
| `PUT /profit` | profit:write | Replaces `profit` (and `profitMix` if sent). Cash numbers are left alone. |
| `GET /ops` | ops:read | Field Operations data. |
| `PUT /ops` | ops:write | Replaces it. Same file the page's Update data box takes. |

## Checks

Anything that fails a check is turned away with a 4xx and a plain message, and nothing is saved.

- **PUT /cash:** `asOf` (YYYY-MM-DD), `weeks` with exactly 13, `accounts`.
- **PUT /ops:** `asOf`, `jobs` list, `visits` list.
- **PUT /profit:** `{"profit": {...}, "profitMix": {...}}`. Needs Financial Position data saved first.
- **POST /context:** `{"entries": [...]}`. Each entry needs `change` (text). Optional: `area` (Operations, Financial, Personnel, Customer), `appliesTo` (`["cash"]`, `["ops"]` or both), `job`, `date`, `effective`, `impact`, `applied` (false = undecided). Basecamp sets the id and marks the key name as the source.
- Each dashboard is capped at about 900 KB.

Saves go to the same place as the page's Update data box, including the dated history copy, marked "api: <key name>".

## Example

```
curl -s -X POST "$BASECAMP_API/context" \
  -H "Authorization: Bearer $BASECAMP_KEY" -H "Content-Type: application/json" \
  -d '{"entries":[{"change":"Mike approved the 2027 labour rate","area":"Financial","appliesTo":["cash","ops"]}]}'
```

Code: `functions/index.js`. Deploy: `firebase deploy --only functions` from the repo folder.
