.DEFAULT_GOAL := help

.PHONY: help up dev down restart status logs reset-db studio typecheck lint build

help: ## Mostra l'elenco dei comandi disponibili
	@echo "=========================================================="
	@echo "               FANTASTA - GESTIONE AMBIENTE LOCALE        "
	@echo "=========================================================="
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

up: ## ONE-SHOT: avvia Docker (se spento) + Supabase + Web App e apre il browser
	@./scripts/start-local.sh

start: up ## Alias di 'make up'

dev: ## Avvia Supabase in Docker e Next.js in modalità dev locale (npm run dev)
	@echo ">> 1. Avvio dei container Supabase..."
	@npx supabase start
	@echo ">> 2. Sincronizzazione variabili .env.local..."
	@./scripts/setup-local-env.sh
	@echo ">> 3. Avvio di Next.js in dev mode..."
	@npm run dev

down: ## Ferma tutti i container Docker (App Web e Supabase)
	@echo ">> Arresto del container Next.js..."
	@docker compose down || true
	@echo ">> Arresto dei container Supabase..."
	@npx supabase stop
	@echo "✓ Tutti i container sono stati arrestati."

restart: down up ## Riavvia completamente lo stack locale

status: ## Mostra lo stato di Supabase e dei container Docker
	@echo "=== STATO CONTAINER NEXT.JS ==="
	@docker compose ps
	@echo "\n=== STATO SERVIZI SUPABASE ==="
	@npx supabase status

logs: ## Mostra i log dell'app Next.js in Docker
	@docker compose logs -f

reset-db: ## Ripristina il database locale e riapplica tutte le migrazioni
	@echo ">> Reset database e riapplicazione migrazioni..."
	@npx supabase db reset
	@echo "✓ Database ripristinato!"

studio: ## Mostra l'URL di Supabase Studio
	@echo "Apri nel browser: http://localhost:54323"

typecheck: ## Esegue il controllo dei tipi TypeScript
	@npm run typecheck

lint: ## Esegue il linter ESLint
	@npm run lint

build: ## Esegue la compilazione di produzione Next.js
	@npm run build
