#!/usr/bin/env node
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { execSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as builder } from 'electron-builder'
import * as vars from './vars.mjs'

const isTag = (process.env.GITHUB_REF || '').startsWith('refs/tags/')
const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

process.env.ARCH = (process.env.ARCH === 'arm' ? 'armv7l' : process.env.ARCH) || process.arch

function syncBuiltinPlugins () {
    const target = path.join(repoRoot, 'builtin-plugins')
    if (!fs.existsSync(target)) {
        console.log('builtin-plugins missing; running prepackage-plugins...')
        execSync('node scripts/prepackage-plugins.mjs', { stdio: 'inherit', cwd: repoRoot })
        return
    }
    for (const plugin of vars.builtinPlugins) {
        if (plugin === 'tabby-web') {
            continue
        }
        const src = path.join(repoRoot, plugin)
        const dest = path.join(target, plugin)
        if (!fs.existsSync(dest)) {
            console.log(`Missing ${plugin} in builtin-plugins; running prepackage-plugins...`)
            execSync('node scripts/prepackage-plugins.mjs', { stdio: 'inherit', cwd: repoRoot })
            return
        }
        for (const part of ['dist', 'locale']) {
            const from = path.join(src, part)
            const to = path.join(dest, part)
            if (!fs.existsSync(from)) {
                continue
            }
            fs.rmSync(to, { recursive: true, force: true })
            fs.cpSync(from, to, { recursive: true })
        }
        const pkg = path.join(src, 'package.json')
        if (fs.existsSync(pkg)) {
            fs.copyFileSync(pkg, path.join(dest, 'package.json'))
        }
    }
    console.log('Copied latest plugin builds into builtin-plugins')
}

syncBuiltinPlugins()


function hasCommand (cmd) {
    try {
        execSync(`command -v ${cmd}`, { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

const linux = ['deb', 'tar.gz', 'appimage']
if (hasCommand('rpmbuild')) {
    linux.push('rpm')
} else {
    console.warn('Skipping rpm: install rpmbuild to build it (sudo apt-get install rpm)')
}

builder({
    dir: true,
    linux,
    armv7l: process.env.ARCH === 'armv7l',
    arm64: process.env.ARCH === 'arm64',
    config: {
        npmRebuild: false,
        extraMetadata: {
            version: vars.version,
        },
        publish: process.env.KEYGEN_TOKEN ? [
            vars.keygenConfig,
            {
                provider: 'github',
                channel: `latest-${process.env.ARCH}`,
            },
        ] : undefined,
    },
    publish: (process.env.KEYGEN_TOKEN && isTag) ? 'always' : 'never',
}).catch(e => {
    console.error(e)
    process.exit(1)
})
