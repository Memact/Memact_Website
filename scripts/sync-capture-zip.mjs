import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const captureZip = path.resolve(root, '..', 'capture', 'artifacts', 'memact-extension.zip')
const websiteZip = path.join(root, 'public', 'memact-extension.zip')

async function main() {
  await mkdir(path.dirname(websiteZip), { recursive: true })
  await copyFile(captureZip, websiteZip)
  console.log(`Synced Capture extension zip to ${websiteZip}`)
}

main().catch((error) => {
  console.error(
    'Could not sync Capture extension zip. Build Capture first with `npm run package-extension` in the Capture repo.'
  )
  console.error(error?.message || error)
  process.exitCode = 1
})
