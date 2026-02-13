/**
 * Integration tests for backend components
 */

const { StatefulBackend } = require('../../src/statefulBackend');

describe('Integration', () => {
  test('server can be created and initialized', async () => {
    const backend = new StatefulBackend({ debug: false });

    // Mock MCP server
    const mockServer = {
      sendToolListChanged: jest.fn()
    };

    await backend.initialize(mockServer, {});

    expect(backend._server).toBe(mockServer);
    expect(backend._state).toBe('passive');
  });

  test('enable requires client_id parameter', async () => {
    const backend = new StatefulBackend({ debug: false });
    await backend.initialize(null, {});

    // Call enable without client_id
    const result = await backend.callTool('enable', {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('client_id');
  });

  test('status returns passive state initially', async () => {
    const backend = new StatefulBackend({ debug: false });
    await backend.initialize(null, {});

    const result = await backend.callTool('status', {});

    expect(result.content[0].text).toContain('Disabled');
    expect(result.content[0].text).toContain('Passive');
  });
});
