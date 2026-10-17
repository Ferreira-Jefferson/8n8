# 8n8

O 8n8 é um mapa visual de código. Você aponta um arquivo, uma pasta ou um trecho, e ele mostra como as partes se conectam, como nós ligados por arestas.

O mapa começa amplo. Você abre um nó para ver o fluxo interno dele e vai descendo, até as linhas reais de código. Cada nó traz um resumo e sugestões de melhoria.

Linguagens: Python e TypeScript. Precisa do Node 22.13 ou mais novo.

## Uso

```bash
npx 8-n-8 .          # abre o mapa da pasta atual, sem instalar
npm install -g 8-n-8 # ou instala o comando 8n8
```

O pacote no npm se chama `8-n-8` (o npm recusou `8n8` por ser parecido com outros nomes). O comando que ele instala continua sendo `8n8`.

```bash
8n8 .              # abre o mapa da pasta atual, numa janela própria (Chrome ou Edge)
8n8 C:\projeto     # ou de qualquer pasta
8n8                # abre a tela inicial
8n8 --no-open      # sobe o servidor sem abrir o navegador
8n8 --no-app       # abre numa aba do navegador padrão, em vez da janela própria
8n8 --help         # mostra o uso e as variáveis
```

O pacote não tem dependências nem scripts de instalação: todo o código vai dentro dele.

Documentação completa, prints e configuração do LLM: [github.com/Ferreira-Jefferson/8n8](https://github.com/Ferreira-Jefferson/8n8).

## Licença

GPL-3.0. O texto completo está em [LICENSE](LICENSE).
