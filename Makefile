MAKEFLAGS += --no-print-directory
.SILENT:
DENO_TASK = deno task -q
.DEFAULT_GOAL := help

.PHONY: benchmark build check ci clean format help publish security setup test update version

benchmark: ## ⏱️ Run benchmarks
	@$(DENO_TASK) benchmark

build: ## 🧱 Build Genesys Cloud function zip
	@$(DENO_TASK) build:genesys:zip

check: ## ✅ Run quality checks
	@$(DENO_TASK) check

ci: ## 🚦 Run every gate CI runs (checks, coverage, security, zip build)
	@$(DENO_TASK) ci

clean: ## 🧹 Clean generated artifacts
	@$(DENO_TASK) clean

format: ## 🎨 Format code
	@deno fmt

help: ## ❓ List available make targets
	@deno eval 'const files=Deno.args; const entries=[]; const pattern=/^([A-Za-z0-9_.:-]+):.*?##\s*(.+)\s*$$/; for (const file of files) { const text=await Deno.readTextFile(file); for (const line of text.split(/\r?\n/)) { const m=line.match(pattern); if (m) entries.push([m[1], m[2]]); } } entries.sort((a,b)=>a[0].localeCompare(b[0])); const pad=Math.max(8,...entries.map(([n])=>n.length))+2; for (const [name, desc] of entries) console.log(name.padEnd(pad)+desc);' $(MAKEFILE_LIST)

publish: ## 🚀 Publish function to Genesys Cloud
	@$(DENO_TASK) publish

security: ## 🔒 Run security checks
	@$(DENO_TASK) security

setup: ## ⚙️ Setup repository
	@$(DENO_TASK) setup

test: ## 🧪 Run tests
	@$(DENO_TASK) test

update: ## 🔄 Update dependencies
	@$(DENO_TASK) update

version: ## 📦 Print package metadata
	@$(DENO_TASK) version
