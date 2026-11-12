#!/usr/bin/env node
// 密钥边界扫描（需求 1.4）：Frontend 与 Backend 中不得出现 Write_Token / LLM_Key 的变量名或取值。
// 用法：node scripts/check-secret-boundary.mjs [rootDir]   命中数 > 0 时以退出码 1 结束。
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FORBIDDEN_NAMES = [
  'STUDIO_STRAPI_TOKEN',
  'STUDIO_LLM_API_KEY',
  'STUDIO_OWNER_PASSPHRASE',
  'STUDIO_SESSION_SECRET',
  'LLM_API_KEY',
  'STRAPI_TOKEN',
]

// 取值过短（<8）会造成大量误报，不参与取值匹配
const MIN_VALUE_LENGTH = 8
const SKIP_DIRS = new Set(['node_modules', 'dist', '.tmp', '.git', '.nuxt', '.data', '.strapi', '.cache'])
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.db', '.md', '.map'])

function* walk(dir, skipOutputDir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    if (skipOutputDir && name === '.output') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full, skipOutputDir)
    else if (st.isFile() && !SKIP_EXT.has(extname(name).toLowerCase())) yield full
  }
}

export function scan(root, env = process.env) {
  const needles = FORBIDDEN_NAMES.map((n) => ({ kind: 'name', label: n, text: n }))
  for (const n of FORBIDDEN_NAMES) {
    const v = env[n]
    if (typeof v === 'string' && v.length >= MIN_VALUE_LENGTH) {
      needles.push({ kind: 'value', label: `${n} 的取值`, text: v })
    }
  }

  const files = [
    ...walk(join(root, 'frontend'), true),
    ...walk(join(root, 'frontend', '.output', 'public'), false),
    ...walk(join(root, 'backend'), false),
  ]
  const hits = []
  for (const file of new Set(files)) {
    const buf = readFileSync(file)
    if (buf.includes(0)) continue
    const content = buf.toString('utf8')
    for (const nd of needles) {
      if (content.includes(nd.text)) hits.push({ file: relative(root, file).split(sep).join('/'), kind: nd.kind, label: nd.label })
    }
  }
  return hits
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..'))
  const hits = scan(root)
  if (hits.length > 0) {
    console.error(`密钥边界检查失败：${hits.length} 处命中`)
    for (const h of hits) console.error(`  ${h.file}  [${h.label}]`) // 不输出取值本身
    process.exit(1)
  }
  console.log('密钥边界检查通过：0 命中')
}
