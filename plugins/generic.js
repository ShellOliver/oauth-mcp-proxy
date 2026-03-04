import fs from 'fs';

export default async function(tokenData, config, tokensPath) {
  const output = {
    timestamp: new Date().toISOString(),
    token: tokenData,
    config: {
      mcp_url: config.mcp_url,
      client_id: config.client_id
    }
  };

  fs.writeFileSync(tokensPath, JSON.stringify(output, null, 2));
  console.log('✅ Tokens saved to', tokensPath);
}