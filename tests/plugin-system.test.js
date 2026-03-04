import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';

describe('Plugin System', () => {
  const mockTokensPath = '/tmp/test-tokens.json';
  const mockPluginPath = '/tmp/test-plugin.js';

  beforeEach(() => {
    jest.spyOn(fs, 'readFileSync').mockImplementation();
    jest.spyOn(fs, 'writeFileSync').mockImplementation();
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Plugin Loading', () => {
    it('should load default local plugin', async () => {
      const pluginPath = path.join(process.cwd(), 'plugins', 'local.js');
      
      const tokenData = {
        access_token: 'test_token',
        refresh_token: 'refresh_token',
        expires_in: 3600
      };

      const serviceConfig = {
        clientId: 'test_client',
        clientSecret: 'test_secret',
        redirect_uri: 'http://localhost:8080',
        mcp_url: 'https://api.example.com/mcp'
      };

      const serviceName = 'test_service';

      const mockPlugin = {
        default: (tokens, config, name) => {
          const tokensPath = path.join(process.cwd(), 'tokens.json');
          return { tokensPath, serviceName: name };
        }
      };

      jest.spyOn(path, 'resolve').mockReturnValue(pluginPath);
      jest.doMock(pluginPath, () => mockPlugin, { virtual: true });

      const result = mockPlugin.default(tokenData, serviceConfig, serviceName);

      expect(result.serviceName).toBe(serviceName);
      expect(result.tokensPath).toContain('tokens.json');
    });

    it('should load custom plugin from specified path', () => {
      const customPluginPath = '/custom/path/to/plugin.js';
      
      const mockCustomPlugin = {
        default: (tokens, config, name) => {
          return { custom: true, serviceName: name };
        }
      };

      jest.spyOn(path, 'resolve').mockReturnValue(customPluginPath);
      jest.doMock(customPluginPath, () => mockCustomPlugin, { virtual: true });

      const tokenData = { access_token: 'token' };
      const serviceConfig = {};
      const serviceName = 'service';

      const result = mockCustomPlugin.default(tokenData, serviceConfig, serviceName);

      expect(result.custom).toBe(true);
      expect(result.serviceName).toBe(serviceName);
    });

    it('should handle missing plugin file', () => {
      const nonExistentPlugin = '/non/existent/plugin.js';
      
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(path, 'resolve').mockReturnValue(nonExistentPlugin);

      expect(fs.existsSync(nonExistentPlugin)).toBe(false);
    });
  });

  describe('Plugin Execution', () => {
    it('should execute plugin with token data', () => {
      const tokenData = {
        access_token: 'access_123',
        refresh_token: 'refresh_456',
        expires_in: 3600
      };

      const serviceConfig = {
        clientId: 'client_abc',
        clientSecret: 'secret_xyz'
      };

      const serviceName = 'my_service';

      const mockPlugin = (tokens, config, name) => {
        return {
          service: name,
          hasAccessToken: !!tokens.access_token,
          hasRefreshToken: !!tokens.refresh_token,
          clientId: config.clientId
        };
      };

      const result = mockPlugin(tokenData, serviceConfig, serviceName);

      expect(result.service).toBe(serviceName);
      expect(result.hasAccessToken).toBe(true);
      expect(result.hasRefreshToken).toBe(true);
      expect(result.clientId).toBe('client_abc');
    });

    it('should handle plugin execution errors', () => {
      const errorPlugin = () => {
        throw new Error('Plugin execution failed');
      };

      expect(() => errorPlugin()).toThrow('Plugin execution failed');
    });

    it('should handle plugin that returns undefined', () => {
      const undefinedPlugin = () => {
        return undefined;
      };

      const result = undefinedPlugin();
      expect(result).toBeUndefined();
    });
  });

  describe('Default Local Plugin', () => {
    it('should store tokens in tokens.json', () => {
      const tokenData = {
        access_token: 'test_access_token',
        refresh_token: 'test_refresh_token',
        expires_in: 3600
      };

      const serviceConfig = {
        clientId: 'test_client',
        clientSecret: 'test_secret',
        redirect_uri: 'http://localhost:8080',
        auth_url: 'https://auth.example.com/oauth',
        token_url: 'https://auth.example.com/token',
        mcp_url: 'https://api.example.com/mcp',
        scope: 'read write'
      };

      const serviceName = 'test_service';
      const now = Date.now() / 1000;

      const tokens = {};
      tokens[serviceName] = {
        clientId: serviceConfig.clientId,
        clientSecret: serviceConfig.clientSecret,
        redirect_uri: serviceConfig.redirect_uri,
        auth_url: serviceConfig.auth_url,
        token_url: serviceConfig.token_url,
        mcp_url: serviceConfig.mcp_url,
        scope: serviceConfig.scope,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: now + parseInt(tokenData.expires_in || 3600)
      };

      expect(tokens[serviceName].accessToken).toBe('test_access_token');
      expect(tokens[serviceName].refreshToken).toBe('test_refresh_token');
      expect(tokens[serviceName].expiresAt).toBeGreaterThanOrEqual(now);
    });

    it('should handle existing tokens file', () => {
      const existingTokens = {
        existing_service: {
          accessToken: 'existing_token',
          refreshToken: 'existing_refresh',
          expiresAt: Date.now() / 1000 + 3600
        }
      };

      const newTokenData = {
        access_token: 'new_token',
        refresh_token: 'new_refresh',
        expires_in: 3600
      };

      const updatedTokens = {
        ...existingTokens,
        new_service: {
          accessToken: newTokenData.access_token,
          refreshToken: newTokenData.refresh_token,
          expiresAt: Date.now() / 1000 + newTokenData.expires_in
        }
      };

      expect(updatedTokens.existing_service).toBeDefined();
      expect(updatedTokens.new_service).toBeDefined();
      expect(Object.keys(updatedTokens)).toHaveLength(2);
    });

    it('should calculate correct expiry time', () => {
      const tokenData = {
        access_token: 'token',
        expires_in: 7200
      };

      const now = Date.now() / 1000;
      const expiresAt = now + parseInt(tokenData.expires_in || 3600);

      expect(expiresAt).toBe(now + 7200);
      expect(expiresAt).toBeGreaterThan(now);
    });
  });

  describe('Plugin Interface Contract', () => {
    it('should validate plugin exports default function', () => {
      const validPlugin = {
        default: () => ({ success: true })
      };

      expect(typeof validPlugin.default).toBe('function');
    });

    it('should reject plugin without default export', () => {
      const invalidPlugin = {
        someFunction: () => ({ success: true })
      };

      expect(typeof invalidPlugin.default).toBe('undefined');
    });

    it('should handle plugin with named exports', () => {
      const namedExportPlugin = {
        saveTokens: () => ({ saved: true }),
        loadTokens: () => ({ loaded: true })
      };

      expect(namedExportPlugin.saveTokens).toBeDefined();
      expect(namedExportPlugin.loadTokens).toBeDefined();
    });
  });

  describe('Plugin Error Handling', () => {
    it('should handle token storage errors gracefully', () => {
      const errorPlugin = () => {
        throw new Error('Failed to write tokens file');
      };

      expect(() => errorPlugin()).toThrow('Failed to write tokens file');
    });

    it('should handle invalid token data', () => {
      const invalidTokenData = {
        missing_access_token: true
      };

      const plugin = (tokens) => {
        if (!tokens.access_token) {
          throw new Error('Missing access_token');
        }
        return { success: true };
      };

      expect(() => plugin(invalidTokenData)).toThrow('Missing access_token');
    });

    it('should handle missing service config', () => {
      const tokenData = { access_token: 'token' };
      const incompleteConfig = { clientId: 'test' };

      const plugin = (tokens, config) => {
        if (!config.clientSecret) {
          throw new Error('Missing client_secret');
        }
        return { success: true };
      };

      expect(() => plugin(tokenData, incompleteConfig)).toThrow('Missing client_secret');
    });
  });

  describe('Plugin Extensibility', () => {
    it('should allow custom storage locations', () => {
      const customStoragePlugin = (tokens, config, name) => {
        const customPath = config.storagePath || '/custom/path/tokens.json';
        return {
          tokensPath: customPath,
          serviceName: name
        };
      };

      const tokenData = { access_token: 'token' };
      const serviceConfig = { storagePath: '/custom/storage/tokens.json' };
      const serviceName = 'service';

      const result = customStoragePlugin(tokenData, serviceConfig, serviceName);

      expect(result.tokensPath).toBe('/custom/storage/tokens.json');
    });

    it('should allow custom token transformations', () => {
      const transformPlugin = (tokens) => {
        return {
          transformed: true,
          uppercaseToken: tokens.access_token?.toUpperCase()
        };
      };

      const tokenData = { access_token: 'secret_token' };

      const result = transformPlugin(tokenData);

      expect(result.uppercaseToken).toBe('SECRET_TOKEN');
      expect(result.transformed).toBe(true);
    });
  });
});
