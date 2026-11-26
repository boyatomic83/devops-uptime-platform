# DevOps Uptime Platform

A self-hosted **uptime monitor** built with **Express**, packaged with a full DevOps toolchain: containers, CI/CD, security scanning, Kubernetes, GitOps and observability.

```
                 ┌──────────────────────── GitHub Actions ─────────────────────────┐
   git push ───▶ │ lint · unit + Postgres tests · helm lint · terraform validate   │
                 │ IaC scan ─▶ build ─▶ Trivy ─▶ push + SBOM + provenance ─▶ Cosign │──▶ ghcr.io (signed)
                 │ kind e2e: 2 replicas, leader failover · Kyverno policy tests     │
                 └──────────────────────────────────────────────────────────────────┘
                                                   │
        Terraform (VPC + EKS) ──▶ Argo CD syncs deploy/helm ──▶ Kyverno admits only signed images
                                                   │
       ┌───────────────────────────────────────────▼────────────────────────────┐
       │  uptime-monitor (N replicas) ── leader election ──▶ Postgres           │
       │   only the leader runs checks; any replica serves the API              │
       └──────┬───────────────────────────┬──────────────────────────┬──────────┘
         /metrics                    JSON logs                  webhook on change
              ▼                           ▼                          ▼
        Prometheus ──▶ Alertmanager   Alloy ──▶ Loki           Slack / Discord
              └──────────▶ Grafana ◀──────────┘
```

## Quick start (GitHub Codespaces — nothing installed locally)

1. On GitHub: **Code → Codespaces → Create codespace on main**
2. In the Codespace terminal:

```bash
make up        # app + Prometheus + Grafana
```

Open the forwarded ports from the **PORTS** tab:

| Port | What to look at |
|---|---|
| **3000** | Status page: add a URL and watch it get checked |
| **3001** | Grafana: opens straight on the **Uptime Overview** dashboard (login `admin`/`admin` to edit) |
| **9090** | Prometheus: try the query `uptime_monitor_up`, or see **Status → Targets** and **Alerts** |
| **9093** | Alertmanager: alerts routed from Prometheus (e.g. `TargetDown` for the "broken" monitor after 1 min) |

Logs: in Grafana open **Explore → Loki** and run `{service="app"} | json`.

To get alerts on your phone, see [Notifications](#notifications-telegram-whatsapp-slackdiscord).

### Run on Kubernetes (kind inside the Codespace)

```bash
make kind-up
make kind-deploy
kubectl -n uptime port-forward svc/uptime-uptime-monitor 8080:80
```

### Scaling and leader election

With a database, run as many replicas as you like; exactly one is the leader and runs the checks:

```bash
kubectl -n uptime scale deploy/uptime-uptime-monitor --replicas=3
for p in $(kubectl -n uptime get pods -l app.kubernetes.io/name=uptime-monitor -o name); do
  kubectl -n uptime exec $p -- wget -qO- localhost:3000/api/whoami; echo
done
kubectl -n uptime delete pod <leader-pod>   # another replica takes over within ~5s
```

### Supply-chain checks

```bash
cosign verify ghcr.io/boyatomic83/uptime-monitor:latest \
  --certificate-identity https://github.com/boyatomic83/devops-uptime-platform/.github/workflows/ci.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
docker buildx imagetools inspect ghcr.io/boyatomic83/uptime-monitor:latest --format '{{ json .SBOM }}' | head
```

Admission policies (Kyverno ≥ 1.20 CEL policies: `ImageValidatingPolicy` + `ValidatingPolicy`): `kubectl apply -f deploy/policies/`

### Cloud: AWS EKS with Terraform

See [`infra/terraform/eks`](infra/terraform/eks/README.md). It creates a real cluster and **costs money**, so CI only validates it.

### GitOps with Argo CD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# (if you fork this repo, change the GitHub user in application.yaml and values.yaml)
kubectl apply -f deploy/argocd/application.yaml
```

## Notifications: Telegram, WhatsApp, Slack/Discord

Two kinds of alerts are sent to **every channel you configure**:
- **Instant:** the app notices a monitor flip UP ↔ DOWN.
- **Prometheus alerts** (`TargetDown`, `TargetSlow`, …) → Alertmanager → app → your channels.

```bash
cp .env.example .env      # .env is git-ignored: never commit tokens
```

**Telegram (recommended, free)**
1. In Telegram, message **@BotFather** → `/newbot` → copy the token into `TELEGRAM_BOT_TOKEN`.
2. Open your new bot and send it any message (e.g. `hi`).
3. Run `make telegram-chat-id` and copy the number into `TELEGRAM_CHAT_ID`.

**WhatsApp (via CallMeBot, free for personal use)**
Follow [CallMeBot's WhatsApp setup](https://www.callmebot.com/blog/free-api-whatsapp-messages/) to get an API key for your own number, then set `WHATSAPP_PHONE` (e.g. `+919876543210`) and `WHATSAPP_CALLMEBOT_APIKEY`. It is a third-party service: messages pass through their servers. For production, use the official WhatsApp Business Cloud API or Twilio.

Apply and test:
```bash
docker compose up -d      # recreates the app with the new settings
make test-alert           # sends "🔔 Test notification" to every channel
```

On Kubernetes: `kubectl -n uptime create secret generic uptime-notify --from-env-file=.env` and set `alertWebhookSecret=uptime-notify` in the Helm values.

## Configuration

| Env var | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MONITORS` | – | Seed monitors: `name=url[\|intervalSec],...` |
| `DEFAULT_INTERVAL_SEC` | `30` | Check interval |
| `CHECK_TIMEOUT_MS` | `5000` | Per-check timeout |
| `ALERT_WEBHOOK_URL` | – | Slack/Discord incoming webhook |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | – | Telegram bot notifications |
| `WHATSAPP_PHONE`, `WHATSAPP_CALLMEBOT_APIKEY` | – | WhatsApp notifications via CallMeBot |
| `ALERTMANAGER_WEBHOOK_TOKEN` | – | Shared secret Alertmanager uses to call `/api/alerts/alertmanager` (receiver disabled when unset) |
| `LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `DATABASE_URL` | – | Postgres connection string; without it monitors are kept in memory (single replica only) |
| `SYNC_INTERVAL_SEC` | `10` | How often the leader re-reads monitors created via other replicas |

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/healthz`, `/readyz` | Liveness / readiness (readiness also checks the database) |
| `GET` | `/api/whoami` | Which pod answered and whether it is the leader |
| `GET` | `/api/notifications` | Names of configured notification channels |
| `POST` | `/api/notifications/test` | Send a test message to every channel |
| `POST` | `/api/alerts/alertmanager` | Alertmanager webhook receiver (Bearer token required) |
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
deploy/helm/             Helm chart (app, optional Postgres, HPA, PDB, NetworkPolicies)
deploy/argocd/           Argo CD Application
deploy/policies/         Kyverno admission policies
infra/terraform/eks/     AWS VPC + EKS + Argo CD + Kyverno
monitoring/              Prometheus, Alertmanager, Loki, Alloy, Grafana provisioning & dashboard
.github/workflows/       CI/CD pipeline
.devcontainer/           GitHub Codespaces config
```

## Roadmap

- [x] Postgres persistence, leader election, HPA/PDB
- [x] Alertmanager, Loki + Alloy logs
- [x] SBOM, provenance, Cosign signing, Kyverno policies
- [x] Terraform for EKS
- [ ] Per-PR preview environments
- [ ] OpenTelemetry tracing (Tempo)
- [ ] SLOs with error budgets and burn-rate alerts
- [ ] Chaos experiments (pod/DB failure) with Chaos Mesh
