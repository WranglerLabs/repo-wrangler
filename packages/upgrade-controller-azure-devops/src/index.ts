import {
  UPGRADE_JOB_STATES,
  type UpgradeControllerEvidence,
  type UpgradeActor,
  type UpgradeControllerCapabilities,
  type UpgradeControllerReceipt,
  type UpgradeControllerRequest,
  type UpgradeControllerStatus,
  type UpgradeDeploymentController,
  type UpgradeJobState,
  type UpgradePreflightResult,
} from '@repo-wrangler/domain';
const AZURE_DEVOPS_RESOURCE = 'https://app.vssps.visualstudio.com';

export interface AccessToken {
  token: string;
  expiresAt: number;
}

export interface AccessTokenProvider {
  getToken(): Promise<AccessToken>;
}

export interface ManagedIdentityTokenOptions {
  identityEndpoint?: string;
  identityHeader?: string;
  clientId?: string;
  fetcher?: typeof fetch;
  now?: () => number;
}

/** Short-lived Microsoft Entra token; no PAT or client secret is stored. */
export class AzureDevOpsManagedIdentityTokenProvider implements AccessTokenProvider {
  private cached: AccessToken | null = null;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly options: ManagedIdentityTokenOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => Date.now() / 1000);
  }

  async getToken(): Promise<AccessToken> {
    if (this.cached && this.cached.expiresAt > this.now() + 60) return this.cached;
    const headers: Record<string, string> = {};
    let endpoint: URL;
    if (this.options.identityEndpoint && this.options.identityHeader) {
      endpoint = new URL(this.options.identityEndpoint);
      endpoint.searchParams.set('resource', AZURE_DEVOPS_RESOURCE);
      endpoint.searchParams.set('api-version', '2019-08-01');
      headers['X-IDENTITY-HEADER'] = this.options.identityHeader;
    } else {
      endpoint = new URL('http://169.254.169.254/metadata/identity/oauth2/token');
      endpoint.searchParams.set('resource', AZURE_DEVOPS_RESOURCE);
      endpoint.searchParams.set('api-version', '2018-02-01');
      headers.Metadata = 'true';
    }
    if (this.options.clientId) endpoint.searchParams.set('client_id', this.options.clientId);
    const response = await this.fetcher(endpoint, { headers });
    if (!response.ok) throw new Error(`Managed identity token request failed (${response.status}).`);
    const body = await response.json() as { access_token?: string; expires_on?: string | number };
    if (!body.access_token) throw new Error('Managed identity token response omitted access_token.');
    const expiresAt = body.expires_on ? Number(body.expires_on) : this.now() + 600;
    if (!Number.isFinite(expiresAt)) throw new Error('Managed identity token expiry is invalid.');
    this.cached = { token: body.access_token, expiresAt };
    return this.cached;
  }
}

export interface AzureDevOpsControllerOptions {
  organization: string;
  project: string;
  pipelineId: number;
  pipelineRef?: string;
  controllerVersion: string;
  expectedPipelineName?: string;
  tokenProvider: AccessTokenProvider;
  fetcher?: typeof fetch;
  now?: () => string;
  requestTimeoutMs?: number;
}

interface PipelineRun {
  id?: number;
  name?: string;
  state?: string;
  result?: string;
  createdDate?: string;
  url?: string;
}

interface TimelineRecord {
  type?: string;
  name?: string;
  identifier?: string;
  state?: string;
  result?: string;
  order?: number;
}

interface ControllerCheckpoint {
  schemaVersion: '1.0';
  pipelineId: number;
  runId: number;
  state: UpgradeJobState;
  observedAt: string;
  evidence: UpgradeControllerEvidence;
  safeErrorCode?: string;
  safeErrorDetail?: string;
}

const CHECKPOINT_PROPERTY = 'RepoWrangler.UpgradeCheckpoint';

function propertyString(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const container = (record.value ?? record.item) as Record<string, unknown> | undefined;
  const wrapped = container?.[key];
  if (typeof wrapped === 'string') return wrapped;
  if (wrapped && typeof wrapped === 'object') {
    const value = (wrapped as Record<string, unknown>).$value;
    if (typeof value === 'string') return value;
  }
  return undefined;
}

function parseCheckpoint(
  body: unknown,
  expectedPipelineId: number,
  expectedRunId: number,
): ControllerCheckpoint | undefined {
  const encoded = propertyString(body, CHECKPOINT_PROPERTY);
  if (!encoded || encoded.length > 64_000) return undefined;
  try {
    const value = JSON.parse(encoded) as Partial<ControllerCheckpoint>;
    if (value.schemaVersion !== '1.0'
      || value.pipelineId !== expectedPipelineId
      || value.runId !== expectedRunId
      || !value.state
      || !UPGRADE_JOB_STATES.includes(value.state)
      || typeof value.observedAt !== 'string'
      || !value.evidence
      || typeof value.evidence !== 'object') return undefined;
    return value as ControllerCheckpoint;
  } catch {
    return undefined;
  }
}

