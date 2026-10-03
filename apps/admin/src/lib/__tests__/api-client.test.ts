import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression test for a production incident: VITE_API_BASE_URL defaulted to
 * '/api/v1', but the generated OpenAPI `paths` already carry that prefix (it's
 * the real route NestJS serves), so every request became
 * '/api/v1/api/v1/...' and 404'd - silently, since the frontend only showed a
 * generic "rejected by the API" message. See apps/api/test/app.e2e-spec.ts for
 * the matching backend-side assertion of the correct path.
 */
describe('api client base URL', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
  });

  function calledUrl(fetchMock: ReturnType<typeof vi.fn>): string {
    const arg = fetchMock.mock.calls[0]?.[0] as Request | string;
    return typeof arg === 'string' ? arg : arg.url;
  }

  it('does not double-prefix /api/v1 on POST requests', async () => {
    const { api } = await import('../api-client');
    await api.POST('/api/v1/auth/login', { body: { idToken: 'x'.repeat(20) } });

    const url = calledUrl(fetch as unknown as ReturnType<typeof vi.fn>);
    expect(url).toMatch(/\/api\/v1\/auth\/login$/);
    expect(url).not.toContain('/api/v1/api/v1');
  });

  it('does not double-prefix /api/v1 on GET requests', async () => {
    const { api } = await import('../api-client');
    await api.GET('/api/v1/vehicles');

    const url = calledUrl(fetch as unknown as ReturnType<typeof vi.fn>);
    expect(url).toMatch(/\/api\/v1\/vehicles$/);
    expect(url).not.toContain('/api/v1/api/v1');
  });
});
