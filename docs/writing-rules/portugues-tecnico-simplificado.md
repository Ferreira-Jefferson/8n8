# Português Técnico Simplificado (PTS)

Adaptação para o português do ASD-STE100 (Simplified Technical English). O STE100 é a norma da indústria aeroespacial para escrever manuais sem ambiguidade. O PTS aplica as mesmas ideias às explicações de código.

Objetivo: o leitor entende a frase na primeira leitura e só existe uma forma de interpretá-la.

O PTS não é a norma completa. Ele usa cerca de 80% dela: as regras marcadas como **obrigatória** sempre valem, e as marcadas como **recomendada** podem ser quebradas quando a frase fica mais clara assim.

## 1. Palavras

1. **Uma palavra, um sentido** (obrigatória). Cada termo tem um único significado no texto inteiro. Se "nó" é uma etapa do fluxo, "nó" nunca significa outra coisa.
2. **Um sentido, uma palavra** (obrigatória). Escolha um termo e não troque por sinônimos. Use sempre "retorna", nunca alterne com "devolve", "entrega" ou "dá como resultado". Os termos aprovados ficam no glossário (seção 6).
3. **Mantenha os nomes técnicos como estão no código** (obrigatória). Nomes de funções, variáveis, bibliotecas e protocolos não são traduzidos e ficam em formato de código: `calcular_frete()`, `requests`, HTTP.
4. **Use o verbo, não o substantivo** (obrigatória). Escreva "valida o pedido", não "faz a validação do pedido". Escreva "grava", não "realiza a gravação".
5. **Sem gíria, sem jargão de time e sem anglicismo quando existe um termo em português consagrado** (recomendada). "Chamada", não "call". "Banco de dados", não "DB" no texto corrido.
6. **Evite cadeias com mais de três "de"** (recomendada). "A tabela de frete do pedido" é aceitável. "A tabela de valores de frete de pedidos de clientes" não é: divida em duas frases.

## 2. Frases

1. **Voz ativa** (obrigatória). O sujeito faz a ação: "A função grava o pedido". Evite a passiva analítica ("o pedido é gravado pela função") e a passiva com "se" ("grava-se o pedido").
2. **Sujeito explícito quando houver mais de um candidato** (obrigatória). Se a frase anterior fala de duas funções, nomeie qual delas faz a ação.
3. **Tempos verbais simples** (obrigatória). Use:
   - presente do indicativo para descrever o que o código faz;
   - imperativo para instruções;
   - pretérito perfeito para contar o que aconteceu ("A chamada falhou").

   Evite o gerúndio ("está buscando" → "busca"), o subjuntivo quando houver alternativa e os tempos compostos.
4. **Limite de palavras** (obrigatória):
   - instrução: até 20 palavras;
   - descrição: até 25 palavras;
   - resumo de nó: até 2 frases.
5. **Uma ideia por frase** (obrigatória). Uma instrução por frase, a não ser que as duas ações aconteçam ao mesmo tempo.
6. **Não corte artigos nem preposições para economizar palavras** (obrigatória). "Valida o pedido", não "valida pedido".
7. **Conectivos simples entre frases relacionadas** (recomendada): "se", "quando", "depois", "porque", "então".

## 3. Parágrafos e estrutura

1. **Um assunto por parágrafo** (obrigatória).
2. **No máximo 6 frases por parágrafo** (obrigatória).
3. **Use lista vertical para passos, condições ou mais de três itens** (obrigatória).
4. **Passos numerados na ordem em que acontecem** (obrigatória).

## 4. Avisos e sugestões

1. **Comece pelo comando e depois dê o motivo** (obrigatória).
   - Errado: "Como a API de CEP pode ficar fora do ar, seria interessante considerar tratar o erro."
   - Certo: "Trate o erro da chamada HTTP. Se a API de CEP falhar, o pedido para sem resposta."
2. **Diga onde está o problema** (obrigatória): o nó, o arquivo e a linha.
3. **Sem condicional de cortesia** (recomendada). "Trate o erro", não "seria bom tratar o erro".

## 5. Exemplos

| Antes | Depois (PTS) |
|---|---|
| Essa função é responsável por realizar a busca da UF a partir do CEP fornecido, utilizando uma API externa. | A função consulta uma API externa com o CEP. A função retorna a UF. |
| O pedido vai sendo validado e, caso esteja ok, é passado adiante. | A função valida o pedido. Se o pedido é válido, o fluxo segue para `calcular_frete()`. |
| Faz-se o cálculo do frete de acordo com a tabela de valores de frete por peso. | A função calcula o frete. Se o peso passa de 30 kg, a função usa a tabela pesada. |

## 6. Glossário controlado

Use somente estes termos com estes sentidos. Acrescente termos aqui quando precisar e não use sinônimos.

| Termo | Sentido | Não use |
|---|---|---|
| nó | uma etapa do fluxo no mapa | bloco, caixa, etapa (como sinônimo) |
| aresta | a conexão entre dois nós | fio, linha, seta, link |
| entrada | o dado que o nó recebe | input, parâmetro (no texto corrido) |
| saída | o dado que o nó produz | output, resultado |
| retorna | a função entrega um valor a quem chamou | devolve, dá |
| chama | uma função executa outra | invoca, aciona, dispara |
| lê / grava | operação de leitura ou escrita em banco ou arquivo | busca no banco, persiste, salva |
| envia | o código manda dados para fora (e-mail, API, fila) | dispara, manda |
| valida | o código confere se o dado está correto | checa, verifica |
| falha | um erro acontece | quebra, dá pau, estoura |
