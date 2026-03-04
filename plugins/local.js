import fs from 'fs';
import path from 'path';

export default async function(tokenData, config, serviceName, tokensPath) {
  const expiresAt = Date.now() / 1000 + parseInt(tokenData.expires_in || 3600);
  
  const serviceTokenData = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    serverUrl: config.mcp_url,
    tokenUrl: config.token_url,
    clientId: config.client_id,
    clientSecret: config.client_secret,
    expiresAt: expiresAt,
    scope: tokenData.scope || config.scope || ""
  };
  
  let tokens = {};
  if (fs.existsSync(tokensPath)) {
    try {
      tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    } catch (err) {
      console.error('Error reading tokens.json, creating new file:', err);
    }
  }
  
  tokens[serviceName] = serviceTokenData;
  
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
  console.log('✅ Token saved to tokens.json for service:', serviceName);
}