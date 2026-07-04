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

        developer -> playgroundUi "Chats and compares models in the browser"
        playgroundUi -> playgroundApi "Calls REST + SSE endpoints" "JSON/SSE over HTTP"
        playgroundApi -> ollama "Sends chat/completions requests" "OpenAI-compatible HTTP"

        developer -> llmChatCli "Chats in the terminal"
        llmChatCli -> anthropic "Sends messages requests" "HTTPS"
        llmChatCli -> ragService "Calls POST /search via the search_docs tool" "JSON over HTTP"

        developer -> ragService "Ingests documents and inspects search results" "HTTP"
        ragService -> voyage "Embeds chunks and queries" "POST /v1/embeddings"
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
