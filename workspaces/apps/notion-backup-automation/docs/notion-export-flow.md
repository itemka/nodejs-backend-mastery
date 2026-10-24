# notion-backup-automation — Notion Sign-In, Session Gate, and Export Trigger

Workflow diagrams for the [notion-backup-automation workspace](../). Behavior and error codes
are described in the [README](../README.md#notion-session-and-export).

Structure-level view: [repository C4 workspace](../../../../docs/architecture/workspace.dsl).

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
once and never clicks. Nothing throws after the click.

```mermaid
flowchart TD
  Start[Decrypt the session, launch a browser,<br/>new context with downloads refused] --> Gate[Session gate]
  Gate --> Settings[Open Settings: switcher menu, else the shortcut<br/>→ General → Workspace content row]
  Settings --> Running{Export already<br/>running?}
  Running -->|yes| InProgress([already_in_progress, nothing clicked])
  Running -->|no| Dialog[Open the export dialog, set the four values<br/>where they differ, find its Export button]
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

The new session is checked for the export file host's cookie before it is saved, so a sign-in
the download cannot use never replaces a working session.

```mermaid
flowchart LR
  SignIn[Headed Chrome, fresh profile:<br/>you sign in] --> Gate[Session gate]
  Gate --> Capture[Keep Notion's cookies and<br/>localStorage, token_v2 required]
  Capture --> FileToken{Unexpired file_token<br/>for file.notion.com?}
  FileToken -->|no| Keep([exit 1, nothing saved:<br/>the previous session stays])
  FileToken -->|yes| Save[Encrypt into Redis as<br/>secret:notion-storage-state]
  Save --> Probe[New headless browser:<br/>session gate again]
  Probe --> Done([exit 0])
```
