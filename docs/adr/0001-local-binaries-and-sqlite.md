# Local binaries and SQLite for downloads

Oliver Downloader runs download, parsing, merge/conversion and persistence locally because the product is for a single desktop user and should not require a backend service. The app uses `yt-dlp` for YouTube metadata/download, `ffmpeg` for MP4 merge/remux, and SQLite in the Electron main process for queue, history and settings. `yt-dlp` is updateable from the official GitHub releases because YouTube changes often; `ffmpeg` remains packaged because it is larger and less volatile for this workflow.
