import { chmodSync, createWriteStream, existsSync, mkdirSync } from 'node:fs'
import https from 'node:https'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const binDir = join(root, 'resources', 'bin')
mkdirSync(binDir, { recursive: true })

const fileName = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'
const destination = join(binDir, fileName)

if (existsSync(destination)) {
  console.log(`yt-dlp ja existe em ${destination}`)
  process.exit(0)
}

const release = await fetchJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')
const asset = release.assets.find((candidate) => candidate.name === fileName)
if (!asset) {
  throw new Error(`Release atual nao contem ${fileName}`)
}

await download(asset.browser_download_url, destination)
if (process.platform !== 'win32') chmodSync(destination, 0o755)
console.log(`yt-dlp salvo em ${destination}`)

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Oliver Downloader' } }, (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
        })
        response.on('end', () => resolve(JSON.parse(body)))
      })
      .on('error', reject)
  })
}

function download(url, destinationPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Oliver Downloader' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume()
          download(response.headers.location, destinationPath).then(resolve, reject)
          return
        }
        if (response.statusCode !== 200) {
          response.resume()
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }
        const file = createWriteStream(destinationPath)
        response.pipe(file)
        file.on('finish', () => file.close(resolve))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}
