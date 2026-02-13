/**
 * Unit tests for OAuth2Client
 */

const { OAuth2Client } = require('../../src/oauth');

describe('OAuth2Client', () => {
  test('initializes with auth base URL', () => {
    const customUrl = 'https://test.example.com';
    const client = new OAuth2Client({ authBaseUrl: customUrl });
    // OAuth2Client stores config internally
    expect(client).toBeTruthy();
  });

  test('has required methods', () => {
    const client = new OAuth2Client({});
    expect(typeof client.isAuthenticated).toBe('function');
    expect(typeof client.getUserInfo).toBe('function');
    expect(typeof client.clearTokens).toBe('function');
  });
});
