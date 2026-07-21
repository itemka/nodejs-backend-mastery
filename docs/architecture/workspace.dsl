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

        shopMvc = softwareSystem "shop-mvc-express" "Server-rendered product catalog: create/list products via HTML forms, Helmet security headers, Zod validation, in-memory product store." {
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
    }

    views {
        systemLandscape "Landscape" "Runnable apps and the external LLM services they depend on." {
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
