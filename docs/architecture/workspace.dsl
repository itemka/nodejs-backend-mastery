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

        notionBackup = softwareSystem "notion-backup-automation" "Notion backup agent with local Google OAuth setup and Notion sign-in, a Playwright export trigger in Notion's Settings, Gmail export-email discovery, Drive access diagnostics, checksum-verified Drive backup storage, a resumable backup job run one idempotent tick at a time, console and Telegram notifications, and a deployed health check." {
            notionBackupHealth = container "Health function" "Public GET /api/health returning ok and the short commit SHA, with no caching and no other data." "Vercel Function (Node.js)"
            notionBackupCli = container "Local CLI" "auth:google, auth:notion, drive:check, drive:init, doctor, dev:upload, dev:trigger, dev:download, dev:tick, and telegram:setup: Google consent, a Notion sign-in you complete in a Chrome window, trusted export-email discovery, Drive probes, Redis/session diagnostics, checksum-verified test uploads into the _dev folder, dev-session export requests and download checks, the whole dev backup job one tick per call, and the Telegram chat setup and test message." "Node.js + TypeScript CLI + Playwright"
            notionBackupConfig = container "Local configuration" "Google OAuth credentials and refresh token, the Telegram bot token and chat ID, plus connection and encryption settings; auth:google and telegram:setup --find-chat write them with mode 0600." ".env.local file"
        }

        googleOAuth = softwareSystem "Google OAuth" "Consent, authorization-code exchange with PKCE, and access-token refresh for gmail.readonly and drive.file." "External"
        gmail = softwareSystem "Gmail API" "Read-only mailbox access and Notion export-email discovery; email content and download links stay out of logs." "External"
        googleDrive = softwareSystem "Google Drive API" "Folder visibility checks, year-folder and app-owned root creation, temporary access probes, and resumable backup uploads checked against Drive's checksums, through drive.file." "External"
        upstashRedis = softwareSystem "Upstash Redis" "Managed backup state: jobs with compare-and-set versions, leases, events, consumed export emails and notification marks, plus the encrypted Notion session; auth:notion stores the session, and doctor checks connectivity and decrypts it locally." "External"
        telegram = softwareSystem "Telegram Bot API" "The app's private chat with your bot: backup reports, attention alerts with buttons, and login warnings; no message carries a URL but the Drive file link, a token or email content." "External"
        notion = softwareSystem "Notion" "The web app on app.notion.com (sign-in and the Settings export dialog), the export email's Mailgun link, and the export file host file.notion.com; no Notion API is used." "External"

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
        notionBackupCli -> telegram "Finds your chat, sends the test message and job notifications, and reads who holds the webhook" "Bot API over HTTPS"
        developer -> telegram "Sends /start to the bot and reads backup reports" "Telegram app"
        notionBackupCli -> notion "Checks the saved session, requests workspace exports in Settings, and downloads an export with the session's cookies" "Playwright + Chrome; HTTPS"
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

        container notionBackup "NotionBackupContainers" "Notion backup CLI, local configuration, deployed health function, and current Notion, Google, Redis and Telegram dependencies." {
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
