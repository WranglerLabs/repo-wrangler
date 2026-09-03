import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOrganizationCopilotSubscription, listOrganizationBudgets, listOrganizationUsage,
} from '../src/collect';
import { GITHUB_BILLING_API_VERSION } from '../src/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHub enhanced billing', () => {
  it('collects and validates organization-wide Copilot subscription metadata separately', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      seat_breakdown: {
        total: 12, added_this_cycle: 2, pending_invitation: 1,
        pending_cancellation: 0, active_this_cycle: 10, inactive_this_cycle: 2,
      },
      seat_management_setting: 'assign_selected', ide_chat: 'enabled',
      platform_chat: 'enabled', cli: 'enabled', public_code_suggestions: 'block',
      plan_type: 'business',
    })));

    const result = await getOrganizationCopilotSubscription('token', 'heritage-virginia');

    expect(result).toEqual(expect.objectContaining({
      state: 'available',
      data: { subrequestsUsed: 1, item: expect.objectContaining({
        planType: 'business', totalSeats: 12, activeThisCycle: 10,
        seatManagementSetting: 'assign_selected', publicCodeSuggestions: 'block',
      }) },
    }));
  });

  it('does not turn an unavailable or malformed Copilot subscription into an empty subscription', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ message: 'not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ plan_type: 'business' })));
    expect((await getOrganizationCopilotSubscription('token', 'acme')).state)
      .toBe('unsupported_by_plan');
    expect((await getOrganizationCopilotSubscription('token', 'acme')).state).toBe('error');
  });

  it('paginates and maps the complete current budget schema', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ budgets: [{
        id: 'heritage-20', budget_type: 'SkuPricing',
        budget_product_skus: ['actions_linux', 'actions_windows'],
        budget_scope: 'repository', budget_entity_name: 'heritage-virginia/website',
        budget_amount: 20, prevent_further_usage: true,
        budget_alerting: { will_alert: true, alert_recipients: ['billing-manager'] },
      }], has_next_page: true, total_count: 2 }))
      .mockResolvedValueOnce(jsonResponse({ budgets: [{
        id: 'copilot-org', budget_type: 'ProductPricing',
        budget_product_skus: ['copilot_premium_request', 'copilot_ai_credit'],
        budget_scope: 'organization', budget_entity_name: 'heritage-virginia',
        budget_amount: 100, prevent_further_usage: false,
        budget_alerting: { will_alert: false, alert_recipients: [] },
      }, {
        id: 'copilot-user', budget_type: 'BundlePricing',
        budget_product_skus: ['ai_credits'], budget_scope: 'user',
        budget_entity_name: '', user: 'octocat', budget_amount: 30,
        prevent_further_usage: true,
        budget_alerting: { will_alert: false, alert_recipients: [] },
      }, {
        id: 'license-budget', budget_type: 'ProductPricing',
        budget_product_skus: ['future_license_product'], budget_scope: 'organization',
        budget_amount: 12, prevent_further_usage: false,
        budget_alerting: { will_alert: false, alert_recipients: [] },
      }, {
        id: 'copilot-all-users', budget_type: 'ProductPricing',
        budget_product_skus: ['premium_requests'], budget_scope: 'multi_user_customer',
        budget_amount: 75, prevent_further_usage: true,
        budget_alerting: { will_alert: false, alert_recipients: [] },
      }], has_next_page: false, total_count: 5 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listOrganizationBudgets('token', 'heritage-virginia');

    expect(result.state).toBe('available');
    expect(result.data?.subrequestsUsed).toBe(2);
    expect(result.data?.items).toEqual([
      expect.objectContaining({
        externalId: 'heritage-20', product: 'Actions',
        productSkus: ['actions_linux', 'actions_windows'], scopeType: 'repository',
        repositoryFullName: 'heritage-virginia/website', amount: 20,
        alertEnabled: true, alertRecipients: ['billing-manager'], preventFurtherUsage: true,
      }),
      expect.objectContaining({
        externalId: 'copilot-org', product: 'Copilot', scopeType: 'organization',
        organizationName: 'heritage-virginia', alertEnabled: false,
      }),
      expect.objectContaining({
        externalId: 'copilot-user', product: 'Copilot', scopeType: 'user',
        scopeEntityName: 'octocat', userLogin: 'octocat', unit: 'USD',
      }),
      expect.objectContaining({
        externalId: 'license-budget', scopeType: 'organization', unit: undefined,
      }),
      expect.objectContaining({
        externalId: 'copilot-all-users', product: 'Copilot',
        scopeType: 'multi_user_customer', amount: 75, unit: 'USD',
      }),
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/organizations/heritage-virginia/');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['x-github-api-version']).toBe(GITHUB_BILLING_API_VERSION);
  });

  it('rejects malformed budget records instead of persisting partial data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      budgets: [{ id: 'broken', budget_product_skus: 'actions' }], has_next_page: false,
    })));
    const result = await listOrganizationBudgets('token', 'acme');
    expect(result.state).toBe('error');
    expect(result.data?.items).toEqual([]);
  });

  it.each([
    [403, 'not_authorized'],
    [404, 'unsupported_by_plan'],
  ])('reports budget HTTP %s as %s', async (status, expectedState) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'unavailable' }, status)));
    const result = await listOrganizationBudgets('token', 'acme');
    expect(result.state).toBe(expectedState);
    expect(result.data?.items).toEqual([]);
  });

  it.each([
    [403, 'not_authorized'],
    [404, 'unsupported_by_plan'],
  ])('reports usage HTTP %s as %s', async (status, expectedState) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'unavailable' }, status)));
    const result = await listOrganizationUsage('token', 'acme', { year: 2026, month: 9 });
    expect(result.state).toBe(expectedState);
    expect(result.data?.items).toEqual([]);
  });

  it('retains repository attribution, unknown SKUs, and gross/discount/net usage', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ usageItems: [{
        date: '2026-09-01', product: 'Future Product', sku: 'unknown_new_sku',
        quantity: 10, unitType: 'widgets', pricePerUnit: 2,
        grossAmount: 20, discountAmount: 5, netAmount: 15,
        organizationName: 'acme', repositoryName: 'acme/repo',
      }] }))
      .mockResolvedValueOnce(jsonResponse({ usageItems: [{
        product: 'Copilot', sku: 'Copilot AI Credits', model: 'GPT-5',
        unitType: 'credits', grossQuantity: 100, discountQuantity: 25,
        netQuantity: 75, grossAmount: 1, discountAmount: 0.25, netAmount: 0.75,
      }] }))
      .mockResolvedValueOnce(jsonResponse({ usageItems: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listOrganizationUsage('token', 'acme', { year: 2026, month: 9 });

    expect(result.state).toBe('available');
    expect(result.data?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: 'unknown_new_sku', repositoryFullName: 'acme/repo', netAmount: 15 }),
      expect.objectContaining({ sku: 'Copilot AI Credits', grossQuantity: 100, netQuantity: 75 }),
    ]));
  });

  it('collects every advertised usage page within the request allowance', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ usageItems: [{
        date: '2026-09-01', product: 'Actions', sku: 'Actions Linux',
        quantity: 10, unitType: 'minutes', repositoryName: 'acme/one',
      }], has_next_page: true }))
      .mockResolvedValueOnce(jsonResponse({ usageItems: [{
        date: '2026-09-01', product: 'Actions', sku: 'Actions Windows',
        quantity: 20, unitType: 'minutes', repositoryName: 'acme/two',
      }], has_next_page: false }))
      .mockResolvedValueOnce(jsonResponse({ usageItems: [] }))
      .mockResolvedValueOnce(jsonResponse({ usageItems: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listOrganizationUsage('token', 'acme', { year: 2026, month: 9 }, 4);

    expect(result.state).toBe('available');
    expect(result.data?.subrequestsUsed).toBe(4);
    expect(result.data?.items.map((item) => item.repositoryFullName)).toEqual(['acme/one', 'acme/two']);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('page=2');
  });

  it('rejects malformed usage rather than replacing a good period with incomplete rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ usageItems: [{
      product: 'Actions', sku: 'Actions Linux', quantity: '100', unitType: 'minutes',
    }] })));

    const result = await listOrganizationUsage('token', 'acme', { year: 2026, month: 9 });
    expect(result.state).toBe('error');
    expect(result.data?.items).toEqual([]);
  });
});
