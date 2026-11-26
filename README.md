# DevOps Uptime Platform

A self-hosted **uptime monitor** built with **Express**, packaged with a full DevOps toolchain: containers, CI/CD, security scanning, Kubernetes, GitOps and observability.

```
            ┌──────────────── GitHub Actions ───────────────────┐
  push ───▶ │ lint/test → helm lint → docker build → Trivy scan │──▶ GHCR image
            │                         └──▶ kind cluster e2e     │
            └───────────────────────────────────────────────────┘
                                                   │
                       Argo CD (GitOps) ◀──────────┘  syncs deploy/helm
                                │
                    ┌───────────▼───────────┐   scrape   ┌────────────┐   ┌─────────┐
                    │ uptime-monitor (K8s)  │ ◀───────── │ Prometheus │──▶│ Grafana │
                    │  checks URLs, alerts  │  /metrics  └────────────┘   └─────────┘
                    └───────────┬───────────┘
                                ▼
                     Slack / Discord webhook
```

## Features

| Area | What's included |
|---|---|
| **App** | Express REST API + live status page, configurable HTTP checks, uptime %, latency history |
| **Alerting** | Slack/Discord webhook on state change; Prometheus alert rules |
| **Observability** | Prometheus metrics (`/metrics`), structured JSON logs, provisioned Grafana dashboard |
| **Containers** | Multi-stage, non-root Docker image with healthcheck and graceful shutdown |
| **CI/CD** | GitHub Actions: lint, test + coverage, Helm lint, build, Trivy scan (SARIF), push to GHCR, kind e2e |
| **Kubernetes** | Helm chart with probes, resource limits, hardened securityContext, NetworkPolicy, optional Ingress/ServiceMonitor |
| **GitOps** | Argo CD `Application` with automated sync & self-heal |
| **Dev env** | GitHub Codespaces devcontainer with Docker, kubectl, Helm and kind preinstalled |

## Quick start (GitHub Codespaces — nothing installed locally)

1. On GitHub: **Code → Codespaces → Create codespace on main**
2. In the Codespace terminal:

```bash
make up        # app + Prometheus + Grafana
```

Open the forwarded ports: **3000** (status page), **9090** (Prometheus), **3001** (Grafana, `admin`/`admin`).

### Run on Kubernetes (kind inside the Codespace)

```bash
make kind-up
make kind-deploy
kubectl -n uptime port-forward svc/uptime-uptime-monitor 8080:80
```

### GitOps with Argo CD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# (if you fork this repo, change the GitHub user in application.yaml and values.yaml)
kubectl apply -f deploy/argocd/application.yaml
```

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MONITORS` | – | Seed monitors: `name=url[\|intervalSec],...` |
| `DEFAULT_INTERVAL_SEC` | `30` | Check interval |
| `CHECK_TIMEOUT_MS` | `5000` | Per-check timeout |
| `ALERT_WEBHOOK_URL` | – | Slack/Discord incoming webhook |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz`, `/readyz` | Liveness / readiness |
| `GET` | `/metrics` | Prometheus metrics |
| `GET` | `/api/monitors` | List monitors |
| `POST` | `/api/monitors` | Create `{ "name", "url", "intervalSec"? }` |
| `GET` | `/api/monitors/:id` | Monitor details + recent checks |
| `POST` | `/api/monitors/:id/check` | Run a check now |
| `DELETE` | `/api/monitors/:id` | Remove a monitor |

```bash
curl -X POST localhost:3000/api/monitors -H 'content-type: application/json' \
  -d '{"name":"example","url":"https://example.com","intervalSec":15}'
```

## Repository layout

```
app/                     Express service (src/, tests, Dockerfile)
deploy/helm/             Helm chart
deploy/argocd/           Argo CD Application
monitoring/              Prometheus config + alert rules, Grafana provisioning & dashboard
.github/workflows/       CI/CD pipeline
.devcontainer/           GitHub Codespaces config
```

## Roadmap

- [ ] Terraform for a managed cluster (EKS/GKE) + remote state
- [ ] Persist monitors in Postgres/Redis (enables >1 replica + HPA)
- [ ] Loki for logs, Alertmanager routing
- [ ] Cosign image signing + Kyverno admission policy
- [ ] Per-PR preview environments
