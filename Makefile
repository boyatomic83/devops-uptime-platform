.PHONY: install dev test lint build up down logs reload kind-up kind-deploy kind-down help

CLUSTER ?= uptime
IMAGE   ?= uptime-monitor:local

install:      ## Install app dependencies
	cd app && npm ci

dev:          ## Run app locally with hot reload
	cd app && npm run dev

test:         ## Lint + unit tests
	cd app && npm run lint && npm test

build:        ## Build the Docker image
	docker build -t $(IMAGE) app

up:           ## Start app + Prometheus + Grafana
	docker compose up -d --build
	@echo "App:          http://localhost:3000"
	@echo "Prometheus:   http://localhost:9090"
	@echo "Grafana:      http://localhost:3001 (admin/admin)"
	@echo "Alertmanager: http://localhost:9093"
	@echo "Loki:         http://localhost:3100 (query it from Grafana > Explore)"
	@echo "Alloy:        http://localhost:12345"

down:         ## Stop the compose stack
	docker compose down

logs:
	docker compose logs -f app

reload:       ## Reload Prometheus + Alertmanager config without restarting
	curl -fsS -X POST localhost:9090/-/reload && curl -fsS -X POST localhost:9093/-/reload && echo reloaded

kind-up:      ## Create a local Kubernetes cluster
	kind create cluster --name $(CLUSTER)

kind-deploy: build  ## Build, load and helm-install into kind
	kind load docker-image $(IMAGE) --name $(CLUSTER)
	helm upgrade --install uptime deploy/helm/uptime-monitor -n uptime --create-namespace \
	  --set image.repository=uptime-monitor --set image.tag=local --set image.pullPolicy=Never --wait
	@echo "Run: kubectl -n uptime port-forward svc/uptime-uptime-monitor 8080:80"

kind-down:
	kind delete cluster --name $(CLUSTER)

help:
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'