function validateOptions(options: AzureDevOpsControllerOptions): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.organization)) {
    throw new Error('Azure DevOps organization is invalid.');
  }
  if (!options.project.trim() || !Number.isInteger(options.pipelineId) || options.pipelineId < 1) {
    throw new Error('Azure DevOps project and pipeline ID are required.');
  }
}

function assertSafeTemplateParameter(name: string, value: string): void {
  if (!/^[A-Za-z0-9@._:+-]{1,200}$/.test(value)) {
    throw new Error(`Azure DevOps template parameter ${name} is invalid.`);
  }
}

function pipelineState(run: PipelineRun, records: TimelineRecord[]): UpgradeJobState {
  if (run.state === 'completed') {
    if (run.result === 'succeeded') return 'verifying';
    if (run.result === 'canceled') return 'canceled';
    return 'failed';
  }
  const active = records
    .filter((record) => record.type === 'Stage' && record.state === 'inProgress')
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0];
  const name = `${active?.identifier ?? ''} ${active?.name ?? ''}`.toLowerCase();
  if (name.includes('rollback')) return 'rolling_back';
  if (name.includes('verify') || name.includes('health')) return 'verifying';
  if (name.includes('deploy')) return 'deploying';
  if (name.includes('artifact') || name.includes('provenance') || name.includes('signature')) {
    return 'validating_artifact';
  }
  if (name.includes('backup') || name.includes('migration')) return 'backup';
  return run.state === 'inProgress' ? 'preflight' : 'accepted';
}

