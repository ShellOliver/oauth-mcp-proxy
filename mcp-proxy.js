import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class GenericOAuthMCPProxy {
  constructor() {
    this.tokens = {};
    this.toolCache = new Map();
    this.loadTokens();
  }

  loadTokens() {
    const tokensPath = path.join(process.cwd(), 'tokens.json');
    try {
      if (fs.existsSync(tokensPath)) {
        this.tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
        console.error('[MCP Proxy] Loaded tokens for services:', Object.keys(this.tokens).join(', '));
      } else {
        console.error('[MCP Proxy] No tokens.json found in current directory');
        console.error('[MCP Proxy] To generate tokens, run: npm run auth <service-name>');
      }
    } catch (err) {
      console.error('[MCP Proxy] Error loading tokens.json:', err.message);
    }
  }

  isTokenExpired(serviceName) {
    const service = this.tokens[serviceName];
    if (!service || !service.expiresAt) {
      return false;
    }
    const fiveMinuteBuffer = 300;
    return Date.now() / 1000 >= service.expiresAt - fiveMinuteBuffer;
  }

  async refreshToken(serviceName) {
    const service = this.tokens[serviceName];
    if (!service || !service.refreshToken || !service.tokenUrl) {
      console.error(`[MCP Proxy] Cannot refresh ${serviceName}: missing refreshToken or tokenUrl`);
      return false;
    }

    try {
      console.error(`[MCP Proxy] Refreshing token for ${serviceName}...`);
      
      const response = await fetch(service.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(`${service.clientId}:${service.clientSecret}`).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: service.refreshToken
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const tokenData = await response.json();
      
      this.tokens[serviceName].accessToken = tokenData.access_token;
      this.tokens[serviceName].expiresAt = Date.now() / 1000 + parseInt(tokenData.expires_in || 3600);
      if (tokenData.refresh_token) {
        this.tokens[serviceName].refreshToken = tokenData.refresh_token;
      }

      this.saveTokens();
      console.error(`[MCP Proxy] ✅ Token refreshed for ${serviceName}`);
      return true;
    } catch (err) {
      console.error(`[MCP Proxy] ❌ Token refresh failed for ${serviceName}:`, err.message);
      console.error(`[MCP Proxy] To re-authenticate, run: npm run auth ${serviceName}`);
      return false;
    }
  }

  saveTokens() {
    const tokensPath = path.join(process.cwd(), 'tokens.json');
    fs.writeFileSync(tokensPath, JSON.stringify(this.tokens, null, 2));
  }

  async callRemoteMCP(serviceName, method, params = {}) {
    const service = this.tokens[serviceName];
    if (!service) {
      throw new Error(`Service ${serviceName} not configured`);
    }

    if (!service.serverUrl) {
      throw new Error(`Service ${serviceName} has no serverUrl configured`);
    }

    const maxRetries = 1;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const body = {
          jsonrpc: '2.0',
          id: `proxy-${Date.now()}-${Math.random()}`,
          method: method,
          params: params
        };

        const response = await fetch(service.serverUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${service.accessToken}`
          },
          body: JSON.stringify(body)
        });

        if (response.status === 401 || response.status === 403) {
          console.error(`[MCP Proxy] ${serviceName} returned ${response.status}, attempting token refresh...`);
          
          if (attempt === 0) {
            const refreshed = await this.refreshToken(serviceName);
            if (refreshed) {
              continue;
            }
          }
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        return data;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          continue;
        }
      }
    }

    throw lastError;
  }

  async discoverAllTools() {
    const allTools = [];

    for (const serviceName of Object.keys(this.tokens)) {
      if (this.toolCache.has(serviceName)) {
        allTools.push(...this.toolCache.get(serviceName));
        continue;
      }

      try {
        console.error(`[MCP Proxy] Discovering tools for ${serviceName}...`);
        const response = await this.callRemoteMCP(serviceName, 'tools/list', {});

        if (response && response.result && response.result.tools) {
          const prefixedTools = response.result.tools.map(tool => ({
            ...tool,
            name: `${serviceName}.${tool.name}`
          }));

          this.toolCache.set(serviceName, prefixedTools);
          allTools.push(...prefixedTools);
          console.error(`[MCP Proxy] Discovered ${prefixedTools.length} tools for ${serviceName}`);
        }
      } catch (err) {
        console.error(`[MCP Proxy] Error discovering tools for ${serviceName}:`, err.message);
      }
    }

    return allTools;
  }

  async callTool(toolName, args) {
    const dotIndex = toolName.indexOf('.');
    if (dotIndex === -1) {
      throw new Error(`Invalid tool name: ${toolName}. Expected format: <service>.<tool>`);
    }

    const serviceName = toolName.substring(0, dotIndex);
    const actualToolName = toolName.substring(dotIndex + 1);

    if (!this.tokens[serviceName]) {
      throw new Error(`Service ${serviceName} not configured`);
    }

    console.error(`[MCP Proxy] Calling tool: ${toolName}`);
    const response = await this.callRemoteMCP(serviceName, 'tools/call', {
      name: actualToolName,
      arguments: args
    });

    if (response.error) {
      throw new Error(response.error.message || 'Unknown error');
    }

    return response.result;
  }

  createMCPServer() {
    const server = new Server(
      {
        name: 'oauth-mcp-proxy',
        version: '2.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.discoverAllTools();
      return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const result = await this.callTool(request.params.name, request.params.arguments);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        console.error(`[MCP Proxy] Error calling tool:`, err.message);
        throw err;
      }
    });

    return server;
  }
}

async function main() {
  const proxy = new GenericOAuthMCPProxy();
  const server = proxy.createMCPServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  
  console.error('[MCP Proxy] Server started and ready');
  console.error('');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('📋 Setup Instructions');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('');
  console.error('1. Generate OAuth tokens:');
  console.error('   npm run auth <service-name>');
  console.error('');
  console.error('2. Configure your MCP client with this command:');
  console.error('');
  const proxyPath = path.join(__dirname, 'mcp-proxy.js');
  console.error(`   node "${proxyPath}"`);
  console.error('');
  console.error('3. Copy and paste the path above into your MCP client config:');
  console.error('');
  console.error('   OpenCode (~/.config/opencode/opencode.json):');
  console.error('   {');
  console.error('     "mcp": {');
  console.error('       "oauth-proxy": {');
  console.error('         "type": "local",');
  console.error('         "command": ["node", "' + proxyPath + '"]');
  console.error('       }');
  console.error('     }');
  console.error('   }');
  console.error('');
  console.error('   Claude Desktop (~/.claude/settings/mcp-settings.json):');
  console.error('   {');
  console.error('     "oauth-proxy": {');
  console.error('       "command": "node",');
  console.error('       "args": ["' + proxyPath + '"]');
  console.error('     }');
  console.error('   }');
  console.error('');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('');
  console.error('Full MCP proxy path (copy this):');
  console.error(proxyPath);
  console.error('');
}

main().catch(err => {
  console.error('[MCP Proxy] Fatal error:', err);
  process.exit(1);
});