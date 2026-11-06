# Notion export and login

The app automates Notion's Settings UI with a saved browser session. It uses no Notion API or
stored password. [Setup and recovery commands](../README.md#local-setup) live in the README.

## Session Gate — `passSessionGate`

An HTTP 200 does not prove sign-in: the gate checks the rendered page and configured workspace.

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

Source: [session-gate.ts](../src/adapters/notion/session-gate.ts).

## Export Trigger — `requestExport` and `rehearseExport`

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

The five options are Markdown & CSV, database views set to Current view, page content set to
Everything, private pages enabled and subpage folders enabled. The pre-click marker prevents
another click in the same attempt after interruption. Missing confirmation after a click means
`in_doubt`: wait for Gmail instead of clicking again.

Each call closes its browser and refuses browser downloads; ZIP transfer is a separate adapter.
Changed cookies are saved on a best-effort basis. The cron probe cancels the dialog and checks
the persisted `file_token` too. Source:
[notion-export-trigger.ts](../src/adapters/notion/notion-export-trigger.ts) and
[notion-settings-page.ts](../src/adapters/notion/notion-settings-page.ts).

## Sign-In — `auth:notion`

Headed Chrome opens with a fresh profile. After sign-in, only Notion cookies/localStorage are
retained; valid `token_v2` and file-host `file_token` cookies are required. The encrypted session
is saved in Redis and checked again headlessly. A waiting production job resumes through QStash
when publishing is configured; otherwise use `backup_retry`. Dev jobs resume with `dev:tick`.

## Automatic Sign-In — `_notion-login`

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

Login emails require Gmail's DKIM/DMARC verdicts for `updates.notion.com`. The code is never
stored or logged, and is typed only on Notion hosts. Password/challenge pages or ambiguous
emails stop the attempt. The once-per-24-hour allowance, timeout and fallback are covered in
[daily maintenance and login renewal](../README.md#daily-maintenance-and-login-renewal).
