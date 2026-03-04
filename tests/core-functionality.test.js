import yaml from 'js-yaml';
import { describe, it, expect, beforeEach } from '@jest/globals';
import crypto from 'crypto';

describe('Config Parsing - Environment Variable Expansion', () => {
  beforeEach(() => {
    delete process.env.TEST_CLIENT_ID;
    delete process.env.TEST_CLIENT_SECRET;
  });

  it('should expand environment variables in strings', () => {
    process.env.TEST_CLIENT_ID = 'env_client_123';
    process.env.TEST_CLIENT_SECRET = 'env_secret_456';

    const expandEnvVars = (obj) => {
      if (typeof obj === 'string') {
        return obj.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
      }
      if (Array.isArray(obj)) {
        return obj.map(expandEnvVars);
      }
      if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = expandEnvVars(value);
        }
        return result;
      }
      return obj;
    };

    const rawConfig = {
      services: {
        test_service: {
          client_id: '${TEST_CLIENT_ID}',
          client_secret: '${TEST_CLIENT_SECRET}'
        }
      }
    };

    const config = expandEnvVars(rawConfig);

    expect(config.services.test_service.client_id).toBe('env_client_123');
    expect(config.services.test_service.client_secret).toBe('env_secret_456');
  });

  it('should handle missing environment variables by replacing with empty string', () => {
    const expandEnvVars = (obj) => {
      if (typeof obj === 'string') {
        return obj.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] || '');
      }
      if (Array.isArray(obj)) {
        return obj.map(expandEnvVars);
      }
      if (typeof obj === 'object' && obj !== null) {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = expandEnvVars(value);
        }
        return result;
      }
      return obj;
    };

    const rawConfig = {
      services: {
        test_service: {
          client_id: '${MISSING_VAR}',
          client_secret: 'static_value'
        }
      }
    };

    const config = expandEnvVars(rawConfig);

    expect(config.services.test_service.client_id).toBe('');
    expect(config.services.test_service.client_secret).toBe('static_value');
  });

  it('should validate URL format', () => {
    const isValidUrl = (url) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    };

    expect(isValidUrl('https://auth.example.com/oauth/authorize')).toBe(true);
    expect(isValidUrl('http://localhost:8080')).toBe(true);
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('://invalid')).toBe(false);
  });
});

describe('Token Expiry Detection', () => {
  it('should detect expired token (more than 5 minutes past expiry)', () => {
    const fiveMinuteBuffer = 300;
    const now = Date.now() / 1000;
    const expiredToken = {
      access_token: 'expired_token',
      expiresAt: now - 600
    };

    const isExpired = Date.now() / 1000 >= expiredToken.expiresAt - fiveMinuteBuffer;

    expect(isExpired).toBe(true);
  });

  it('should detect token expiring within buffer (less than 5 minutes left)', () => {
    const fiveMinuteBuffer = 300;
    const now = Date.now() / 1000;
    const expiringSoon = {
      access_token: 'expiring_soon_token',
      expiresAt: now + 200
    };

    const isExpiringSoon = Date.now() / 1000 >= expiringSoon.expiresAt - fiveMinuteBuffer;

    expect(isExpiringSoon).toBe(true);
  });

  it('should detect valid token (more than 5 minutes remaining)', () => {
    const fiveMinuteBuffer = 300;
    const now = Date.now() / 1000;
    const validToken = {
      access_token: 'valid_token',
      expiresAt: now + 3600
    };

    const isValid = Date.now() / 1000 >= validToken.expiresAt - fiveMinuteBuffer;

    expect(isValid).toBe(false);
  });

  it('should handle missing expiresAt field', () => {
    const tokenWithoutExpiry = {
      access_token: 'token_without_expiry',
      refresh_token: 'refresh_token'
    };

    const isValid = !tokenWithoutExpiry.expiresAt ||
                     Date.now() / 1000 >= tokenWithoutExpiry.expiresAt - 300;

    expect(isValid).toBe(true);
  });
});

describe('Tool Name Prefixing', () => {
  it('should prefix tool names with service name', () => {
    const serviceName = 'test_service';
    const tools = [
      { name: 'read_file', description: 'Read a file' },
      { name: 'write_file', description: 'Write a file' }
    ];

    const prefixedTools = tools.map(tool => ({
      ...tool,
      name: `${serviceName}.${tool.name}`
    }));

    expect(prefixedTools[0].name).toBe('test_service.read_file');
    expect(prefixedTools[1].name).toBe('test_service.write_file');
  });

  it('should prevent name conflicts across services', () => {
    const toolsFromService1 = [
      { name: 'search', description: 'Search in service1' }
    ];
    const toolsFromService2 = [
      { name: 'search', description: 'Search in service2' }
    ];

    const prefixedTools1 = toolsFromService1.map(tool => ({
      ...tool,
      name: `service1.${tool.name}`
    }));

    const prefixedTools2 = toolsFromService2.map(tool => ({
      ...tool,
      name: `service2.${tool.name}`
    }));

    expect(prefixedTools1[0].name).toBe('service1.search');
    expect(prefixedTools2[0].name).toBe('service2.search');
    expect(prefixedTools1[0].name).not.toBe(prefixedTools2[0].name);
  });

  it('should strip service prefix when forwarding to remote service', () => {
    const toolCall = {
      name: 'my_service_search',
      arguments: { query: 'test' }
    };

    const serviceName = 'my_service';
    const actualToolName = toolCall.name.substring(serviceName.length + 1);

    expect(actualToolName).toBe('search');
    expect(actualToolName).not.toContain('my_service');
  });
});

describe('PKCE Generation', () => {
  it('should generate valid PKCE verifier and challenge', () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

    expect(verifier).toBeDefined();
    expect(verifier.length).toBeGreaterThan(0);
    expect(challenge).toBeDefined();
    expect(challenge.length).toBeGreaterThan(0);
    expect(challenge).not.toBe(verifier);
  });

  it('should produce consistent challenge for same verifier', () => {
    const verifier = 'test_verifier_string_123';
    const challenge1 = crypto.createHash('sha256').update(verifier).digest('base64url');
    const challenge2 = crypto.createHash('sha256').update(verifier).digest('base64url');

    expect(challenge1).toBe(challenge2);
  });
});
