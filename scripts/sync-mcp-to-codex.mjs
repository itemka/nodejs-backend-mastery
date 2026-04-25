import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { mcpServers } = JSON.parse(readFileSync('.mcp.json', 'utf8'));

let toml = '[mcp_servers]\n\n';

const tomlString = (value) => JSON.stringify(String(value));
const tomlKey = (name) => (/[^a-zA-Z0-9_-]/.test(name) ? tomlString(name) : name);

for (const [name, cfg] of Object.entries(mcpServers)) {
  toml += `[mcp_servers.${tomlKey(name)}]\n`;

  if (cfg.command) toml += `command = ${tomlString(cfg.command)}\n`;
  if (cfg.args) toml += `args = [${cfg.args.map(tomlString).join(', ')}]\n`;
  if (cfg.url) toml += `url = ${tomlString(cfg.url)}\n`;

  if (cfg.headers) {
    for (const [k, v] of Object.entries(cfg.headers)) {
      toml += `headers.${tomlKey(k)} = ${tomlString(v)}\n`;
    }
  }

  if (cfg.env) {
    for (const [k, v] of Object.entries(cfg.env)) {
      toml += `env.${tomlKey(k)} = ${tomlString(v)}\n`;
    }
  }

  toml += '\n';
}

mkdirSync('.codex', { recursive: true });
writeFileSync('.codex/config.toml', toml);

console.log('Synced .mcp.json → .codex/config.toml');
