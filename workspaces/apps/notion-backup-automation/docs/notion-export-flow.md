# notion-backup-automation — Notion Session Gate, Export Trigger and Sign-In

Workflow diagrams for the [notion-backup-automation workspace](../). Behavior and error codes
are in the [README](../README.md#notion-session-and-export). Structure-level view:
[repository C4 workspace](../../../../docs/architecture/workspace.dsl).

## Session Gate — `passSessionGate`

Notion answers `200` without a session, so the gate judges the rendered page. Every call of the
trigger, and `auth:notion` twice, passes it first.

```mermaid
flowchart LR
  Start([NOTION_WORKSPACE_URL]) --> Load{Page loads,<br/>no 5xx?}
  Load -->|no| Unavailable[NOTION_UNAVAILABLE]
  Load -->|yes| Poll{Poll the rendered<br/>page every 250 ms}
  Poll -->|/login path| Expired[NOTION_SESSION_EXPIRED]
  Poll -->|CAPTCHA widget or<br/>verification title| Challenge[NOTION_INTERACTIVE_CHALLENGE]
  Poll -->|no app shell<br/>in time| Unavailable
  Poll -->|app shell| Switcher{Visible switcher named<br/>NOTION_WORKSPACE_NAME?}
  Switcher -->|no| Wrong[NOTION_WRONG_WORKSPACE]
  Switcher -->|yes| Pass([the switcher])
```

## Export Trigger — `requestExport` and `rehearseExport`

Each call decrypts the saved session into a new browser context with downloads refused, and
closes the browser at the end whatever the outcome. An abort before the final click rejects at
once and never clicks. Nothing throws after the click. `rehearseExport` (`dev:trigger --dry-run`)
stops at the dialog and cancels; the cron's Notion probe (`probeExportDialog`) does the same walk
without clicking.

```mermaid
flowchart TD
  Start[Decrypt the session, launch a browser,<br/>new context with downloads refused] --> Gate[Session gate]
  Gate --> Settings[Open Settings: switcher menu, else the shortcut<br/>→ General → Workspace content row]
  Settings --> Running{Export already<br/>running?}
  Running -->|yes| InProgress([already_in_progress, nothing clicked])
  Running -->|no| Dialog[Open the export dialog, set the five values<br/>where they differ, find its Export button]
  Settings -.->|NOTION_UI_CHANGED| Retry{First attempt?}
  Dialog -.->|NOTION_UI_CHANGED| Retry
  Retry -->|yes: reload through the gate| Gate
  Retry -->|no| UiChanged[NOTION_UI_CHANGED]
  Dialog -->|rehearseExport| Cancel([Cancel: dialog_ready])
  Dialog -->|requestExport| Before[onBeforeFinalClick:<br/>the job saves exportClickAt]
  Before --> Click[Click Export once]
  Click --> Confirm{Notion shows<br/>Exporting in time?}
  Confirm -->|yes| Confirmed([confirmed])
  Confirm -->|no, or any error| InDoubt([in_doubt])
```

## Sign-In — `auth:notion`

You sign in in a headed Chrome window with a fresh profile, then the session gate runs. Only
Notion's cookies and localStorage are kept, and `token_v2` is required. The new session is
checked for an unexpired `file_token` (the export file host's cookie) before it is saved, so a
sign-in the download cannot use never replaces a working session. It is then encrypted into
Redis as `secret:notion-storage-state` and re-checked in a new headless browser.

## Automatic Sign-In — `_notion-login`

With `NOTION_AUTO_LOGIN_ENABLED=true`, the worker signs in by itself with Notion's email code, at
most once a day and within 120 s.

```mermaid
flowchart LR
  Queue([_notion-login, signed,<br/>once per attempt]) --> Identity{Saved browser identity,<br/>owner = Gmail address?}
  Identity -->|no| Fail
  Identity -->|yes| Email[Fresh context: login page,<br/>OWNER_GOOGLE_EMAIL, Continue]
  Email -->|challenge or password| Fail
  Email -->|code field| Poll[Gmail every 5 s, 60 s:<br/>trusted login email after the request]
  Poll -->|none, or no single code| Fail
  Poll --> Code[Type the code, Enter]
  Code --> Gate[Session gate]
  Gate --> FileToken{Unexpired file_token?}
  FileToken -->|no| Fail
  FileToken -->|yes| Save[Save session and identity;<br/>health valid; resume the waiting job]
  Save --> Renewed([🔑 Notion login renewed])
  Fail([No retry: 🔑 access is gone,<br/>or the expiry warning])
```
