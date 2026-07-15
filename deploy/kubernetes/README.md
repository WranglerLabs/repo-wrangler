# Kubernetes — self-hosted on any cluster

Run the whole product on Kubernetes (AKS, EKS, GKE, k3s, a home-lab cluster),
backed by SQLite on a PersistentVolumeClaim. Same `apps/server` container as
`docker compose up` — no Cloudflare, no external database required.

| | |
|---|---|
| **Topology** | Self-hosted (one container serves SPA + API) |
| **Cost tier** | Tier 2 with managed Postgres (multi-replica); Tier 0 single-node on PVC SQLite |
| **Storage** | PVC (`ReadWriteOnce`) mounted at `/app/data` |
| **Secrets** | Kubernetes `Secret` (or your external secrets operator) |
| **Replicas** | 1 (SQLite is single-writer; `Recreate` strategy) |

> Multi-replica horizontal scale needs a shared database — that's the Postgres
> adapter (roadmap PN-1). Until then, one replica owns the SQLite volume and the
> scheduler.

## 1. Build and push the image

No local Docker on the cluster is needed, but you do need the image in a registry
your cluster can pull. Any of:

```bash
# GitHub Container Registry
docker build -f apps/server/Dockerfile -t ghcr.io/OWNER/repo-wrangler-server:latest .
docker push ghcr.io/OWNER/repo-wrangler-server:latest

# …or build in the cloud with no local Docker (Azure):
az acr build -r <acr> -t repo-wrangler-server:latest -f apps/server/Dockerfile .
```

Set that image reference in `manifests.yaml` (or `chart/values.yaml`).

## 2. Deploy — demo mode

```bash
kubectl apply -f deploy/kubernetes/manifests.yaml
kubectl -n repo-wrangler rollout status deploy/repo-wrangler
kubectl -n repo-wrangler port-forward svc/repo-wrangler 8080:80   # http://localhost:8080
```

## 3. Real mode

1. Edit the `ConfigMap`: `DEMO_MODE: "false"`, set `ALLOWED_GITHUB_USERS` and
   `PUBLIC_BASE_URL`.
2. Fill the `Secret` with your GitHub App values (or manage it with
   Sealed Secrets / External Secrets / your vault operator — never commit real
   values).
3. Set a real `Ingress` host + TLS for your controller, then re-apply.
4. Point the GitHub App's OAuth callback and webhook at `PUBLIC_BASE_URL`.

## Helm

A templated chart is in [`chart/`](chart/):

```bash
helm install repo-wrangler deploy/kubernetes/chart \
  --namespace repo-wrangler --create-namespace \
  --set image.repository=ghcr.io/OWNER/repo-wrangler-server \
  --set image.tag=latest \
  --set ingress.host=repo-wrangler.example.com
```

Real mode: `--set demoMode=false --set config.allowedGithubUsers=<you>` and
supply secrets via `--set-file` / a values file / an external secrets operator.

## Validate

```bash
kubectl -n repo-wrangler exec deploy/repo-wrangler -- \
  wget -qO- http://localhost:8080/health/ready    # {"ok":true,"demoMode":...}
```

Migrations apply automatically at pod start; the PVC persists data across
rollouts.
