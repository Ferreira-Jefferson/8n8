# Error Memory — Índice Mestre

> Auto-gerenciado pela skill `error-memory`. Integridade: `python <skill-dir>/scripts/integrity.py`.

## Como buscar

1. Identifique 2-3 keywords do erro (código, ferramenta, operação).
2. Busque nesta tabela.
3. Abra o arquivo de categoria e **confira o campo Status** antes de aplicar:
   solução `OBSOLETA` não deve ser tentada de novo.

## Índice

| ID | Keywords | Arquivo | Descrição |
|----|----------|---------|-----------|
| ERR-001 | playwright, webServer, taskkill, hang, teardown, PATH, System32, 8288 already used | tooling.md | Playwright termina os testes e trava ao encerrar os servidores: falta System32 no PATH |
| ERR-002 | git, worktree remove, Directory not empty, node_modules, pnpm, junction, Windows | tooling.md | git worktree remove falha com node_modules do pnpm: apague a pasta com cmd rmdir /s |
