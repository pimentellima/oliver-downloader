# Oliver Downloader

App desktop local para baixar videos publicos unicos do YouTube em MP4.

## Desenvolvimento

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm prepare:binaries
pnpm dist
```

`prepare:binaries` baixa o `yt-dlp` oficial para `resources/bin`. Em runtime, o app tambem consegue atualizar uma copia gerenciada do `yt-dlp` em dados do aplicativo. O `ffmpeg` vem de `@ffmpeg-installer/ffmpeg`.

## Escopo v1

- YouTube publico, video unico
- Sem playlists, canais, login, cookies ou MP3
- Um download por vez, com fila persistida
- SQLite local no processo main

## Atualização manual pelo app no Windows

O botão **Verificar atualização** primeiro prepara/atualiza o `yt-dlp`. Se ele estiver disponível, o app verifica uma nova versão do Oliver Downloader via GitHub Releases usando `electron-updater`.

Para publicar uma atualização:

1. Aumente a versão em `package.json`, por exemplo `0.1.1`.
2. Em uma máquina Windows, rode:

```bash
pnpm prepare:binaries
pnpm dist -- --publish always
```

3. Use `GH_TOKEN` com permissão de publicar releases se estiver fora do GitHub Actions.

O update do app só funciona em app empacotado/instalado, não em `pnpm dev`.
