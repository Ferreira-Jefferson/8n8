# Simplified Technical English (STE)

The English counterpart of [Português Técnico Simplificado](portugues-tecnico-simplificado.md). It adapts the ASD-STE100 standard (the aerospace norm for writing unambiguous manuals) to explanations of code. The product uses these rules when the person chooses English in the settings.

Goal: the reader understands the sentence at the first reading, and the sentence has only one possible meaning.

STE here is not the full standard. It uses about 80% of it: rules marked **required** always apply. Rules marked **recommended** can be broken when the sentence becomes clearer.

## 1. Words

1. **One word, one meaning** (required). Each term has one meaning in the whole text. If "node" is a step of the flow, "node" never means anything else.
2. **One meaning, one word** (required). Choose one term and do not swap it for synonyms. Always use "returns", never alternate with "gives back", "hands over" or "yields". The approved terms are in the glossary (section 6).
3. **Keep technical names as they are in the code** (required). Names of functions, variables, libraries and protocols are not translated and stay in code format: `calculate_shipping()`, `requests`, HTTP.
4. **Use the verb, not the noun** (required). Write "validates the order", not "performs the validation of the order". Write "writes", not "carries out the writing".
5. **No slang, no team jargon** (recommended). "Call", not "hit". "Database", not "DB" in running text.
6. **Avoid noun chains with more than three nouns** (recommended). "The order shipping table" is acceptable. "The customer order shipping rate table" is not: split it into two sentences.

## 2. Sentences

1. **Active voice** (required). The subject does the action: "The function writes the order". Avoid the passive ("the order is written by the function").
2. **Explicit subject when there is more than one candidate** (required). If the previous sentence talks about two functions, name which one does the action.
3. **Simple verb tenses** (required). Use:
   - the simple present to describe what the code does;
   - the imperative for instructions;
   - the simple past to tell what happened ("The call failed").

   Avoid the progressive ("is fetching" → "fetches"), the subjunctive when there is an alternative, and the perfect tenses.
4. **Word limits** (required):
   - instruction: up to 20 words;
   - description: up to 25 words;
   - node summary: up to 2 sentences.
5. **One idea per sentence** (required). One instruction per sentence, unless the two actions happen at the same time.
6. **Do not cut articles to save words** (required). "Validates the order", not "validates order".
7. **Simple connectors between related sentences** (recommended): "if", "when", "then", "because", "so".

## 3. Paragraphs and structure

1. **One subject per paragraph** (required).
2. **At most 6 sentences per paragraph** (required).
3. **Use a vertical list for steps, conditions or more than three items** (required).
4. **Number the steps in the order they happen** (required).

## 4. Warnings and suggestions

1. **Start with the command, then give the reason** (required).
   - Wrong: "Because the ZIP code API can be down, it would be good to consider handling the error."
   - Right: "Handle the error of the HTTP call. If the ZIP code API fails, the order stops with no answer."
2. **Say where the problem is** (required): the node, the file and the line.
3. **No polite conditional** (recommended). "Handle the error", not "it would be good to handle the error".

## 5. Examples

| Before | After (STE) |
|---|---|
| This function is responsible for performing the lookup of the state from the ZIP code provided, by making use of an external API. | The function queries an external API with the ZIP code. The function returns the state. |
| The order is being validated and, in case it is fine, it is passed along. | The function validates the order. If the order is valid, the flow goes to `calculate_shipping()`. |
| The shipping calculation is performed according to the shipping rate table by weight. | The function calculates the shipping. If the weight is over 30 kg, the function uses the heavy table. |

## 6. Controlled glossary

Use only these terms with these meanings. Add terms here when needed, and do not use synonyms.

| Term | Meaning | Do not use |
|---|---|---|
| node | one step of the flow on the map | block, box, step (as a synonym) |
| edge | the connection between two nodes | wire, line, arrow, link |
| input | the data the node receives | parameter (in running text) |
| output | the data the node produces | result |
| returns | the function gives a value to its caller | gives back, yields |
| calls | one function runs another | invokes, triggers, fires |
| reads / writes | a read or write operation on a database or file | fetches from the database, persists, saves |
| sends | the code sends data outside (email, API, queue) | fires, dispatches |
| validates | the code checks that the data is correct | verifies, checks |
| fails | an error happens | breaks, blows up, crashes |
