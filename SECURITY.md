# Segurança

O 8n8 roda na sua máquina e usa a sua chave de API ou o seu Claude Code. Uma falha de segurança aqui pode deixar outra pessoa gastar esses recursos ou ler os seus arquivos. Se você achou uma, avise em privado, como explicado abaixo.

## Como avisar

Não abra uma issue pública. Use o aviso privado do GitHub:

1. Abra a aba **Security** do repositório.
2. Clique em **Report a vulnerability**.
3. Descreva a falha, os passos para reproduzi-la e o que ela permite.

O dono do projeto responde em até 7 dias. A correção sai antes do aviso público, e o seu nome entra no aviso se você quiser.

## O que conta como falha

- Outro programa, outra página do navegador ou outra extensão do VS Code consegue usar a sua chave de API ou o seu Claude Code pelo 8n8.
- A chave aparece numa resposta da API, no terminal, num log ou num arquivo fora de `~/.8n8/config.json` e do cofre do VS Code.
- A CLI aceita pedidos sem o token da sessão, ou de fora de `127.0.0.1`. A extensão do VS Code abre uma porta.
- O 8n8 lê ou escreve um arquivo fora da pasta analisada e das pastas de dados dele.
- O 8n8 inicia um processo fora das duas exceções nomeadas na regra `no-child-process` (`apps/cli/src/open-browser.ts` e `packages/llm/src/claude-code.ts`), ou o Claude Code roda dentro da pasta analisada.
- Uma página do painel do VS Code carrega script sem o nonce ou fala com a rede.

## Versão suportada

Só a última versão da branch `main` recebe correções.

## Para o dono do projeto: o que ligar no GitHub

Os workflows (`.github/workflows/ci.yml` e `codeql.yml`) e o `.github/dependabot.yml` já estão no repositório. Eles só valem quando o GitHub os exige. Antes de abrir o repositório para a comunidade, ligue em **Settings**:

1. **Branches → Branch protection rules → `main`**:
   - exija pull request antes do merge;
   - exija os status checks `gates` e `secrets` (CI) e `analyze` (CodeQL), com a branch atualizada;
   - exija a revisão dos donos do código (`CODEOWNERS`);
   - não permita force push nem apagar a branch;
   - aplique as regras também aos administradores.
2. **Code security**:
   - ligue o **Private vulnerability reporting**;
   - ligue o **Dependabot alerts** e o **Dependabot security updates**;
   - ligue o **Secret scanning** e o **Push protection**.
3. **Actions → General**: deixe o `GITHUB_TOKEN` só com leitura e não permita que as Actions aprovem pull requests.
