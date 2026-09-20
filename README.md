# Purchase Role Bot

Discord bot that grants a purchased role for **6 months**, logs the order in a channel, and automatically removes the role when it expires.

Two ways to use it:

1. Slash command: `/purchase user order_number role`
2. Right-click a member → **Apps → Grant Purchase Role** → type the order number → pick the role

It also includes `/revoke-purchase` and `/purchase-status`.

---

## What it does

| Action | Result |
| --- | --- |
| `/purchase` | Gives the selected user the selected role for 6 months |
| Right-click user → Grant Purchase Role | Same grant flow, user is already selected |
| Log channel | Posts username, order number, role, staff member, expiry |
| After 6 months | Bot removes the role and posts an expiry log |
| Same user + same role again | Extends expiry another 6 months from now |
| Same order number used twice | Still grants the role, but warns staff and flags the log embed |
| Different role | Adds a second timed role |

---

## 1. Create the Discord bot

1. Open [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Name it anything (`Purchase Bot` is fine) and create it.
3. **General Information** → copy **Application ID**. That is `CLIENT_ID`.
4. Open the **Bot** tab:
   - Click **Add Bot** if needed.
   - Click **Reset Token** and copy the token. That is `DISCORD_TOKEN`.
   - Under **Privileged Gateway Intents**, enable **SERVER MEMBERS INTENT**.
   - Leave *Public Bot* on. Leave *Require OAuth2 Code Grant* off.
5. Invite the bot with this URL. Replace `CLIENT_ID`:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=268520448&integration_type=0&scope=bot%20applications.commands
```

Required bot permissions in that invite:

- Manage Roles
- View Channels
- Send Messages
- Embed Links
- Read Message History

The `applications.commands` scope is required so slash commands and the right-click menu appear.

6. After it joins the server:
   - Server Settings → **Roles**
   - Drag the **bot’s role above every role it will assign**
   - If the bot role is below the role you pick, Discord will refuse the grant
7. Enable Developer Mode: User Settings → App Settings → Advanced → Developer Mode.
8. Right-click the server name → **Copy Server ID**. That is `GUILD_ID`.
9. Create a private staff log channel (example: `#purchase-logs`).
   - Right-click the channel → **Copy Channel ID**. That is `LOG_CHANNEL_ID`.
   - Make sure the bot can see the channel and send embeds there.

Optional: create a staff role and put its ID in `ADMIN_ROLE_ID`. If this is set, that role can use the commands even without Manage Roles. Anyone with Manage Roles can always use them.

---

## 2. Commands after it is online

### Slash

```
/purchase user:@name order_number:ABC-123 role:@VIP
/revoke-purchase user:@name role:@VIP
/purchase-status user:@name
```

`/purchase` asks for:

1. Order number — typed by you
2. User — the customer
3. Role — the role they bought

### Right-click a user

This is the “click on a user and use the bot on them” flow.

1. Right-click the member in the member list or on a message they sent
2. **Apps → Grant Purchase Role**
3. Type the order number in the popup
4. Choose the role from the dropdown
5. The bot grants the role, logs it, and starts the 6-month timer

Only staff with **Manage Roles** (or `ADMIN_ROLE_ID`) can use either path.

---

## 3. Environment variables

Copy `.env.example` to `.env` for local testing.

| Variable | Required | What it is |
| --- | --- | --- |
| `DISCORD_TOKEN` | yes | Bot token |
| `CLIENT_ID` | yes | Application ID |
| `GUILD_ID` | yes | Server ID |
| `LOG_CHANNEL_ID` | yes | Channel that receives grant / revoke / expiry logs |
| `ADMIN_ROLE_ID` | no | Extra staff role allowed to run the commands |
| `DATA_DIR` | no | Folder for `assignments.json`. Use `/data` on Render |
| `ROLE_DURATION_MONTHS` | no | Defaults to `6` |
| `PORT` | no | Render sets this automatically |

---

## 4. Deploy on Render

Render’s **free Web Service sleeps** after a few minutes with no HTTP traffic. A sleeping service drops the Discord gateway, so the bot goes offline and cannot expire roles. Use a **Starter Web Service (~$7/mo)** so it stays online.

### Upload the repo

1. Create a GitHub repo and push this folder (or upload the zip, unzip, `git init`, push).
2. [Render Dashboard](https://dashboard.render.com) → **New → Web Service**.
3. Connect that GitHub repo.
4. Settings:

| Field | Value |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Build command | `npm install` |
| Start command | `npm start` |
| Instance | **Starter** (always-on). Free will sleep. |
| Health check path | `/health` |

5. **Environment** tab — add every required variable from the table above.
   Also add:

```
NODE_VERSION=20
DATA_DIR=/data
ROLE_DURATION_MONTHS=6
```

6. **Disk** (required so 6-month records survive redeploys):

| Field | Value |
| --- | --- |
| Name | `purchase-data` |
| Mount path | `/data` |
| Size | 1 GB |

Without a disk, the bot still grants roles, but it **forgets expiry dates on every deploy**. Those roles then never get auto-removed.

7. Deploy. Open the service URL `/health`. You should see `"ok": true`.
8. In Discord, type `/purchase`. If it does not appear, wait a minute or restart Discord.

`render.yaml` is included if you prefer Render Blueprint deploy. Secrets still have to be typed in the dashboard (`sync: false`).

### Local test before Render

```bash
cp .env.example .env
# fill in the values
npm install
npm start
```

---

## 5. Permissions checklist

**Bot invite permissions (already in the URL above):**

- Manage Roles
- View Channels
- Send Messages
- Embed Links
- Read Message History

**Privileged intent in the Developer Portal:**

- Server Members Intent = ON

**Server role order:**

- Bot role must sit **above** every role it assigns

**Staff:**

- Need Manage Roles, or the role in `ADMIN_ROLE_ID`

**Log channel:**

- Bot must be able to view it and send embeds

If a grant fails with “I cannot assign that role”, the bot role is too low in the role list. Drag it up.

---

## 6. How expiry works

- Grant time + `ROLE_DURATION_MONTHS` calendar months
- Checked every 15 minutes
- Role is removed if the member still has it
- An expiry embed is posted in the log channel
- If the member left the server, the record is still marked inactive
- Re-granting the same role while it is still active **extends** the timer

Records live in `DATA_DIR/assignments.json`.

---

## 7. Project layout

```
index.js              bot + health server
src/config.js         env validation
src/commands.js       slash + context menu registration
src/purchase.js       grant / revoke / staff checks
src/store.js          JSON persistence
src/expiry.js         15-minute sweep
src/http.js           /health for Render
render.yaml           Render Blueprint
.env.example          env template
```

---

## 8. Troubleshooting

| Problem | Fix |
| --- | --- |
| `/purchase` missing | Confirm `CLIENT_ID` + `GUILD_ID`, restart the service, restart the Discord client |
| Right-click menu missing | Same as above. Look under **Apps**, not **Server Settings** |
| “I cannot assign that role” | Move the bot role above the target role |
| Bot offline after a few minutes | Free Render plan slept. Upgrade to Starter or use a paid Background Worker |
| Roles never expire after a deploy | Attach the `/data` disk and set `DATA_DIR=/data` |
| Missing Access / 50013 | Bot lacks Manage Roles, or the target role is above the bot |
| Server Members intent warning | Enable it on the Bot tab and redeploy |
| Log channel silent | Check `LOG_CHANNEL_ID` and that the bot can send messages there |

---

## 9. Security notes

- Never commit `.env` or the bot token
- Keep `#purchase-logs` staff-only
- Rotate the token immediately if it leaks
- The bot only assigns roles it can manage. It cannot give Administrator or roles above itself
