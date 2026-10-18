# Email Fixtures

Hand-written stand-ins for Gmail `users.messages.get` (`format=full`) responses. They copy the
shape of the Notion export email recorded in Phase 0 (see the plan's Phase 0 Findings), with no
real data: the mailbox is `user@example.com`, IPs are documentation addresses, and every link,
DKIM signature and ID is a placeholder.

Each file holds `id`, `internalDate`, `headers` in message order (top first, as Gmail returns
them) and the decoded `html` body. `tests/support/gmail-fixtures.ts` turns one into the API shape:
a single `text/html` part with the body base64url-encoded, as in the real email.

| File                                 | What it is                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export-ready.json`                  | The export email as Phase 0 saw it: Mailgun links, `X-Feedback-Id` subtype `export-completed`, Gmail's DKIM and DMARC pass for `mail.notion.com`.                |
| `forged-authentication-results.json` | A spoof with Notion's `From`, subject and type marker. Gmail's own (topmost) verdict is a DMARC fail; a forged "pass" header sits below it, as a sender adds it. |

Variants (stale, consumed, another subtype, another sender, a changed template) are derived in
the tests from `export-ready.json`.