export class AzureDevOpsUpgradeController implements UpgradeDeploymentController {
  private readonly fetcher: typeof fetch;
  private readonly now: () => string;
  private readonly base: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: AzureDevOpsControllerOptions) {
    validateOptions(options);
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.base = `https://dev.azure.com/${options.organization}/${encodeURIComponent(options.project)}`;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    if (!Number.isInteger(this.requestTimeoutMs)
      || this.requestTimeoutMs < 1
      || this.requestTimeoutMs > 60_000) {
      throw new Error('Azure DevOps request timeout must be between 1 and 60000 milliseconds.');
    }
  }

  private async requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
    const access = await this.options.tokenProvider.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetcher(`${this.base}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${access.token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      });
      if (!response.ok) throw new Error(`Azure DevOps controller request failed (${response.status}).`);
      return response.status === 204 ? {} : response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Azure DevOps controller request timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async capabilities(): Promise<UpgradeControllerCapabilities> {
    try {
      const pipeline = await this.requestJson(
        `/_apis/pipelines/${this.options.pipelineId}?api-version=7.1`,
      ) as { name?: string };
      if (this.options.expectedPipelineName && pipeline.name !== this.options.expectedPipelineName) {
        return this.unavailable('The configured pipeline identity does not match the approved pipeline.');
      }
      return {
        controllerType: 'azure-devops',
        controllerVersion: this.options.controllerVersion,
        availability: 'available',
        operations: { preflight: true, request: true, status: true, cancel: true, rollback: true },
        detail: 'Private Azure DevOps deployment pipeline authenticated by managed identity.',
      };
    } catch (error) {
      return this.unavailable(error instanceof Error ? error.message : 'Controller unavailable.');
    }
  }

  private unavailable(detail: string): UpgradeControllerCapabilities {
    return {
      controllerType: 'azure-devops',
      controllerVersion: this.options.controllerVersion,
      availability: 'unavailable',
      operations: { preflight: false, request: false, status: false, cancel: false, rollback: false },
      detail,
    };
  }

  async preflight(request: UpgradeControllerRequest): Promise<UpgradePreflightResult> {
    const pipeline = await this.requestJson(
      `/_apis/pipelines/${this.options.pipelineId}?api-version=7.1`,
    ) as { name?: string };
    const preview = await this.requestJson(
      `/_apis/pipelines/${this.options.pipelineId}/runs?api-version=7.1`,
      // Preview the exact executable branch. `preflight` is an application
      // lifecycle state, not a pipeline operation accepted by the governed YAML.
      { method: 'POST', body: JSON.stringify(this.runBody(request, 'upgrade', true)) },
    ) as { finalYaml?: string };
    const identityMatches = !this.options.expectedPipelineName
      || pipeline.name === this.options.expectedPipelineName;
    const yamlValid = typeof preview.finalYaml === 'string' && preview.finalYaml.length > 0;
    return {
      ready: identityMatches && yamlValid,
      checks: [
        { id: 'approved_pipeline', status: identityMatches ? 'passed' : 'failed' },
        { id: 'pipeline_yaml_preview', status: yamlValid ? 'passed' : 'failed' },
      ],
      irreversibleChanges: [],
      checkedAt: this.now(),
    };
  }

  async request(request: UpgradeControllerRequest): Promise<UpgradeControllerReceipt> {
    const run = await this.requestJson(
      `/_apis/pipelines/${this.options.pipelineId}/runs?api-version=7.1`,
      { method: 'POST', body: JSON.stringify(this.runBody(request, 'upgrade', false)) },
    ) as PipelineRun;
    if (!run.id) throw new Error('Azure DevOps did not return a pipeline run ID.');
    return {
      controllerCorrelationId: String(run.id),
      acceptedAt: run.createdDate ?? this.now(),
      evidence: { pipelineId: this.options.pipelineId, runId: run.id, runUrl: run.url },
    };
  }

  private runBody(request: UpgradeControllerRequest, operation: string, previewRun: boolean) {
    for (const [name, value] of Object.entries({
      operation,
      correlationId: request.correlationId,
      idempotencyKey: request.idempotencyKey,
      deploymentTarget: request.deploymentTarget,
      sourceVersion: request.sourceVersion,
      sourceDigest: request.sourceDigest ?? '',
      targetVersion: request.targetVersion,
      targetDigest: request.targetDigest,
      rollbackVersion: request.rollbackVersion ?? '',
      rollbackDigest: request.rollbackDigest ?? '',
      actorId: request.actor.id,
    })) {
      if (value) assertSafeTemplateParameter(name, value);
    }
    return {
      previewRun,
      ...(this.options.pipelineRef ? {
        resources: { repositories: { self: { refName: this.options.pipelineRef } } },
      } : {}),
      templateParameters: {
        operation,
        correlationId: request.correlationId,
        idempotencyKey: request.idempotencyKey,
        deploymentTarget: request.deploymentTarget,
        sourceVersion: request.sourceVersion,
        sourceDigest: request.sourceDigest ?? '',
        targetVersion: request.targetVersion,
        targetDigest: request.targetDigest,
        rollbackVersion: request.rollbackVersion ?? '',
        rollbackDigest: request.rollbackDigest ?? '',
        actorId: request.actor.id,
      },
    };
  }

  async status(controllerCorrelationId: string): Promise<UpgradeControllerStatus> {
    if (!/^\d+$/.test(controllerCorrelationId)) throw new Error('Controller correlation ID is invalid.');
    const runId = Number(controllerCorrelationId);
    const [run, timeline, properties] = await Promise.all([
      this.requestJson(
        `/_apis/pipelines/${this.options.pipelineId}/runs/${controllerCorrelationId}?api-version=7.1`,
      ) as Promise<PipelineRun>,
      this.requestJson(
        `/_apis/build/builds/${controllerCorrelationId}/timeline?api-version=7.1`,
      ) as Promise<{ records?: TimelineRecord[] }>,
      this.requestJson(
        `/_apis/build/builds/${controllerCorrelationId}/properties?filter=${encodeURIComponent(CHECKPOINT_PROPERTY)}&api-version=7.1`,
      ),
    ]);
    const checkpoint = parseCheckpoint(properties, this.options.pipelineId, runId);
    const state = checkpoint?.state ?? pipelineState(run, timeline.records ?? []);
    return {
      state, observedAt: checkpoint?.observedAt ?? this.now(),
      ...(checkpoint?.safeErrorCode ? {
        safeErrorCode: checkpoint.safeErrorCode,
        safeErrorDetail: checkpoint.safeErrorDetail,
      } : state === 'failed' ? {
        safeErrorCode: 'pipeline_failed',
        safeErrorDetail: 'The approved deployment pipeline failed.',
      } : {}),
      evidence: {
        pipelineId: this.options.pipelineId,
        runId,
        ...(checkpoint?.evidence ?? {}),
      },
    };
  }

  async cancel(
    controllerCorrelationId: string,
    _actor: UpgradeActor,
  ): Promise<UpgradeControllerReceipt> {
    if (!/^\d+$/.test(controllerCorrelationId)) throw new Error('Controller correlation ID is invalid.');
    await this.requestJson(
      `/_apis/build/builds/${controllerCorrelationId}?api-version=7.1`,
      { method: 'PATCH', body: JSON.stringify({ status: 'cancelling' }) },
    );
    return { controllerCorrelationId, acceptedAt: this.now(), evidence: { cancellationRequested: true } };
  }

  async rollback(
    controllerCorrelationId: string,
    actor: UpgradeActor,
  ): Promise<UpgradeControllerReceipt> {
    if (!/^\d+$/.test(controllerCorrelationId)) throw new Error('Controller correlation ID is invalid.');
    const run = await this.requestJson(
      `/_apis/pipelines/${this.options.pipelineId}/runs?api-version=7.1`,
      {
        method: 'POST',
        body: JSON.stringify({
          previewRun: false,
          ...(this.options.pipelineRef ? {
            resources: { repositories: { self: { refName: this.options.pipelineRef } } },
          } : {}),
          templateParameters: {
            operation: 'rollback', originalRunId: controllerCorrelationId, actorId: actor.id,
          },
        }),
      },
    ) as PipelineRun;
    if (!run.id) throw new Error('Azure DevOps did not return a rollback run ID.');
    return {
      controllerCorrelationId: String(run.id), acceptedAt: run.createdDate ?? this.now(),
      evidence: { originalRunId: Number(controllerCorrelationId), rollbackRunId: run.id },
    };
  }
}
