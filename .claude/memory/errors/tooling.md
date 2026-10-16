# Erros Aprendidos — TOOLING

> Auto-gerenciado pela skill error-memory. Uma entrada por problema; status sempre preenchido.

---

## [ERR-001] Playwright trava depois dos testes → taskkill fora do PATH

| Campo | Valor |
|-------|-------|
| **Keywords** | playwright, webServer, taskkill, hang, teardown, PATH, System32, "is already used", 4318, pnpm e2e lento |
| **Status** | ATIVA (verificada em 2026-10-14) |
| **Categoria** | tooling |
| **Ambiente** | Windows 11, Git Bash e PowerShell do Claude Code, Node 22, @playwright/test 1.64.0 |
| **Severidade** | high |
| **Primeira vez** | 2026-10-14 |
| **Última vez** | 2026-10-14 |
| **Vezes atingido** | 3 |
| **Tentativas até solução** | 3 |

### Sintoma
Os testes passam em segundos, mas o `pnpm e2e` não termina (`4 passed (18.2m)`). A execução seguinte falha com:
```
Error: http://127.0.0.1:4318/__log is already used, make sure that nothing is running on the port/url
```

### Causa raiz
No Windows, o Playwright encerra os webServers com `taskkill /pid N /T /F` (spawnSync, shell: true) e ignora o erro. O `env.PATH` de `~/.claude/settings.json` substitui o PATH inteiro e não tinha `C:\Windows\System32`, então o `taskkill` não é encontrado. O Playwright espera os servidores saírem para sempre, e eles ficam presos nas portas 8148-4320.

### Solução
Incluir System32 no fim do `env.PATH` de `~/.claude/settings.json` (`...:/c/Windows/System32:/c/Windows`) e reiniciar o Claude Code. Até reiniciar, rode:
```bash
PATH="$PATH:/c/Windows/System32:/c/Windows" pnpm e2e
```
Servidores presos: encerre a árvore do processo `playwright test` antigo (Stop-Process recursivo pelos filhos).

### Como saber que voltou a quebrar
`which taskkill` não acha nada no shell do Claude, ou o `pnpm e2e` mostra o resumo "N passed" e não devolve o prompt.

## ERR-002 — `git worktree remove` falha com "Directory not empty" num worktree com node_modules do pnpm

| Campo | Valor |
|-------|-------|
| **Keywords** | git, worktree remove, Directory not empty, node_modules, pnpm, junction, Windows |
| **Status** | ATIVA (verificada em 2026-10-14) |
| **Categoria** | tooling |
| **Ambiente** | Windows 11, Git Bash, pnpm 12.6.0 |
| **Severidade** | low |
| **Primeira vez** | 2026-10-14 |
| **Última vez** | 2026-10-14 |
| **Vezes atingido** | 1 |
| **Tentativas até solução** | 2 |

### Sintoma
```
error: failed to delete '.../.claude/worktrees/agent-...': Directory not empty
```
O worktree já saiu de `git worktree list`, mas a pasta continua, só com `node_modules`.

### Causa raiz
O `node_modules` do pnpm tem links (junctions) que o `git worktree remove` não consegue apagar no Windows.

### Solução
O Git já desregistrou o worktree. Apague a pasta com `rmdir /s`, que remove o link sem seguir para o destino, e depois apague o branch:
```bash
cmd //c "rmdir /s /q .claude\worktrees\<nome>"
git branch -d <branch>
```
Não use `rm -rf` nem `Remove-Item -Recurse` aqui: podem seguir o link para o armazém do pnpm.

### Como saber que voltou a quebrar
O `rmdir /s` também falha, ou `git worktree list` ainda mostra a pasta.
