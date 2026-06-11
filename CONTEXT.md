# Oliver Downloader

Oliver Downloader e um app desktop local para baixar videos publicos unicos do YouTube em MP4, mantendo fila, historico e preferencias em SQLite local.

## Language

**Pasta de download**:
Diretorio local onde o arquivo final do video e salvo.
_Avoid_: Aba de download, destino, output folder

**Download**:
Tentativa registrada de obter um video publico do YouTube e gerar um arquivo MP4 local.
_Avoid_: Job, tarefa

**Fila**:
Conjunto ordenado de downloads pendentes ou em execucao, processado um item por vez.
_Avoid_: Queue tecnica

**Historico**:
Registro persistente de downloads concluidos, falhos ou cancelados.
_Avoid_: Log, biblioteca

**URL sanitizada**:
URL canonica `youtube.com/watch?v=ID` derivada de um link aceito do YouTube.
_Avoid_: Link original, URL limpa

**Video publico**:
Video unico do YouTube que pode ser acessado sem login, cookies, assinatura ou confirmacao de idade.
_Avoid_: Qualquer URL do YouTube

## Relationships

- Um **Download** pertence a exatamente um **Video publico**
- Uma **URL sanitizada** identifica logicamente um **Video publico**
- A **Fila** contem zero ou mais **Downloads**
- O **Historico** contem **Downloads** encerrados
- A **Pasta de download** recebe os arquivos finais de **Downloads** concluidos

## Example dialogue

> **Dev:** "Se o usuario colar um Shorts com parametros de tracking, criamos outro download?"
> **Domain expert:** "Nao. Extraimos o ID, geramos a URL sanitizada e destacamos o download existente se ele ja estiver na fila ou no historico."

## Flagged ambiguities

- "Aba de download" foi usado para significar **Pasta de download**; resolvido como diretorio local configuravel.
