workspace "nodejs-backend-mastery" "C4 model of the runnable apps in this monorepo. Scaffold apps join the model when they become runnable." {

    model {
        developer = person "Developer" "Runs the apps locally while learning backend patterns."

        ollama = softwareSystem "Ollama" "Local LLM runtime exposing an OpenAI-compatible API on localhost:11434." "External"
        voyage = softwareSystem "VoyageAI API" "Hosted embeddings API (voyage-3-large by default)." "External"
        anthropic = softwareSystem "Anthropic API" "Hosted Claude models API." "External"

        playground = softwareSystem "local-llm-playground" "Local-only LLM lab: chat, streaming chat, multi-model compare, and llm-checker recommendations." {
            playgroundUi = container "React UI" "Chat, streaming, compare, and llm-checker screens with localStorage persistence." "Vite + React"
            playgroundApi = container "Express API" "REST + SSE endpoints under /api: chat, compare, models, llm-checker (strict command allowlist)." "Node.js + Express"
        }

        ragPipeline = softwareSystem "rag-pipeline" "Retrieval-only RAG service: markdown ingest, hybrid vector + BM25 search with RRF fusion." {
            ragService = container "Express retrieval service" "/health, /ingest, /search over an in-memory vector index and a BM25 lexical index." "Node.js + Express"
        }

        llmChat = softwareSystem "llm-chat" "Interactive LLM chat CLI with an optional search_docs retrieval tool." {
            llmChatCli = container "Chat CLI" "Terminal chat loop built on @workspaces/llm-client (provider-neutral, Anthropic adapter)." "Node.js CLI"
        }

        shopMvc = softwareSystem "shop-mvc-express" "Server-rendered product catalog with Helmet security headers, Zod validation, an in-memory product store, and a non-production OpenAPI 3.1 contract at /openapi.json with Swagger UI at /docs." {
            shopMvcApp = container "Express MVC app" "Routes + controllers render server-side HTML views; no separate frontend. Publishes an OpenAPI 3.1 contract generated from the boundary Zod schemas at /openapi.json + Swagger UI at /docs (non-production only)." "Node.js + Express"
        }

        mcpChat = softwareSystem "mcp-chat" "Document-focused MCP chatbot: CLI client streams Claude responses, resolves @doc mentions, and runs MCP prompts against a stdio document server." {
            mcpChatCli = container "CLI Chatbot" "Terminal REPL on top of @workspaces/llm-client: streams Claude responses, resolves @doc mentions, and runs MCP prompts as /slash commands." "Node.js CLI + MCP Client SDK"
            mcpChatServer = container "Document MCP Server" "Stdio MCP server exposing read_doc_contents/edit_document tools, docs:// resources, and a format prompt over an in-memory document store." "Node.js + MCP Server SDK (stdio)"
        }

        promptEvalLab = softwareSystem "prompt-eval-lab" "Automated prompt-evaluation CLI: runs a dataset through a prompt template, grades each response with a second model call, and writes an HTML/JSON report." {
            promptEvalCli = container "Eval CLI" "Dataset -> render -> run -> grade pipeline on top of @workspaces/llm-client; writes timestamped reports to disk." "Node.js CLI"
        }

        claudeCapabilitiesLab = softwareSystem "claude-capabilities-lab" "Terminal lab for manually testing Claude-specific capabilities (extended thinking, images, PDFs, files, prompt caching, citations, code execution) against committed sample fixtures." {
            claudeCapabilitiesCli = container "Scenario CLI" "Argument-driven scenario runner on top of @workspaces/llm-client and the Anthropic SDK; validates sample file types and sizes before sending." "Node.js CLI"
        }

        notionBackup = softwareSystem "notion-backup-automation" "Notion backup agent with local Google OAuth setup and Notion sign-in, a Playwright export trigger in Notion's Settings, Gmail export-email discovery, Drive access diagnostics, checksum-verified Drive backup storage, a resumable backup job run one idempotent tick at a time by a QStash-woken worker, a daily cron with health probes, login warnings and a heartbeat, console and Telegram notifications, a bounded Gemini supervisor for incidents the rules do not resolve, a bearer-protected remote MCP server, an authenticated Telegram hub integration for status and action buttons, and a deployed health check." {
            notionBackupHealth = container "Health function" "Public GET /api/health returning ok and the short commit SHA, with no caching and no other data." "Vercel Function (Node.js)"
            notionBackupWorker = container "Worker function" "POST /api/jobs/process/[jobId]: verifies the QStash signature against APP_BASE_URL plus the path and the raw body, runs one tick of one job (serverless Chromium for the export trigger; one supervisor decision on a pending incident, from a closed set of actions with deterministic preconditions), publishes the next wakeup, and records the _ping smoke test's nonce." "Vercel Function (Node.js, 300 s)"
            notionBackupCron = container "Daily cron function" "GET /api/cron/daily with the cron secret: auto-start when enabled, the watchdog and lifetime check, Google, Drive and Notion probes, login warnings, resuming a job whose login works again, and the heartbeat; ?probe= runs one probe." "Vercel Function (Node.js, 300 s, Vercel Cron)"
            notionBackupMcp = container "MCP function" "POST /mcp (rewritten to /api/mcp) with the bearer token, an Origin rule and an hourly limit: a new stateless MCP server per request with 7 tools (start, status, list, process, retry, cancel, health) whose views come from an allowlist; it publishes wakeups and never runs a step. backup_health with checkAgent runs one canned, content-free supervisor decision." "Vercel Function (Node.js, MCP Streamable HTTP)"
            notionBackupIntegration = container "Telegram integration function" "POST /api/integrations/telegram with the integration bearer token: normalized commands and callbacks from the hub, backup action deduplication and single-use confirmations; status, retry, cancel and login guidance use the existing backup application methods." "Vercel Function (Node.js)"
            notionBackupCli = container "Local CLI" "auth:google, auth:notion, drive:check, drive:init, doctor, smoke:qstash, dev:upload, dev:trigger, dev:download, dev:tick, and telegram:setup: Google consent, a Notion sign-in you complete in a Chrome window that then resumes a job waiting for it, the deployed QStash smoke test, trusted export-email discovery, Drive probes, Redis/session diagnostics, checksum-verified test uploads into the _dev folder, dev-session export requests and download checks, the whole dev backup job one tick per call, and Telegram test notifications through the independent hub; bot setup is owned by the hub CLI." "Node.js + TypeScript CLI + Playwright"
            notionBackupConfig = container "Local configuration" "Google OAuth credentials and refresh token, the Telegram hub URL, integration ID and bearer token, plus connection and encryption settings; no bot token or webhook configuration." ".env.local file"
        }

        telegramHub = softwareSystem "telegram-webhook-hub" "Independent Vercel project for Artsem Automation Hub: the bot's only webhook owner, generic authenticated integration routing, namespaced callbacks, rate limiting, retry-safe delivery receipts, and all Bot API calls. Integrations share validated HTTP schemas, not implementation imports." {
            telegramHubWebhook = container "Webhook function" "POST /api/webhook: verifies the Telegram secret before dependencies, accepts only the owner chat/sender, leases and deduplicates updates, routes configured commands and callback namespaces to authenticated HTTPS integrations, and leaves transient failures retryable." "Vercel Function (Node.js)"
            telegramHubMessages = container "Messages function" "POST /api/messages with a per-integration bearer token: validates an allowlisted sendMessage, removeButtons or answerCallbackQuery operation and sends only to the configured owner chat." "Vercel Function (Node.js)"
            telegramHubHealth = container "Health function" "Public GET /api/health with no credentials or private configuration in its response." "Vercel Function (Node.js)"
            telegramHubCli = container "Bot setup CLI" "telegram:setup --find-chat, --test, --info, or guarded webhook registration: the only application that configures the bot's webhook; replacement requires --replace and preserves pending updates." "Node.js + TypeScript CLI"
            telegramHubConfig = container "Hub configuration" "Bot API token, private chat ID, webhook secret, explicit integration registry with per-integration bearer tokens, and independent Redis prefix/connection settings." ".env.local and Vercel Production environment"
        }

        googleOAuth = softwareSystem "Google OAuth" "Consent, authorization-code exchange with PKCE, and access-token refresh for gmail.readonly and drive.file." "External"
        gmail = softwareSystem "Gmail API" "Read-only mailbox access and Notion export-email discovery; email content and download links stay out of logs." "External"
        googleDrive = softwareSystem "Google Drive API" "Folder visibility checks, year-folder and app-owned root creation, temporary access probes, and resumable backup uploads checked against Drive's checksums, through drive.file." "External"
        upstashRedis = softwareSystem "Upstash Redis" "Managed state in isolated application namespaces: backup jobs, leases, events, encrypted Notion session and confirmations; the independent hub stores only delivery leases, receipts and rate limits in its own prefix or database." "External"
        telegram = softwareSystem "Telegram Bot API" "The private chat with Artsem Automation Hub: configured integrations receive commands and button taps and send sanitized reports; only telegram-webhook-hub owns the token and calls this API." "External"
        notion = softwareSystem "Notion" "The web app on app.notion.com (sign-in and the Settings export dialog), the export email's Mailgun link, and the export file host file.notion.com; no Notion API is used." "External"
        qstash = softwareSystem "Upstash QStash" "EU endpoint: delayed, signed, deduplicated wakeups of the worker, one at a time per environment; no schedules are configured in its console." "External"
        healthchecks = softwareSystem "healthchecks.io" "The outside heartbeat: alerts through its own channel when the daily cron stops pinging for two days." "External"
        gemini = softwareSystem "Gemini API" "Google AI Studio key: one structured-JSON supervisor decision per call, at temperature 0, from a content-free context; never a Vertex AI project." "External"
        mcpClient = softwareSystem "MCP client" "Claude Code (user scope), Cursor or Codex, configured with the backup server's URL and bearer token." "External"

        developer -> playgroundUi "Chats and compares models in the browser"
        playgroundUi -> playgroundApi "Calls REST + SSE endpoints" "JSON/SSE over HTTP"
        playgroundApi -> ollama "Sends chat/completions requests" "OpenAI-compatible HTTP"

        developer -> llmChatCli "Chats in the terminal"
        llmChatCli -> anthropic "Sends messages requests" "HTTPS"
        llmChatCli -> ragService "Calls POST /search via the search_docs tool" "JSON over HTTP"

        developer -> ragService "Ingests documents and inspects search results" "HTTP"
        ragService -> voyage "Embeds chunks and queries" "POST /v1/embeddings"

        developer -> shopMvcApp "Creates and lists products via server-rendered HTML forms" "HTTP"

        developer -> mcpChatCli "Chats in the terminal, mentions @docs, runs /prompt commands"
        mcpChatCli -> mcpChatServer "Spawns as a child process and connects via stdio; lists tools/resources/prompts, calls tools" "MCP over stdio"
        mcpChatCli -> anthropic "Sends messages requests with tool definitions; relays tool_use results back" "HTTPS"

        developer -> promptEvalCli "Runs the eval CLI against a local dataset file"
        promptEvalCli -> anthropic "Sends solve + model-grader messages requests (grader uses structured JSON output)" "HTTPS"

        developer -> claudeCapabilitiesCli "Runs individual capability scenarios from the terminal"
        claudeCapabilitiesCli -> anthropic "Sends scenario requests (messages, files, code execution)" "HTTPS"

        developer -> notionBackupHealth "Checks that a deployment is live" "HTTPS"
        developer -> notionBackupCli "Runs Google setup and backup dependency diagnostics" "Terminal"
        developer -> googleOAuth "Grants Gmail and Drive access, optionally choosing folders" "HTTPS in browser"
        developer -> notion "Signs in, including MFA, in the window auth:notion opens" "HTTPS in browser"
        notionBackupCli -> notionBackupConfig "Reads settings and credentials; writes the Google refresh token" "Local file I/O"
        notionBackupCli -> googleOAuth "Exchanges authorization codes and refreshes access tokens" "OAuth 2.0 over HTTPS"
        notionBackupCli -> gmail "Reads the mailbox profile and finds and validates export emails" "REST over HTTPS (gmail.readonly)"
        notionBackupCli -> googleDrive "Checks folders, manages access probes, finds or creates the app-owned root, and uploads test backups to _dev" "REST over HTTPS (drive.file)"
        notionBackupCli -> upstashRedis "Pings Redis, stores and reads the encrypted Notion session, and keeps the dev job's state, leases and events" "Redis REST over HTTPS"
        notionBackupCli -> telegramHubMessages "Sends test messages and dev backup reports through the hub" "HTTPS POST (integration bearer)"
        developer -> telegram "Sends /start and /status to the bot, taps report buttons, and reads backup reports" "Telegram app"
        developer -> mcpClient "Starts and follows backups"
        mcpClient -> notionBackupMcp "Lists and calls the backup tools" "MCP Streamable HTTP over HTTPS (Bearer)"
        notionBackupMcp -> upstashRedis "Creates, reads and updates jobs, reads the health results, and counts the rate limits" "Redis REST over HTTPS"
        notionBackupMcp -> qstash "Publishes immediate wakeups and cancels superseded ones" "REST over HTTPS"
        notionBackupMcp -> gemini "Runs the canned checkAgent decision" "REST over HTTPS (API key header)"
        developer -> telegramHubCli "Discovers the chat, inspects webhook ownership, tests, and configures the bot" "Terminal"
        developer -> telegramHubHealth "Checks the independent hub deployment" "HTTPS"
        telegramHubCli -> telegramHubConfig "Reads hub settings and records discovered chat identity" "Local file I/O"
        telegramHubCli -> telegram "Finds the private chat, sends a namespaced test, reads and sets the sole webhook" "Bot API over HTTPS"
        telegram -> telegramHubWebhook "Delivers messages and callback queries" "HTTPS POST (Telegram secret header)"
        telegramHubWebhook -> upstashRedis "Leases updates, records completed deliveries, and counts retry-safe ingress limits in the hub namespace" "Redis REST over HTTPS"
        telegramHubWebhook -> notionBackupIntegration "Forwards validated normalized updates to the configured backup integration" "HTTPS POST (integration bearer)"
        telegramHubWebhook -> telegram "Sends generic help and acknowledges unsupported callbacks" "Bot API over HTTPS"
        telegramHubMessages -> telegram "Sends replies and notifications, answers callbacks, and removes buttons for the owner chat" "Bot API over HTTPS"
        notionBackupIntegration -> upstashRedis "Reads and updates backup jobs, deduplicates actions, and keeps one-time confirmations" "Redis REST over HTTPS"
        notionBackupIntegration -> qstash "Publishes the wakeup of a retried job and cancels superseded ones" "REST over HTTPS"
        notionBackupIntegration -> telegramHubMessages "Replies, answers taps and removes used buttons" "HTTPS POST (integration bearer)"
        notionBackupCli -> notion "Checks the saved session, requests workspace exports in Settings, and downloads an export with the session's cookies" "Playwright + Chrome; HTTPS"
        notionBackupCli -> qstash "Publishes the signed _ping smoke test, and a wakeup for a prod job that waited for the Notion login" "REST over HTTPS"
        qstash -> notionBackupWorker "Delivers signed wakeups and the _ping" "HTTPS POST (Upstash-Signature JWT)"
        notionBackupWorker -> qstash "Publishes the next wakeup" "REST over HTTPS"
        notionBackupWorker -> upstashRedis "Leases, reads and updates jobs, appends events, claims emails, and reads the encrypted Notion session" "Redis REST over HTTPS"
        notionBackupWorker -> notion "Requests the workspace export in Settings, and downloads the ZIP with the session's cookies" "serverless Chromium; HTTPS"
        notionBackupWorker -> googleOAuth "Refreshes access tokens" "OAuth 2.0 over HTTPS"
        notionBackupWorker -> gmail "Finds the export email and re-reads its link" "REST over HTTPS (gmail.readonly)"
        notionBackupWorker -> googleDrive "Adopts an existing backup, or uploads the verified ZIP" "REST over HTTPS (drive.file)"
        notionBackupWorker -> telegramHubMessages "Sends backup reports and attention alerts" "HTTPS POST (integration bearer)"
        notionBackupWorker -> gemini "Asks for one supervisor decision on a pending incident" "REST over HTTPS (API key header)"
        notionBackupCli -> gemini "Runs dev:tick's supervisor decisions and the test:agent-live evaluation" "REST over HTTPS (API key header)"
        notionBackupCron -> upstashRedis "Records the run and the probe results, finds the active job, and marks warnings as sent" "Redis REST over HTTPS"
        notionBackupCron -> qstash "Starts, re-arms or resumes the active job with a wakeup and cancels superseded ones" "REST over HTTPS"
        notionBackupCron -> notion "Probes the session and the export dialog, without exporting" "serverless Chromium; HTTPS"
        notionBackupCron -> googleOAuth "Probes the refresh token and its scopes" "OAuth 2.0 over HTTPS"
        notionBackupCron -> gmail "Probes the mailbox profile" "REST over HTTPS (gmail.readonly)"
        notionBackupCron -> googleDrive "Probes the root and the year folder, and a probe file under _dev" "REST over HTTPS (drive.file)"
        notionBackupCron -> telegramHubMessages "Sends login warnings and lost-access alerts" "HTTPS POST (integration bearer)"
        notionBackupCron -> healthchecks "Pings after each run, or /fail when a sub-step threw" "HTTPS GET"
        healthchecks -> developer "Alerts when the pings stop" "Email or Telegram"
    }

    views {
        systemLandscape "Landscape" "Runnable apps and the external services they depend on." {
            include *
            autoLayout lr
        }

        container playground "PlaygroundContainers" "local-llm-playground containers and their Ollama dependency." {
            include *
            autoLayout lr
        }

        container ragPipeline "RagRetrievalContainers" "rag-pipeline retrieval service, its VoyageAI dependency, and the llm-chat consumer." {
            include *
            autoLayout lr
        }

        container mcpChat "McpChatContainers" "mcp-chat CLI client, its stdio MCP server, and the Anthropic dependency." {
            include *
            autoLayout lr
        }

        container notionBackup "NotionBackupContainers" "Notion backup CLI, deployed control and worker functions, authenticated Telegram hub integration, and their external service dependencies." {
            include *
            autoLayout lr
        }

        container telegramHub "TelegramHubContainers" "Independent Telegram hub ingress, messaging and setup CLI, with isolated delivery state and the authenticated backup integration." {
            include *
            autoLayout lr
        }

        styles {
            element "Person" {
                shape person
            }
            element "External" {
                background #8c8c8c
                color #ffffff
            }
        }
    }
}
