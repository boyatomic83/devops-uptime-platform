# DevOps Uptime Platform: Technical Guide

> A complete explanation of this project: what it does, how every part works, how code travels from a commit to a running, monitored, secured system, the problems we hit while building it, how we solved them, why we chose each tool, the trade-offs, and what you could use instead.
>
> Written to be readable for a beginner and still useful to an experienced engineer. Read top to bottom the first time; later, jump to a section.

---

## Table of contents

1. [The project in one minute](#1-the-project-in-one-minute)
2. [What is DevOps? (plain English)](#2-what-is-devops-plain-english)
3. [DevOps glossary: every term used in this project](#3-devops-glossary)
4. [The big picture: architecture](#4-the-big-picture-architecture)
5. [The life of a change: from commit to production](#5-the-life-of-a-change-from-commit-to-production)
6. [Component deep dives](#6-component-deep-dives)
   - 6.1 [The application (Express)](#61-the-application-express)
   - 6.2 [Storage, high availability and leader election](#62-storage-high-availability-and-leader-election)
   - 6.3 [Containers (Docker)](#63-containers-docker)
   - 6.4 [Local stack (Docker Compose)](#64-local-stack-docker-compose)
   - 6.5 [Observability: metrics, logs, dashboards](#65-observability-metrics-logs-dashboards)
   - 6.6 [Alerting and notifications (Telegram, WhatsApp, Slack/Discord)](#66-alerting-and-notifications)
   - 6.7 [CI/CD pipeline (GitHub Actions)](#67-cicd-pipeline-github-actions)
   - 6.8 [Supply-chain security](#68-supply-chain-security)
   - 6.9 [Kubernetes and Helm](#69-kubernetes-and-helm)
   - 6.10 [Admission policies (Kyverno)](#610-admission-policies-kyverno)
   - 6.11 [GitOps (Argo CD)](#611-gitops-argo-cd)
   - 6.12 [Infrastructure as Code (Terraform on AWS EKS)](#612-infrastructure-as-code-terraform-on-aws-eks)
   - 6.13 [Developer environment (Codespaces)](#613-developer-environment-codespaces)
7. [Problems we faced and how we solved them](#7-problems-we-faced-and-how-we-solved-them)
8. [Technology choices, trade-offs and alternatives](#8-technology-choices-trade-offs-and-alternatives)
9. [Security model](#9-security-model)
10. [Operating the system: runbook and cheat sheet](#10-operating-the-system)
11. [Known limitations and what to build next](#11-known-limitations-and-what-to-build-next)
12. [Interview prep: explaining this project](#12-interview-prep)

---

## 1. The project in one minute

**What it does:** an **uptime monitor**. You give it URLs (your website, an API, etc.). Every few seconds it sends an HTTP request to each one, records whether it answered correctly and how fast, shows a live status page, and **alerts you on Telegram, WhatsApp, Slack or Discord** when something goes down or comes back.

**Why it exists:** the app is deliberately simple. The real point is everything *around* it, the full set of practices a professional team uses to **build, test, secure, ship, run, observe and recover** software:

| Practice | In this project |
|---|---|
| Version control and automation | GitHub + GitHub Actions |
| Packaging | Docker image (small, non-root) |
| Testing | Unit tests, real-database integration tests, real-Kubernetes end-to-end tests |
| Security | Vulnerability scans, SBOM, provenance, image signing, admission policies |
| Deployment | Helm chart, Argo CD (GitOps) |
| Infrastructure | Terraform for AWS (VPC + EKS) |
| Reliability | Multiple replicas, leader election, automatic failover, health probes, PDB, autoscaling |
| Observability | Prometheus metrics, Loki logs, Grafana dashboards |
| Incident response | Alert rules, Alertmanager, notifications on your phone |

---

## 2. What is DevOps? (plain English)

Historically, **developers** wrote code and threw it "over the wall" to **operations**, who had to run it. Developers wanted to change things quickly; operations wanted stability. Releases were rare, manual, scary, and broke often.

**DevOps** is the culture and set of practices that merges those roles around one goal: **ship changes quickly *and* safely.** It rests on a few ideas:

1. **Automate everything repeatable.** Builds, tests, deployments, infrastructure creation. Humans make mistakes on step 37 of a 40-step checklist; scripts don't.
2. **Everything as code.** The app, the infrastructure (Terraform), the deployment (Helm), the dashboards (Grafana JSON), the alert rules, the security policies, even the developer laptop (devcontainer). If it's code, it's reviewed, versioned, reproducible and can be rolled back.
3. **Small, frequent changes.** A 10-line change is easy to test and easy to undo. A 10,000-line release is not.
4. **Fast feedback.** CI tells you within minutes if you broke something. Monitoring tells you within a minute if production broke.
5. **You build it, you run it.** The team that writes the code also watches its dashboards and gets its alerts.
6. **Security is built in, not bolted on** ("DevSecOps"). Scanning and policy checks run automatically on every change.
7. **Design for failure.** Servers die. Networks blip. Instead of hoping nothing breaks, design so that when it breaks, the system heals itself (replicas, probes, failover).

The usual way to picture DevOps is an infinite loop:

```
   PLAN → CODE → BUILD → TEST → RELEASE → DEPLOY → OPERATE → MONITOR
     ↑                                                           │
     └──────────────────── feedback ─────────────────────────────┘
```

Every folder in this repository maps onto a stage of that loop.

---

## 3. DevOps glossary

Grouped by topic. Each term is explained the way it is used in *this* project.

### Source and automation
| Term | Meaning |
|---|---|
| **Git / repository** | Version control. Every change is a *commit* with an author, message and diff. The repo is the single source of truth. |
| **Branch / main** | `main` is the deployable branch. CI publishes images only from `main`. |
| **CI (Continuous Integration)** | Automatically building and testing every change, so broken code is caught in minutes, not weeks. |
| **CD (Continuous Delivery / Deployment)** | Automatically producing a release-ready artifact (Delivery) and optionally deploying it (Deployment). Here CI produces a signed image; Argo CD deploys whatever Git says. |
| **Pipeline / workflow / job / step** | GitHub Actions vocabulary. A *workflow* (`ci.yml`) has *jobs* (run in parallel on fresh VMs unless they depend on each other via `needs`), which have *steps* (commands or reusable *actions*). |
| **Runner** | The temporary VM that executes a job. Destroyed afterwards, so every run starts clean. |
| **Artifact** | A build output: here the container image and the coverage report. |
| **Dependabot** | A GitHub bot that opens pull requests to update dependencies (npm, Docker base image, Actions, Terraform providers). |

### Packaging and runtime
| Term | Meaning |
|---|---|
| **Container** | A process running with its own isolated filesystem, network and process view. Lighter than a VM: it shares the host kernel. |
| **Image** | The read-only template a container starts from (OS libraries + Node + your code). Built from a **Dockerfile**. |
| **Layer** | Each Dockerfile instruction creates a cached layer. Ordering instructions well = faster rebuilds. |
| **Multi-stage build** | Using one stage to install/build, then copying only the needed files into a clean final stage. Smaller, safer images. |
| **Registry** | Where images are stored. We use **GHCR** (GitHub Container Registry): `ghcr.io/boyatomic83/uptime-monitor`. |
| **Tag vs digest** | A *tag* (`latest`, `1a8d82f`) is a movable name. A *digest* (`sha256:c4dd…`) is the content hash and can never change. Production should pin digests. |
| **PID 1** | The first process in a container. It receives the stop signal (`SIGTERM`) and has special signal semantics (explained in §7). |
| **Graceful shutdown** | On `SIGTERM`, stop accepting new work, finish in-flight work, release resources (e.g. the leader lock), then exit. |
| **12-factor app** | A set of principles for cloud apps; the key one here: **configuration via environment variables**, so one image runs in every environment. |

### Kubernetes
| Term | Meaning |
|---|---|
| **Kubernetes (K8s)** | A system that runs containers across many machines and keeps them in the *desired state* you declare ("I want 2 copies of this, always"). |
| **Cluster / node** | A cluster is a set of machines (*nodes*) managed by a *control plane*. |
| **Pod** | The smallest unit K8s runs: one or more containers sharing a network address. |
| **Deployment** | Manages identical, stateless pods: rolling updates, self-healing, scaling. Our app. |
| **StatefulSet** | Like a Deployment but for stateful apps: stable name and its own persistent disk. Our bundled Postgres. |
| **Service** | A stable virtual IP + DNS name that load-balances to matching pods (`uptime-uptime-monitor.uptime.svc`). |
| **Ingress** | HTTP routing from outside the cluster to Services (optional in our chart). |
| **ConfigMap / Secret** | Key-value configuration injected into pods. Secrets hold sensitive values (DB password). |
| **PersistentVolumeClaim (PVC)** | A request for a disk that survives pod restarts. |
| **Probe (liveness / readiness)** | Health checks K8s calls. *Liveness* fails → restart the container. *Readiness* fails → stop sending it traffic. |
| **Rolling update** | Replace pods gradually so the service never goes fully down. We set `maxUnavailable: 0`. |
| **HPA (HorizontalPodAutoscaler)** | Adds/removes pods based on CPU (or other metrics). |
| **PDB (PodDisruptionBudget)** | "Never voluntarily take me below N pods", which protects availability during node maintenance. |
| **NetworkPolicy** | A firewall between pods. Ours: only the app may talk to Postgres. |
| **securityContext** | Linux-level hardening for a container: non-root, read-only filesystem, dropped capabilities. |
| **Admission controller / webhook** | Code that inspects every object *before* K8s stores it and can reject or modify it. Kyverno is one. |
| **Namespace** | A folder for K8s objects (`uptime`, `argocd`, `kyverno`). |
| **kind** | "Kubernetes IN Docker": a real cluster whose nodes are containers. Perfect for CI. |
| **Helm / chart / release / values** | Helm is a package manager for K8s. A *chart* is templated YAML; *values* fill the templates; an installed chart is a *release*. |

### Delivery and infrastructure
| Term | Meaning |
|---|---|
| **GitOps** | Git is the source of truth for what runs in the cluster. An agent (Argo CD) continuously makes the cluster match Git. No one runs `kubectl apply` by hand. |
| **Drift / self-heal** | *Drift* is when the live state differs from Git (someone edited something manually). *Self-heal* reverts it. |
| **Infrastructure as Code (IaC)** | Declaring servers, networks and clusters in code (Terraform) instead of clicking in a console. |
| **Terraform state** | Terraform's record of what it created. Must be stored safely (S3) and *locked* so two people don't apply at once. |
| **Plan / apply / destroy** | Terraform shows the diff (*plan*), makes it real (*apply*), or tears it down (*destroy*). |
| **VPC / subnet / NAT gateway** | AWS private network; subnets are slices of it in each availability zone; a NAT gateway lets private machines reach the internet without being reachable from it. |
| **EKS** | Amazon's managed Kubernetes control plane. |
| **Spot instances** | Spare AWS capacity at up to ~70–90% discount that AWS can reclaim with 2 minutes' notice. Fine for replicated stateless workloads. |

### Observability and reliability
| Term | Meaning |
|---|---|
| **Monitoring vs observability** | Monitoring answers known questions ("is it up?"). Observability lets you ask *new* questions from the data (metrics, logs, traces). |
| **Metric** | A number over time: `uptime_monitor_up{monitor="github"} = 1`. Cheap to store and query. |
| **Label** | A key/value dimension on a metric or log stream (`monitor="github"`). |
| **Counter / Gauge / Histogram** | Counter only goes up (total checks). Gauge goes up and down (is it up: 0/1). Histogram counts values in buckets (latency) to compute percentiles. |
| **Scrape (pull model)** | Prometheus *pulls* `/metrics` from each target every 15s, rather than apps *pushing*. |
| **PromQL** | Prometheus query language, e.g. `avg_over_time(uptime_monitor_up[1h])`. |
| **p95 latency** | 95% of requests were faster than this. Better than averages, which hide slow outliers. |
| **Structured logging** | Logs as JSON objects, not free text, so tools can filter by field (`level`, `monitor`). |
| **Log aggregation** | Collecting logs from all containers into one searchable place (Loki). |
| **Alert rule** | A PromQL condition + duration: `uptime_monitor_up == 0 for 1m`. |
| **Pending vs firing** | A rule that is true but hasn't lasted its `for:` duration yet is *pending*; after that it is *firing*. Prevents alerts on 5-second blips. |
| **Grouping / inhibition / silence** | Alertmanager features: bundle related alerts into one message; suppress symptoms when the root cause is already alerting; mute alerts during planned maintenance. |
| **SLI / SLO / error budget** | Indicator (e.g. % successful checks), objective (99.9%), and how much failure you can "spend" before freezing releases. (Next step for this project.) |
| **High availability (HA)** | No single failure takes the service down. |
| **Leader election** | Among N identical replicas, exactly one is chosen to do a job that must not run twice. |
| **Failover** | When the leader dies, another takes over automatically. |
| **Idempotent** | Doing it twice has the same effect as once (e.g. seeding monitors, applying Terraform). |
| **Reconciliation loop** | Repeatedly compare *desired* vs *actual* state and fix the difference. Kubernetes, Argo CD and our scheduler's `sync()` all work this way. |

### Security (DevSecOps)
| Term | Meaning |
|---|---|
| **CVE** | A publicly known vulnerability with an ID. Trivy checks the image's packages against CVE databases. |
| **SAST / IaC scanning** | Static analysis of code / infrastructure configs for mistakes (we use Trivy's config scanner). |
| **SARIF** | A standard format for scan results; GitHub shows them in the **Security** tab. |
| **Supply chain attack** | Compromising something you *depend on* (a library, a base image, a CI action) instead of your code. |
| **SBOM (Software Bill of Materials)** | An ingredient list of every package inside the image. When the next big CVE hits, you can answer "are we affected?" in seconds. |
| **Provenance (SLSA)** | A signed record of *how* the artifact was built: which repo, commit, workflow, builder. |
| **Image signing (Cosign / Sigstore)** | Cryptographic proof that the image came from our CI and wasn't modified. |
| **Keyless signing / OIDC** | CI proves its identity to Sigstore using GitHub's short-lived OIDC token; Sigstore issues a 10-minute certificate; the signature is recorded in a public transparency log (Rekor). No private key exists to leak. |
| **Pinning by SHA** | Referencing a dependency (e.g. a GitHub Action) by its immutable commit hash instead of a movable tag. |
| **Least privilege** | Give every component only the permissions it needs (non-root, dropped capabilities, scoped CI permissions, NetworkPolicies). |
| **Policy as code** | Security rules written as code and enforced automatically (Kyverno policies). |

---

## 4. The big picture: architecture

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
         /metrics                    JSON logs               state-change alerts
              ▼                           ▼                          │
        Prometheus ──▶ Alertmanager ──────┼──── webhook ──────▶ app notifier ──▶ Telegram / WhatsApp / Slack / Discord
              │                    Alloy ──▶ Loki
              └──────────▶ Grafana ◀──────┘
```

### Repository map

```
app/                         The Express service
  src/server.js              Startup wiring, leader election, graceful shutdown
  src/app.js                 HTTP routes (API, health, metrics, notifications)
  src/scheduler.js           Runs checks on timers; reconciles with the store
  src/checker.js             Performs one HTTP check
  src/store-memory.js        In-memory storage (single replica)
  src/store-postgres.js      Postgres storage (multi-replica)
  src/leader.js              Leader election via Postgres advisory lock
  src/alerter.js             Builds state-change messages
  src/notifiers.js           Telegram / WhatsApp / webhook channels + Alertmanager formatting
  src/metrics.js             Prometheus metric definitions
  src/logger.js, config.js   JSON logs; env-var configuration
  public/index.html          Status page
  test/                      Unit, API and Postgres integration tests
  Dockerfile                 Multi-stage, non-root image
docker-compose.yml           Local stack: app, Postgres, Prometheus, Alertmanager, Loki, Alloy, Grafana
monitoring/                  Prometheus rules, Alertmanager routing, Loki/Alloy config, Grafana dashboards
deploy/helm/uptime-monitor/  Helm chart (app, Postgres, HPA, PDB, NetworkPolicies, ...)
deploy/argocd/               Argo CD Application (GitOps)
deploy/policies/             Kyverno admission policies
infra/terraform/eks/         AWS VPC + EKS + Argo CD + Kyverno
.github/workflows/ci.yml     The CI/CD pipeline (7 jobs)
.github/dependabot.yml       Automated dependency updates
.devcontainer/               GitHub Codespaces definition
scripts/                     Helper scripts (Telegram chat id)
Makefile                     Short commands: make up, make test-alert, make kind-deploy, ...
.env.example                 Template for your private notification settings
```

### Ports (local stack)

| Port | Service | What you do there |
|---|---|---|
| 3000 | App | Status page, REST API, `/metrics` |
| 3001 | Grafana | Dashboards and log search (Explore → Loki) |
| 9090 | Prometheus | Raw metrics, PromQL, alert states, scrape targets |
| 9093 | Alertmanager | Active/silenced/inhibited alerts, create silences |
| 3100 | Loki | Log storage API (query it through Grafana) |
| 12345 | Alloy | Log shipper's debug UI |
| 5432 | Postgres | Database (internal only) |

---

## 5. The life of a change: from commit to production

This is the most important section for understanding "how the process moves". Follow one change, say you edit `checker.js`:

### Step 1: Develop (Codespaces)
You open the repo in a Codespace. The `.devcontainer` gives everyone an identical machine with Node, Docker, kubectl, Helm and kind. `make up` runs the whole stack; `make test` runs lint and tests. *No "works on my machine".*

### Step 2: Commit and push
`git push` to GitHub. This triggers `.github/workflows/ci.yml`.

### Step 3: CI, the quality gates (in parallel)
| Job | What it proves |
|---|---|
| **Lint & test** | Code style is clean; 42 tests pass, including integration tests against a **real Postgres** service container (CRUD, failover between two "replicas", migrations). |
| **Helm lint** | The chart is valid in every supported mode (memory, bundled DB, external DB + autoscaling) and **refuses** the unsafe mode (several replicas without a DB). |
| **Terraform validate** | Infrastructure code is formatted and valid (never applied: that costs money). |
| **IaC scan** | Trivy scans Terraform, Helm, Dockerfile for misconfigurations → GitHub Security tab. |

### Step 4: Build, scan, publish, sign
The **image** job (only if the above pass):
1. Builds the image with Docker Buildx (layer cache in GitHub Actions cache).
2. **Trivy** scans it. Results go to the Security tab; **CRITICAL** fixable CVEs fail the build.
3. Pushes to GHCR tagged with the short commit SHA (and `latest` on main), **with an SBOM and SLSA provenance attached**.
4. **Cosign** signs the image digest *keylessly* using GitHub's OIDC identity, then verifies the signature against this exact repo + workflow.

### Step 5: Prove it really runs on Kubernetes
- **e2e job:** creates a throwaway **kind** cluster, installs the Helm chart (2 app replicas + Postgres), smoke-tests the API and metrics, checks that **exactly one replica is the leader**, deletes the leader pod, and verifies **another replica takes over**.
- **policy job:** creates another kind cluster, installs **Kyverno**, applies our policies, deploys the **signed** image (admitted and pinned to its digest), then proves that an unsigned image, a privileged pod, a root pod and a pod without limits are each **rejected for the right reason**.

### Step 6: Deploy (GitOps)
In a real cluster (e.g. the EKS one from Terraform), **Argo CD** watches the repo. When `deploy/helm` changes on `main`, it syncs the cluster to match. If someone edits the cluster by hand, Argo CD reverts it (*self-heal*). **Kyverno** checks every pod as it is created: only images signed by our CI may run.

### Step 7: Operate and observe
- **Prometheus** scrapes `/metrics` every 15s.
- **Alloy** ships every container's JSON logs to **Loki**.
- **Grafana** shows targets up/down, uptime %, latency p95, leader count, firing alerts, and live logs on one dashboard.

### Step 8: Respond
- A target goes down → the app notices on the next check and **immediately** sends "🔴 X is DOWN" to every configured channel.
- If it stays down for 1 minute, Prometheus fires `TargetDown` → Alertmanager groups it → forwards to the app → "🔴 FIRING" on Telegram/WhatsApp. When it recovers → "✅ RESOLVED".
- If the monitor app *itself* dies, `UptimeMonitorAppDown` fires and the per-target alerts are *inhibited*, so you get one useful alert instead of fifty.

### Step 9: Feedback
Dependabot opens update PRs weekly; every PR goes through the same pipeline. The loop continues.

---

## 6. Component deep dives

### 6.1 The application (Express)

**Request flow:** HTTP request → metrics middleware (starts a latency timer) → JSON body parser (10 KB limit; 256 KB only for the Alertmanager endpoint) → route handler → error handler (turns exceptions into clean 400/500 JSON, never a crash).

**Main endpoints**

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Liveness: "the process is alive". Deliberately trivial so a slow DB doesn't get the pod killed. |
| `GET /readyz` | Readiness: also pings the database. If the DB is down, K8s stops routing traffic here (but does not restart it). |
| `GET /metrics` | Prometheus metrics. |
| `GET/POST/DELETE /api/monitors[/:id]` | Manage monitors. Input is validated: name ≤ 100 chars, http(s) URLs only, interval 5–3600 s. |
| `POST /api/monitors/:id/check` | Run a check now. |
| `GET /api/whoami` | Which pod answered and whether it is the leader (used by the failover test). |
| `GET /api/notifications`, `POST /api/notifications/test` | Show configured channels (names only, never secrets); send a test message. |
| `POST /api/alerts/alertmanager` | Receives Alertmanager webhooks (Bearer token required). |

**How a check works (`checker.js`):** `GET` the URL with redirects followed and an `AbortSignal.timeout` (default 5 s). The target is **UP if it answers with status < 400** within the timeout; otherwise DOWN with the error (`timeout after 5000ms`, `fetch failed`, …). Latency is measured with `performance.now()`.

**The scheduler (`scheduler.js`):** one `setInterval` per monitor. After each check it saves the result, updates metrics, and if the state *changed* (UP↔DOWN, not the first check) calls the alerter. Its `sync()` method is a **reconciliation loop**: read all monitors from the store, start timers for new ones, stop timers for deleted ones. Timers are `unref()`'d so they never keep the process alive during shutdown.

**Metrics exposed**

| Metric | Type | Meaning |
|---|---|---|
| `uptime_monitor_up{monitor,url}` | Gauge | 1 = up, 0 = down |
| `uptime_check_duration_seconds` | Histogram | Check latency (for p95) |
| `uptime_checks_total{monitor,result}` | Counter | Number of checks, by result |
| `uptime_scheduler_leader` | Gauge | 1 on the leader replica |
| `http_request_duration_seconds{method,route,status}` | Histogram | The app's own API latency |
| `process_*`, `nodejs_*` | Various | CPU, memory, event-loop lag (default metrics) |

**Logs:** one JSON object per line: `{"time":…,"level":"warn","msg":"monitor state changed","monitor":"api","from":"up","to":"down"}`. JSON because Loki/Grafana can filter by any field.

**Configuration:** only environment variables (`PORT`, `MONITORS`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, …). The same image runs locally, in CI, and in production. Only the environment differs (12-factor).

**Graceful shutdown:** on `SIGTERM` the app marks itself not-ready, stops the scheduler, **releases the leader lock** (so another replica takes over immediately instead of waiting), lets in-flight HTTP requests finish, closes the DB pool, and exits. A 10 s safety timer forces exit if something hangs.

### 6.2 Storage, high availability and leader election

**The problem.** Version 1 kept monitors in memory. That meant: data lost on restart, and **only one replica possible**. Two replicas would each have different data, and if they shared data, **both would check every URL and send every alert twice.**

**Step 1: a shared store.** Both stores implement the same async interface (`add / get / list / remove / recordResult / ping / close`), so the rest of the app doesn't care which one is used. `DATABASE_URL` set → Postgres, otherwise memory.

Postgres schema:
```sql
monitors(id uuid PK, name, url, interval_sec, created_at)
checks(id bigserial PK, monitor_id → monitors ON DELETE CASCADE,
       up, status_code, latency_ms, error, checked_at)
INDEX checks(monitor_id, checked_at DESC)
```
- Status, last latency and last error are **derived from the latest check**, so there is one source of truth and no fields to keep in sync.
- Uptime % = share of successful checks among the last 100. The page shows the last 20.
- Retention: only the newest 1000 checks per monitor are kept, so the table can't grow forever.
- Migrations run at startup inside `pg_advisory_lock(7400001)`, so replicas starting simultaneously don't race to create tables.

**Step 2: leader election.** We need *exactly one* replica running checks. We use a **Postgres session-level advisory lock** (`pg_try_advisory_lock(7400002)`) on a dedicated connection:

```
Replica A: try lock → TRUE  → I am leader → start all check timers
Replica B: try lock → FALSE → standby (serves API only), retries every 5 s
Replica A dies → its DB connection closes → Postgres releases the lock automatically
Replica B: try lock → TRUE  → becomes leader within ~5 s
```

Why this works so well: the lock's lifetime is tied to the **database connection**, so a crashed pod can never hold it forever. There is no TTL tuning and no extra infrastructure, because we already have Postgres.

**Step 3: reconciliation.** A monitor created through replica B (standby) is written to Postgres, but the *leader's* timers live in A's memory. So every replica runs `scheduler.sync()` every 10 s (`SYNC_INTERVAL_SEC`). On the leader it starts timers for any new monitors; on standbys it's a no-op. Creating a monitor also calls `sync()` immediately on the replica that received it.

**Verified:** locally (two processes, kill -9 the leader, the other takes over) and in CI on a real Kubernetes cluster.

### 6.3 Containers (Docker)

```dockerfile
FROM node:22-alpine AS deps          # stage 1: install production deps only
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=npm_ca,required=false ... npm ci --omit=dev

FROM node:22-alpine AS runtime       # stage 2: clean image, just what runs
COPY --from=deps /app/node_modules ./node_modules
COPY src public package.json ./
USER node                            # non-root
HEALTHCHECK ... wget /healthz
CMD ["node", "src/server.js"]
```

Design points:
- **Multi-stage**: no npm cache, no dev dependencies, no tests in the final image → smaller attack surface (~250 MB, mostly Node itself).
- **`npm ci`**: installs exactly what `package-lock.json` says. Reproducible.
- **Copy `package*.json` before source**: the dependency layer is cached; editing code doesn't reinstall packages.
- **Non-root `USER node`**: if the app were compromised, the attacker isn't root.
- **`.dockerignore`**: keeps `node_modules`, tests, `.env` out of the build context (and so out of the image).
- **Optional CA secret mount**: lets builds work behind TLS-intercepting corporate proxies without baking the certificate into the image (see §7).

### 6.4 Local stack (Docker Compose)

`docker compose up` (or `make up`) starts 7 containers on one private network, where they reach each other by service name (`postgres:5432`, `app:3000`, …):

| Service | Role | Notes |
|---|---|---|
| app | The monitor | `depends_on: postgres (healthy)`, so it waits for the DB healthcheck |
| postgres | Storage | Named volume `pgdata`, so data survives `docker compose down` |
| prometheus | Metrics + alert rules | `--web.enable-lifecycle` so `make reload` applies config without restart |
| alertmanager | Alert routing | Entry-point script injects the webhook token at start |
| loki | Log storage | 7-day retention, volume `lokidata` |
| alloy | Log shipper | Reads the Docker socket (read-only) to discover containers |
| grafana | Dashboards | Datasources and dashboard **provisioned from files**; opens on the Uptime dashboard |

Secrets come from a git-ignored `.env` file, which Compose reads automatically.

### 6.5 Observability: metrics, logs, dashboards

**Metrics (Prometheus).** Prometheus *pulls* `/metrics` from the app every 15 s and stores time series. It evaluates alert rules every 15 s:

| Alert | Condition | Severity |
|---|---|---|
| `TargetDown` | `uptime_monitor_up == 0` for 1 minute | critical |
| `TargetSlow` | p95 check latency > 2 s for 5 minutes | warning |
| `UptimeMonitorAppDown` | Prometheus can't scrape the app for 1 minute | critical |

Useful PromQL to try:
```promql
uptime_monitor_up                                          # current state of every target
avg_over_time(uptime_monitor_up[1h])                       # uptime ratio over the last hour
histogram_quantile(0.95, sum by (le, monitor)
  (rate(uptime_check_duration_seconds_bucket[5m])))        # p95 latency per target
sum(uptime_scheduler_leader)                               # must always be exactly 1
ALERTS{alertstate="firing"}                                # what is firing now
```

**Logs (Alloy → Loki).** Alloy discovers the Compose containers via the Docker API, labels each stream with `service` and `container`, parses the app's JSON to promote `level` to a label, and pushes to Loki. Loki indexes **only labels**, not full text, which is why it's cheap. Try in Grafana → Explore:
```logql
{service="app"} | json | level="warn"
sum by (level) (count_over_time({service="app"}[5m]))
```

**Dashboards (Grafana).** The "Uptime Overview" dashboard is a JSON file in Git, loaded at startup (*provisioning*). Panels: targets up/down, uptime % per target, status timeline, latency p95, app request rate, leader replicas, firing alerts, log volume by level, live app logs. Because it's code, it's reviewed and versioned like everything else.

### 6.6 Alerting and notifications

There are **two alert paths**, on purpose:

```
Path 1 (instant):  check result flips UP↔DOWN ─▶ alerter ─▶ notifier ─▶ all channels
Path 2 (durable):  Prometheus rule fires (≥1 min) ─▶ Alertmanager (group, inhibit, silence)
                   ─▶ POST /api/alerts/alertmanager (Bearer token) ─▶ notifier ─▶ all channels
```

- Path 1 is fast but lives in the app, so if the app dies, it can't tell you.
- Path 2 lives **outside** the app, so it also catches "the monitor itself is dead", and it adds grouping, de-duplication, repeat reminders (every 4 h), resolved messages and silences.

**Notifier (`notifiers.js`)** has pluggable channels, each enabled only if its env vars are set:

| Channel | How it sends | Env vars |
|---|---|---|
| Telegram | Bot API `sendMessage` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| WhatsApp | CallMeBot HTTP API (free, personal use) | `WHATSAPP_PHONE`, `WHATSAPP_CALLMEBOT_APIKEY` |
| Slack / Discord | Incoming webhook (sends both `text` and `content` so one URL format works for either) | `ALERT_WEBHOOK_URL` |

All channels are sent **in parallel**; a failing channel is logged and **never blocks the others** or crashes the app.

**Why Alertmanager routes through the app** instead of using Alertmanager's own Telegram integration: Alertmanager's config file can't read environment variables, so its native integrations would require writing the bot token into a config file, and this repo is **public**. Routing through the app means:
- One place holds the secrets (`.env` / K8s Secret).
- One message format for both paths.
- WhatsApp via CallMeBot works too (Alertmanager has no native support).
- The endpoint is protected by a shared Bearer token, compared in **constant time** (prevents timing attacks), injected into Alertmanager's config by a small entrypoint script at container start.

### 6.7 CI/CD pipeline (GitHub Actions)

```
             ┌─────────────┐  ┌───────────┐  ┌────────────────────┐  ┌──────────┐
 push/PR ──▶ │ Lint & test │  │ Helm lint │  │ Terraform validate │  │ IaC scan │
             └──────┬──────┘  └─────┬─────┘  └────────────────────┘  └──────────┘
                    └───────┬───────┘
              ┌─────────────┴─────────────┐
              ▼                           ▼
   ┌───────────────────────┐   ┌──────────────────────────┐
   │ Build, scan, push,    │   │ kind e2e: 2 replicas,    │
   │ SBOM, provenance, sign│   │ leader + failover        │
   └───────────┬───────────┘   └──────────────────────────┘
               ▼ (main only)
   ┌──────────────────────────────┐
   │ Kyverno policy tests on kind │
   └──────────────────────────────┘
```

Notable details:
- **Least-privilege tokens**: the workflow defaults to `contents: read`; only the image job gets `packages: write` (push), `security-events: write` (SARIF) and `id-token: write` (keyless signing).
- **PRs build and scan but don't push or sign**, so untrusted PR code can't publish images.
- **Service containers**: the test job gets a real Postgres for integration tests.
- **Caching**: npm cache and Docker layer cache (`type=gha`) keep runs fast.
- **Third-party actions pinned by commit SHA** where it matters (Trivy, Cosign installer); see §7 for why.
- **Debug steps** (`if: failure()`) dump pods, events and logs so a failed run explains itself.

### 6.8 Supply-chain security

The question supply-chain security answers: *"How do we know the thing running in production is exactly what our CI built from our code, and that it's not full of known holes?"*

| Layer | Tool | What it gives you |
|---|---|---|
| Known vulnerabilities in the image | Trivy image scan | CVE report in Security tab; CRITICAL blocks the build |
| Misconfigurations in IaC | Trivy config scan | Findings for Terraform/Helm/Dockerfile |
| What's inside | SBOM (BuildKit, SPDX) | Searchable ingredient list attached to the image |
| How it was built | SLSA provenance (`mode=max`) | Signed build record: repo, commit, workflow, inputs |
| Who built it | Cosign keyless signature | Proof the digest was signed by *this repo's* `ci.yml` on `main` |
| What may run | Kyverno `ImageValidatingPolicy` | Cluster refuses unsigned or foreign-signed images |
| Fresh dependencies | Dependabot | Weekly update PRs, tested by the same pipeline |

**Keyless signing step by step:**
1. The CI job asks GitHub for an **OIDC token** stating "I am workflow `ci.yml` in repo `boyatomic83/devops-uptime-platform` on `refs/heads/main`".
2. Cosign sends it to **Fulcio** (Sigstore's CA), which issues a certificate valid for ~10 minutes embedding that identity.
3. Cosign signs the image digest and records the signature in **Rekor**, a public, append-only transparency log.
4. Anyone (and Kyverno) can verify: signature valid + certificate identity matches + entry exists in Rekor.

There is no long-lived private key to store, rotate, or leak.

Verify it yourself:
```bash
cosign verify ghcr.io/boyatomic83/uptime-monitor:latest \
  --certificate-identity https://github.com/boyatomic83/devops-uptime-platform/.github/workflows/ci.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### 6.9 Kubernetes and Helm

The chart in `deploy/helm/uptime-monitor` renders these objects:

| Object | Why |
|---|---|
| **Deployment** (2 replicas) | Rolling updates with `maxUnavailable: 0`; liveness + readiness probes; CPU/memory requests and limits; hardened `securityContext` (non-root, read-only root FS, no privilege escalation, all capabilities dropped, seccomp); service-account token not mounted; **topology spread** so replicas land on different nodes; a `checksum/config` annotation so pods restart automatically when config changes. |
| **ConfigMap** | Non-secret settings (`MONITORS`, intervals, log level). |
| **Service** | Stable address for the API. |
| **Secret + StatefulSet + Service** (bundled Postgres) | Single-instance DB with a persistent volume, probes, non-root user. Password auto-generated and **preserved across upgrades** using Helm's `lookup`. |
| **NetworkPolicies** | App: only port 3000 inbound. Postgres: only reachable **from app pods**. |
| **PodDisruptionBudget** | At least 1 app pod during node drains. |
| **HorizontalPodAutoscaler** (optional) | Scale 2→5 on CPU. Safe because only the leader runs checks; extra replicas serve the API. |
| **Ingress / ServiceMonitor** (optional) | External HTTP access; Prometheus-operator scraping. |

**Safety guard:** if you ask for more than one replica (or autoscaling) **without** a database, `helm install` fails with a clear message, because in-memory replicas would each have different data.

**Modes:** bundled Postgres (default, great for demos and kind) · external managed DB via `database.existingSecret` (production: RDS/Cloud SQL) · memory with 1 replica (simplest).

### 6.10 Admission policies (Kyverno)

Kyverno runs as an **admission webhook**: every Pod creation request goes through it *before* Kubernetes accepts it.

| Policy | Type | Rule |
|---|---|---|
| `verify-uptime-image-signature` | `ImageValidatingPolicy` | Any image matching `ghcr.io/boyatomic83/uptime-monitor*` must carry a valid keyless Cosign signature from this repo's CI on main. The pod is rewritten to the **verified digest** (`mutateDigest`), so the tag can't be swapped afterwards. |
| `uptime-pod-security` | `ValidatingPolicy` (CEL) | In namespace `uptime`: no privileged containers; must run as non-root; CPU and memory limits required. |

Policies are written in **CEL** (Common Expression Language, the same language Kubernetes' built-in `ValidatingAdmissionPolicy` uses), e.g.:
```yaml
expression: >-
  object.spec.containers.all(c,
    c.?resources.?limits.?cpu.hasValue() && c.?resources.?limits.?memory.hasValue())
```

### 6.11 GitOps (Argo CD)

`deploy/argocd/application.yaml` tells Argo CD: "keep namespace `uptime` in sync with `deploy/helm/uptime-monitor` on branch `main` of this repo", with `automated: {prune: true, selfHeal: true}`.

- **Pull model**: the cluster pulls from Git. CI never needs cluster credentials, which is a big security win over "CI runs `kubectl apply`".
- **Audit trail**: every production change is a Git commit, so you know who changed what, when, and why.
- **Rollback** = `git revert`.
- **Drift correction**: manual `kubectl edit`s get reverted.

### 6.12 Infrastructure as Code (Terraform on AWS EKS)

`infra/terraform/eks` creates:
- **VPC** across 3 availability zones: private subnets for nodes (not reachable from the internet), public subnets for load balancers, **one NAT gateway** (cost saving; production would use one per AZ).
- **EKS** cluster (community module v21) with a **managed node group on Spot** instances (two instance types to improve Spot availability), core add-ons (VPC CNI, CoreDNS, kube-proxy, Pod Identity agent) and the **EBS CSI driver** (needed for the Postgres disk) using **EKS Pod Identity** for IAM.
- **Argo CD** and **Kyverno** installed via Helm (Kyverno with 3 admission replicas, because webhooks are on the critical path).
- **Remote state** template: S3 with native locking (`use_lockfile`, Terraform ≥ 1.10, no DynamoDB table needed).

> ⚠️ Applying it costs roughly $5–6/day (EKS control plane + NAT + nodes). CI only runs `fmt`, `init -backend=false`, `validate` and the IaC scan. Always `terraform destroy` when done.

### 6.13 Developer environment (Codespaces)

`.devcontainer/devcontainer.json` defines the dev machine as code: Node 22 image, Docker-in-Docker, kubectl, Helm, kind; forwards ports 3000/3001/9090/9093; runs `npm ci` on creation; recommends VS Code extensions. Because your laptop is low on disk space, everything (builds, containers, clusters) runs in GitHub's cloud.

---

## 7. Problems we faced and how we solved them

Real problems from building this project, in the order we hit them. For each: **symptom → cause → fix → why this fix**.

### 7.1 Couldn't create the GitHub repo from the build environment
- **Symptom:** `gh` reported the token as invalid.
- **Fix:** built and committed everything locally first; you created the empty repo; we attached it and pushed.
- **Lesson:** keep work committed locally so a blocked integration doesn't block progress.

### 7.2 Docker Hub rate limiting (HTTP 429)
- **Symptom:** `docker build` failed pulling `node:22-alpine`: *429 Too Many Requests*.
- **Cause:** Docker Hub limits anonymous pulls per IP; shared cloud IPs hit it quickly.
- **Fix:** pulled through **`mirror.gcr.io`** (Google's public Docker Hub cache) and re-tagged locally.
- **Production alternatives:** authenticate to Docker Hub, use a pull-through cache (ECR, Harbor, Artifactory), or base images from other registries.

### 7.3 Alpine package install blocked → removed `tini`
- **Symptom:** `apk add tini` failed (package mirror unreachable).
- **Background, the PID 1 problem:** Linux gives PID 1 no default signal handlers, so a process that doesn't explicitly handle `SIGTERM` *ignores* it, and Docker/K8s waits 10–30 s and then hard-kills it. PID 1 also must reap zombie child processes. `tini` is a tiny init that solves both.
- **Fix:** our app **explicitly handles `SIGTERM`/`SIGINT`** and spawns no child processes, so Node as PID 1 is safe. We removed `tini` and documented why in the Dockerfile. Shutdown measured at ~50 ms.
- **Alternative:** `docker run --init` / K8s `shareProcessNamespace`, or `dumb-init`.

### 7.4 `npm ci` inside the build couldn't reach the registry (TLS proxy)
- **Cause:** the build environment intercepts TLS with its own CA certificate, which the build container doesn't trust.
- **Fix:** a **BuildKit secret mount** (`--mount=type=secret,id=npm_ca,required=false`). When a CA is supplied it's used for `npm ci`; otherwise it's a no-op.
- **Why this way:** the certificate is **never written into an image layer** (unlike `COPY ca.crt`), and the same Dockerfile works unchanged in CI and Codespaces. Corporate networks commonly need exactly this.

### 7.5 Helm binary download blocked
- **Fix:** ran Helm from its official container image (`alpine/helm`) to lint and render the chart locally; CI installs Helm normally.

### 7.6 CI broke: the Trivy action version "disappeared"
- **Symptom:** *Unable to resolve action `aquasecurity/trivy-action@0.28.0`*.
- **Cause:** upstream changed its tag scheme to `v0.x.y`; the old tag no longer existed. **A tag is just a movable pointer**: it can be moved, deleted, or, in a supply-chain attack, pointed at malicious code.
- **Fix:** pinned to the **commit SHA** of `v0.36.0` (with a comment showing the version). Gotcha: `git ls-remote` first returned the *annotated tag object* hash; Actions needs the *peeled commit* hash (`refs/tags/v0.36.0^{}`).
- **Why:** SHA pinning is immutable. Dependabot still proposes updates.

### 7.7 "Prometheus and Grafana are empty"
- **Cause:** not a bug. Grafana opens on a generic home page and Prometheus on an empty query box.
- **Fix (UX):** made "Uptime Overview" Grafana's **default home dashboard**, disabled Grafana's update checks and plugin pre-install (pointless offline noise), and documented what to click on each port.

### 7.8 "Uptime %" panel showed *No data*
- **Cause:** the query divided `increase(checks_total{result="up"})` by all checks. If a target was **never** up, the `result="up"` series doesn't exist, so the division yields nothing.
- **Fix:** `avg_over_time(uptime_monitor_up[1h])`. The gauge always exists (0 or 1), and its average over time *is* the uptime ratio. Simpler and correct for 0%.
- **Lesson:** in Prometheus, *absent series ≠ zero*.

### 7.9 Async errors could crash requests (Express 4)
- **Cause:** Express 4 doesn't catch rejected promises from `async` handlers. A DB error would become an unhandled rejection instead of a 500.
- **Fix:** a tiny `wrap()` helper forwarding rejections to the error handler; tested ("store errors become 500, not crashes"). (Express 5 does this natively; see §8.)

### 7.10 Scaling out would duplicate every check and alert
- **Fix:** Postgres store + **advisory-lock leader election** (§6.2).
- **Alternatives considered:**
  | Option | Why not (here) |
  |---|---|
  | Kubernetes **Lease** API (client-go style election) | Works only inside K8s, needs RBAC and a K8s client; ours works in Compose too. |
  | Redis lock (SET NX PX / Redlock) | Another component to run; TTL tuning; Redlock's correctness is debated. |
  | Separate single-replica "scheduler" Deployment | Simple, but a second deployment, and no automatic standby. |
  | **Sharding** monitors across replicas | Scales check *throughput* (needed at thousands of monitors) but much more complex (rebalancing). |
  | Row locks / `SELECT … FOR UPDATE SKIP LOCKED` job queue | Great for queue-like work; more moving parts than we need. |
- **Trade-off accepted:** throughput is limited to what one replica can check. Fine for hundreds of monitors; sharding is the upgrade path.

### 7.11 Monitors created on a standby replica weren't being checked
- **Cause:** timers live in the leader's memory; a standby that receives `POST /api/monitors` can't start the leader's timer.
- **Fix:** **reconciliation loop**: the leader re-reads the store every 10 s and starts/stops timers to match. Same pattern as Kubernetes controllers.
- **Trade-off:** up to 10 s delay for monitors created via a standby. Alternative: Postgres `LISTEN/NOTIFY` for instant propagation.

### 7.12 Two replicas starting at once could race on database migrations
- **Fix:** schema creation wrapped in `pg_advisory_lock(7400001)` and written idempotently (`CREATE … IF NOT EXISTS`).
- **Production alternative:** a dedicated migration tool (Flyway, Liquibase, node-pg-migrate) run as a K8s Job or Helm hook.

### 7.13 Seeding monitors on every restart created duplicates
- **Fix:** seed only if `name|url` doesn't already exist. **Idempotent** startup.

### 7.14 Helm chart pitfalls
- **Bundled Postgres pods would have matched the app's Service selector**, since both shared `name`/`instance` labels, so traffic could hit the DB. **Fix:** distinct selector labels (`…-postgresql`).
- **Config changes didn't restart pods** (K8s doesn't restart pods when a ConfigMap changes). **Fix:** `checksum/config` annotation: changed config → changed pod template → rolling restart.
- **Random DB password would change on every `helm upgrade`**, breaking the app. **Fix:** `lookup` the existing Secret and reuse it. **Caveat:** Argo CD renders without cluster access (`lookup` returns nothing), so with GitOps set `postgresql.password` or use an external secret.
- **Unsafe config (replicas > 1 without DB).** **Fix:** template `fail` guard, tested in CI.

### 7.15 Alerts were firing in Prometheus but not reaching Alertmanager
- **Cause:** Prometheus was still running its *old* config (without the Alertmanager address). A mounted config file changing does **not** make Prometheus reload.
- **Fix:** restarted it; then enabled `--web.enable-lifecycle` and added `make reload` (`POST /-/reload`).
- **Lesson:** after changing config, verify the *running* state (Status → Runtime shows active Alertmanagers).

### 7.16 Kyverno: webhook race
- **Symptom:** `kubectl apply` of policies failed with *connection refused* to `kyverno-svc`, even though `helm install --wait` had succeeded.
- **Cause:** the Deployment was "ready" before its webhook endpoint accepted connections.
- **Fix:** retry the apply; then **wait for real enforcement** (a privileged probe pod must be rejected) instead of trusting a status flag.
- **Lesson:** test the *behaviour* you need, not a proxy for it.

### 7.17 Kyverno v1.20 removed the policy format we used
- **Symptom:** *Kyverno v1.20 removed execution of legacy kyverno.io policy types…*
- **Fix:** migrated to the new CEL-based types: `ImageValidatingPolicy` (signatures) and `ValidatingPolicy` (pod security). Because the docs site was unreachable from the build environment, we read the docs **from Kyverno's website repository on GitHub** instead of guessing the schema.
- **Lesson:** pin or test the versions you install. Our CI caught this *because* it really installs Kyverno and really tests the policies.

### 7.18 Cosign v3 vs Kyverno compatibility risk
- **Issue:** Cosign v3 defaults to a newer signature storage format. Kyverno's verification historically expects the classic format.
- **Decision:** pinned **Cosign v2.6.5** for signing. CI proves the end-to-end chain (sign → verify → Kyverno admits) works.
- **Future:** move to v3 once verified with your Kyverno version.

### 7.19 Keeping secrets out of a public repo
- Alertmanager can't expand env vars in its config, but notification integrations need tokens.
- **Fix:** route Alertmanager → app (§6.6). The only secret Alertmanager needs (the shared token) is injected by an entrypoint script at container start using a placeholder (`__ALERTMANAGER_WEBHOOK_TOKEN__`). Real secrets live in `.env` (git-ignored) locally, or a K8s Secret in clusters.
- When a real Telegram token was shared during development, it went **only** into a local git-ignored `.env`. We verified the commit contained zero occurrences of it, and removed it from the build environment afterwards. Treat any token shared in chat as exposed and **rotate it** (@BotFather → `/revoke`).

### 7.20 Testing notifications without reaching Telegram
- **Problem:** the build environment blocks `api.telegram.org`.
- **Fix:** tested the **whole chain** with a capture server standing in for the webhook channel: monitor down → Prometheus `TargetDown` → Alertmanager (with token) → app → channel. All four alerts arrived, and an unauthenticated call was rejected with 401. Telegram/WhatsApp request formats are covered by unit tests with a fake `fetch`.

---

## 8. Technology choices, trade-offs and alternatives

For each choice: **why we picked it**, **what it costs**, and **what else you could use**.

### Application layer
| Choice | Why | Trade-offs | Alternatives |
|---|---|---|---|
| **Node.js 22 + Express 4** | Simplest, most widely known web framework; huge ecosystem; perfect for I/O-bound work like HTTP checks (non-blocking event loop). | Minimal structure; Express 4 needs manual async error handling; single-threaded CPU. | **Express 5** (native async errors), **Fastify** (faster, schema validation), **NestJS** (structured, DI), **Go** (single static binary, tiny images, goroutines; a great fit for a checker), **Python FastAPI**. |
| **CommonJS + plain JS** | No build step; easiest to read. | No compile-time type checking. | **TypeScript** for larger teams. |
| **prom-client** | De-facto Prometheus library for Node. | Prometheus-specific. | **OpenTelemetry** SDK (vendor-neutral metrics + traces + logs). |
| **Hand-rolled JSON logger** | Zero dependencies, ~15 lines. | No log rotation/transports. | **pino** (very fast), **winston**. |
| **Jest + Supertest** | Standard, batteries-included; Supertest tests HTTP without opening ports. | Slower than newer runners. | **Vitest**, Node's built-in `node:test`. |

### Data and coordination
| Choice | Why | Trade-offs | Alternatives |
|---|---|---|---|
| **PostgreSQL** | Reliable, ubiquitous, managed everywhere (RDS, Cloud SQL); gives us storage **and** advisory locks for leader election in one component. | Time-series data in a relational DB doesn't scale to millions of checks without partitioning. | **TimescaleDB** (Postgres + time-series), **SQLite** (single node), **Redis** (fast, plus locks; weaker durability), **DynamoDB**. |
| **Advisory-lock leader election** | No extra infra; lock dies with the connection, so failover is automatic and safe. | Failover delay ≈ retry interval (5 s); requires Postgres. | K8s **Lease**, **etcd/Consul** sessions, **Redis** locks (see §7.10). |
| **Bundled Postgres StatefulSet** | One-command demo on any cluster. | Single instance: no replication, no automated backups. | **Managed DB** (recommended for prod), **CloudNativePG** / Zalando operators, Bitnami chart. |

### Containers and local dev
| Choice | Why | Trade-offs | Alternatives |
|---|---|---|---|
| **Docker + Alpine base** | Universal; Alpine is small. | Alpine uses musl libc (rare native-module issues); image still ~250 MB because of Node. | **Distroless** (no shell, smaller attack surface), **Chainguard/Wolfi** images (minimal, few CVEs), Debian-slim. |
| **Docker Compose** | Whole stack in one command, ideal for dev and demos. | Single host; no self-healing across machines. | **Tilt / Skaffold** (dev loop directly on K8s), **Podman** compose. |
| **GitHub Codespaces** | Zero local install (your laptop has little disk); identical env for everyone. | Free hours are limited; needs internet. | **Gitpod**, **Dev Containers** locally in VS Code, plain local Docker. |

### CI/CD and registry
| Choice | Why | Trade-offs | Alternatives |
|---|---|---|---|
| **GitHub Actions** | Lives next to the code; free for public repos; OIDC for keyless signing; huge marketplace. | Vendor lock-in; YAML can grow large. | **GitLab CI**, **Jenkins** (self-hosted, flexible, more ops work), **CircleCI**, **Tekton/Argo Workflows** (K8s-native), **Buildkite**. |
| **GHCR** | Same auth as the repo; free for public images. | Tied to GitHub. | **Docker Hub**, **Amazon ECR** (best with EKS), **Google Artifact Registry**, **Harbor** (self-hosted, with scanning). |
| **kind for CI e2e** | Real K8s in ~1 min inside a runner. | Single machine; no cloud load balancers. | **k3d/k3s**, **minikube**, ephemeral cloud clusters (realistic, slow, costly). |

### Security
| Choice | Why | Trade-offs | Alternatives |
|---|---|---|---|
| **Trivy** | One open-source tool scans images, IaC, secrets and SBOMs; SARIF output. | Scanners have false positives; non-blocking IaC scan relies on humans reading the report. | **Grype + Syft**, **Snyk**, **Docker Scout**, **Checkov / tfsec / KICS** (IaC). |
| **BuildKit SBOM + provenance** | Built into `docker/build-push-action`; no extra tool. | SPDX only. | **Syft** (CycloneDX/SPDX), GitHub **artifact attestations**. |
| **Cosign keyless (Sigstore)** | No keys to manage or leak; public transparency log; industry standard. | Depends on Sigstore public infrastructure; signer identity is visible publicly. | **Cosign with KMS keys** (private, more ops), **Notary v2 / Notation** (common with Azure). |
| **Kyverno** | Policies are Kubernetes YAML/CEL; built-in image verification; easy to read. | Its admission webhook is on the critical path (needs HA); API changes across versions (we hit one). | **OPA Gatekeeper** (Rego, very powerful, steeper learning curve), native K8s **ValidatingAdmissionPolicy** (CEL, no image verification), **Sigstore policy-controller** (signatures only). |

### Kubernetes delivery
| Choice | Why | Trade-offs | Alternatives |
|---|---|---|---|
| **Helm** | Most widely used packaging; values for per-env config; release history and rollback. | Go templating gets hard to read; logic in templates. | **Kustomize** (patch-based, no templates, built into kubectl), **cdk8s**, **Timoni/CUE**. |
| **Argo CD** | Great UI, very popular, pull-based GitOps, drift detection/self-heal. | Another system to run and secure. | **Flux CD** (lighter, CLI/CRD-driven), push-based CD from CI (simpler, but CI needs cluster credentials). |

### Infrastructure
| Choice | Why | Trade-offs | Alternatives |
|---|---|---|---|
| **Terraform + community modules** | Most widely used IaC; multi-cloud; mature EKS/VPC modules save hundreds of lines. | HCL is limited as a language; state must be managed; BSL licence. | **OpenTofu** (open-source Terraform fork, drop-in), **Pulumi** (real programming languages), **AWS CDK / CloudFormation** (AWS-only), **Crossplane** (infra via K8s). |
| **AWS EKS on Spot** | Most common cloud K8s target in job postings; Spot cuts node cost a lot. | Control plane costs ~$73/month even idle; Spot nodes can be reclaimed (OK because we run replicas + PDB). | **GKE Autopilot** (pay per pod, less ops), **AKS** (free control plane tier), **k3s on a single VM** (cheapest), **ECS/Fargate** (no K8s). |
| **Single NAT gateway** | Saves ~$65/month vs one per AZ. | AZ failure breaks outbound internet for other AZs. | One NAT per AZ (prod), VPC endpoints, NAT instances. |

### Observability and alerting
| Choice | Why | Trade-offs | Alternatives |
|---|---|---|---|
| **Prometheus** | CNCF standard for metrics; powerful PromQL; pull model detects dead targets. | Single-node storage; long retention needs extra components. | **VictoriaMetrics**, **Thanos/Mimir** (scale-out), **Datadog / New Relic / CloudWatch** (managed, paid). |
| **Loki + Grafana Alloy** | Cheap (indexes labels only); integrates with Grafana; Alloy is Grafana's current collector (Promtail is deprecated). | Full-text search is slower than Elasticsearch. | **ELK/OpenSearch** (powerful search, heavier), **Fluent Bit / Vector** (collectors), CloudWatch Logs. |
| **Grafana** | One UI for metrics + logs; dashboards as code. | Dashboard JSON is verbose. | **Grafana Cloud**, **Kibana**, **Datadog**. |
| **Alertmanager → app notifier** | Grouping/inhibition/silences from Alertmanager; secrets and channel logic in one place; supports WhatsApp. | The app is in the notification path for Prometheus alerts (if the app is down you still see `UptimeMonitorAppDown` in Alertmanager, but phone delivery goes through the app). | Alertmanager native receivers (`telegram_configs`, Slack, PagerDuty) with secrets from files; **PagerDuty / Opsgenie** for on-call rotations; **Grafana OnCall**. |
| **Telegram** | Free, official bot API, instant. | Requires Telegram. | Slack, Discord, email, SMS (Twilio), push (ntfy, Pushover). |
| **WhatsApp via CallMeBot** | Free, quick for personal use. | Unofficial third party; messages pass through their servers; rate limits. | **WhatsApp Business Cloud API** (official, Meta; needs business verification), **Twilio WhatsApp** (paid, reliable). |

---

## 9. Security model

Defence in depth: many independent layers, so one failure isn't fatal.

| Layer | Control |
|---|---|
| Code & dependencies | Lockfile (`npm ci`), Dependabot, lint, tests |
| CI | Least-privilege `GITHUB_TOKEN`; PRs can't push/sign; actions pinned by SHA |
| Image | Multi-stage, non-root, no secrets in layers, Trivy gate on CRITICAL |
| Provenance | SBOM + SLSA provenance + keyless Cosign signature in Rekor |
| Admission | Kyverno: only our signed images (pinned to digest); no privileged/root; limits required |
| Pod runtime | Read-only root FS, all capabilities dropped, no privilege escalation, seccomp `RuntimeDefault`, no service-account token |
| Network | NetworkPolicies: DB reachable only from app pods |
| Secrets | `.env` git-ignored; K8s Secrets; Helm-generated DB password; never in Git |
| API | Input validation, body size limits, Bearer token + constant-time compare on the Alertmanager endpoint, no secrets returned by `/api/notifications` |
| Infra | Private subnets for nodes, Pod Identity (no static AWS keys in pods), encrypted remote state |

**Known gaps (be honest in interviews):** the public API has no authentication (anyone who can reach port 3000 can add/delete monitors), so put it behind an ingress with auth or SSO for real use. The checker can be pointed at internal URLs (an SSRF risk), so in production restrict targets with an allow-list and egress NetworkPolicies. K8s Secrets are only base64-encoded at rest unless encryption-at-rest or an external secret manager (External Secrets Operator + AWS Secrets Manager / Vault) is used.

---

## 10. Operating the system

### Everyday commands
```bash
make up               # start the whole local stack
make down             # stop it (data stays in volumes)
make logs             # follow app logs
make test             # lint + tests
make reload           # apply Prometheus config changes
make test-alert       # send a test message to all notification channels
make telegram-chat-id # find your Telegram chat id
make kind-up && make kind-deploy   # run on a local Kubernetes cluster
```

### API examples
```bash
curl -X POST localhost:3000/api/monitors -H 'content-type: application/json' \
  -d '{"name":"my-site","url":"https://example.com","intervalSec":15}'
curl localhost:3000/api/monitors
curl localhost:3000/api/whoami
curl localhost:3000/metrics | grep uptime_
```

### Kubernetes
```bash
kubectl -n uptime get pods,svc,pdb,hpa
kubectl -n uptime logs -l app.kubernetes.io/name=uptime-monitor --tail=50
kubectl -n uptime scale deploy/uptime-uptime-monitor --replicas=3
# who is leader?
for p in $(kubectl -n uptime get pods -l app.kubernetes.io/name=uptime-monitor -o name); do
  kubectl -n uptime exec $p -- wget -qO- localhost:3000/api/whoami; echo; done
kubectl -n uptime delete pod <leader-pod>      # watch failover
helm -n uptime history uptime && helm -n uptime rollback uptime 1
```

### Troubleshooting
| Symptom | Check | Likely fix |
|---|---|---|
| Grafana empty | Time range; Dashboards → Uptime | Wait for data; `docker compose restart grafana` |
| No alerts in Alertmanager | Prometheus → Alerts (pending/firing?); Status → Runtime → Alertmanagers | Wait 1 min; `docker compose up -d --force-recreate prometheus` |
| No Telegram message | `make test-alert` output; `docker compose logs app \| grep notification` | Wrong token/chat id; message the bot first; recreate app after editing `.env` |
| `/readyz` returns 503 | DB reachable? | Check Postgres container/pod and `DATABASE_URL` |
| Leader count 0 or 2 in Grafana | `uptime_scheduler_leader` per pod | 0: DB connection issue; 2: replicas using different databases |
| Pods rejected in cluster | `kubectl -n uptime get events` | Kyverno policy message tells you which rule; unsigned image or missing limits |
| CI image job fails on Trivy | Security tab | Update base image / dependency, or wait for a fix if `ignore-unfixed` |

---

## 11. Known limitations and what to build next

**Limitations**
- One leader does all checks: throughput is bounded by one replica.
- Status page and API have no authentication.
- Bundled Postgres has no replication or backups.
- Checks are HTTP-only (no TCP, DNS, TLS-expiry, keyword checks), from one location.
- Notification failures are logged but not retried.

**Next steps (roughly by value)**
1. **SLOs and error budgets:** define "99.9% of checks succeed per 30 days" and alert on *burn rate* (multi-window), not on every blip.
2. **OpenTelemetry tracing (Tempo):** see where time goes inside each request/check.
3. **Per-PR preview environments:** every pull request gets its own namespace + URL, destroyed on merge.
4. **Chaos engineering (Chaos Mesh / Litmus):** kill pods, drop the DB, inject latency, and prove the failover works under fire.
5. **Sharded checking:** split monitors across replicas for scale.
6. **Auth:** OAuth2-proxy or SSO in front of the UI/API.
7. **Secrets management:** External Secrets Operator + AWS Secrets Manager or Vault.
8. **Progressive delivery:** Argo Rollouts canary releases gated on metrics.
9. **More check types:** TCP ports, TLS certificate expiry, response keyword, multi-region probes.
10. **Backups:** CloudNativePG with scheduled backups to S3, or a managed DB with PITR.

---

## 12. Interview prep

**30-second pitch**
> "I built an uptime-monitoring service in Node/Express and owned its whole delivery lifecycle. It's containerised with a hardened multi-stage image and runs highly available on Kubernetes: replicas share Postgres and elect a leader with an advisory lock, so checks run exactly once and fail over automatically. CI in GitHub Actions runs unit and real-database tests, Helm and Terraform validation and IaC scanning, builds the image with an SBOM and provenance, scans it with Trivy, signs it keylessly with Cosign, and runs end-to-end tests on a kind cluster, including leader failover and Kyverno policies that only admit signed images. It's deployed via Argo CD, the AWS infrastructure is Terraform, and it's observable through Prometheus, Loki and Grafana, with alerts routed by Alertmanager to Telegram or WhatsApp."

**Questions you should be able to answer (all covered above)**
- Why liveness and readiness are different endpoints, and why liveness doesn't check the DB. (§6.1)
- How you prevent duplicate checks with multiple replicas, and what happens when the leader dies. (§6.2, §7.10)
- Why Postgres advisory locks instead of a Kubernetes Lease or Redis. (§7.10, §8)
- Tag vs digest, and why we pin GitHub Actions by SHA. (§3, §7.6)
- What keyless signing is and what Kyverno verifies. (§6.8, §6.10)
- Push vs pull deployment, and why GitOps improves security. (§6.11)
- Why Prometheus *pull* helps detect dead targets; pending vs firing. (§6.5)
- What an SBOM is useful for during a zero-day. (§6.8)
- How config changes trigger pod restarts in Helm. (§7.14)
- A real problem you debugged: e.g. the "No data" uptime panel (absent series), Prometheus not reloading config, the Kyverno webhook race and API migration. (§7)
- What you would improve next and why. (§11)

---

*Repository: https://github.com/boyatomic83/devops-uptime-platform*
