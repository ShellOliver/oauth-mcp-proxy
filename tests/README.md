# Testing Guide

## Overview

This project uses Jest for testing. Due to ESM (ECMAScript Modules) compatibility issues with Jest's mocking capabilities, the test suite uses isolated unit tests that test core logic without complex module mocking.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Structure

```
tests/
├── oauth-flow.test.js          # OAuth 2.0 authentication flow
├── token-refresh.test.js       # Token refresh logic
├── tool-discovery.test.js      # MCP tool discovery and prefixing
├── proxy-execution.test.js     # MCP proxy tool execution
├── plugin-system.test.js      # Plugin system functionality
├── config-parsing.test.js      # Config file parsing and env var expansion
└── error-handling.test.js      # Error handling scenarios
```

## Test Coverage

### Critical Tests (High Priority)

1. **OAuth Authentication Flow** - Tests the complete OAuth 2.0 flow with PKCE
   - PKCE verifier and challenge generation
   - Authorization URL construction
   - Token exchange with authorization code
   - Error handling during auth flow

2. **Token Refresh** - Tests automatic token refresh logic
   - Token expiry detection
   - Refresh token requests
   - Token storage updates
   - Retry logic on 401/403 responses

3. **Tool Discovery** - Tests MCP tool discovery from services
   - Fetching tools list from MCP endpoints
   - Tool name prefixing to prevent conflicts
   - Multi-service tool discovery
   - Tool caching

4. **Proxy Execution** - Tests MCP proxy tool execution
   - Tool call forwarding to services
   - Token injection in Authorization headers
   - Token refresh on 401/403
   - Error handling for invalid requests

### Medium Priority Tests

5. **Plugin System** - Tests token storage plugin architecture
   - Plugin loading and execution
   - Default local plugin functionality
   - Custom plugin support
   - Error handling in plugins

6. **Config Parsing** - Tests configuration file handling
   - YAML parsing
   - Environment variable expansion (`${VAR_NAME}`)
   - Config validation
   - Required field checking

7. **Error Handling** - Tests comprehensive error scenarios
   - HTTP error responses (400, 401, 403, 404, 500, 502, 503)
   - Network errors (timeout, connection refused, DNS failure)
   - OAuth-specific errors (invalid_grant, access_denied, expired_token)
   - MCP-specific errors (tool_not_found, invalid_arguments)

## Manual Testing

For integration testing with actual OAuth providers, create a test configuration:

1. Create `test-config.yaml` (not in git):
```yaml
services:
  test_service:
    client_id: "your_client_id"
    client_secret: "your_client_secret"
    redirect_uri: "http://localhost:8080"
    auth_url: "https://auth.example.com/oauth/authorize"
    token_url: "https://auth.example.com/oauth/token"
    mcp_url: "https://api.example.com/mcp"
    scope: "read write"
```

2. Run the authentication:
```bash
npm run auth -- test_service
```

3. Run the proxy:
```bash
npm run proxy
```

4. Test tool execution through MCP client

## Testing Philosophy

Given this is a local development tool:

- **Focus on core functionality**: OAuth flow, token management, tool discovery
- **Mock external services**: Don't require real OAuth providers to run tests
- **Test edge cases**: Expired tokens, network failures, malformed responses
- **Validate data transformations**: PKCE challenges, tool prefixing, token updates

## Adding New Tests

When adding new functionality:

1. Identify the critical paths that must work
2. Create unit tests for core logic (isolated, no network calls)
3. Create integration tests for workflows (auth → token → tool call)
4. Test error cases (what happens when things fail?)
5. Update this README with new test descriptions

## Known Limitations

- Jest mocking with ESM has limitations; tests use direct function testing
- Some complex mocking scenarios are avoided in favor of testing core logic
- Network calls are mocked using simple function replacement
- Integration tests with real OAuth providers are manual only

## CI/CD

Consider adding automated test runs:
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
```
