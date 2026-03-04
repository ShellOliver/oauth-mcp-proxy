import http from 'http';
import { URL } from 'url';
import crypto from 'crypto';
import open from 'open';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

function expandEnvVars(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
  }
  if (Array.isArray(obj)) {
    return obj.map(expandEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVars(value);
    }
    return result;
  }
  return obj;
}

const rawConfig = yaml.load(fs.readFileSync('./config.yaml', 'utf8'));
const config = expandEnvVars(rawConfig);

let serviceName = process.argv[2];

if (!serviceName) {
  console.error('❌ Error: Service name is required');
  console.error('Usage: node oauth-helper.js <service-name>');
  if (config.services) {
    console.error('\nAvailable services:');
    Object.keys(config.services).forEach(s => console.error(`  - ${s}`));
  }
  process.exit(1);
}

const serviceConfig = config.services?.[serviceName];
if (!serviceConfig) {
  console.error(`❌ Error: Service "${serviceName}" not found in config.yaml`);
  if (config.services) {
    console.error('\nAvailable services:');
    Object.keys(config.services).forEach(s => console.error(`  - ${s}`));
  }
  process.exit(1);
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function runPlugin(tokenData) {
  const pluginPath = serviceConfig.plugin || './plugins/local.js';
  const resolvedPath = path.resolve(pluginPath);
  
  if (fs.existsSync(resolvedPath)) {
    const plugin = await import(resolvedPath);
    if (typeof plugin.default === 'function') {
      await plugin.default(tokenData, serviceConfig, serviceName);
    }
  } else {
    console.error('Plugin not found:', pluginPath);
    console.error('Token data:', tokenData);
  }
}

function startCallbackServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${serviceConfig.redirect_uri.split(':')[2]}`);
      
      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication successful!</h1><p>You can close this window.</p>');
          server.close();
          
          try {
            const tokenResponse = await fetch(serviceConfig.token_url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${serviceConfig.client_id}:${serviceConfig.client_secret}`).toString('base64')}`
              },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: serviceConfig.redirect_uri,
                code_verifier: global.codeVerifier
              })
            });
            
            const tokenData = await tokenResponse.json();
            await runPlugin(tokenData);
            resolve(tokenData);
          } catch (err) {
            console.error('Error exchanging code for token:', err);
            resolve(null);
          }
        } else {
          res.writeHead(400);
          res.end('No code received');
        }
      }
    });
    
    const port = new URL(serviceConfig.redirect_uri).port || 3000;
    server.listen(port, () => {
      console.log(`Callback server running at ${serviceConfig.redirect_uri}`);
    });
  });
}

async function main() {
  const { verifier, challenge } = generatePKCE();
  global.codeVerifier = verifier;
  
  const authParams = new URLSearchParams({
    client_id: serviceConfig.client_id,
    redirect_uri: serviceConfig.redirect_uri,
    response_type: 'code',
    scope: serviceConfig.scope,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: crypto.randomUUID(),
    nonce: crypto.randomUUID(),
    prompt: 'login'
  });
  
  const fullAuthUrl = `${serviceConfig.auth_url}?${authParams}`;
  console.log('Opening browser for authentication...');
  await open(fullAuthUrl);
  
  const tokenData = await startCallbackServer();
  
  if (tokenData) {
    console.log('✅ Authentication complete!');
    console.log('Access token:', tokenData.access_token?.substring(0, 20) + '...');
  }
}

main();