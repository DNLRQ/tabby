/* eslint-disable @typescript-eslint/no-type-alias */
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'

export type IronRDPModule = typeof import('ironrdp-wasm')

function resolveIronRdpModule (): string {
    // Webpack must not statically bundle this ESM package.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-eval
    return eval('require').resolve('ironrdp-wasm')
}

function resolveIronRdpPaths (): { jsPath: string, wasmPath: string } {
    const jsPath = resolveIronRdpModule()
    const wasmPath = path.join(path.dirname(jsPath), 'rdp_client_bg.wasm')
    if (!fs.existsSync(wasmPath)) {
        throw new Error(`IronRDP WASM not found next to ${jsPath}`)
    }
    return { jsPath, wasmPath }
}

function importIronRdp (specifier: string): Promise<IronRDPModule> {
    // TypeScript module=es2015 cannot emit dynamic import().
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const importESM = new Function('s', 'return import(s)') as (s: string) => Promise<IronRDPModule>
    return importESM(specifier)
}

let loaded: Promise<IronRDPModule> | null = null

export function loadIronRDP (): Promise<IronRDPModule> {
    if (!loaded) {
        loaded = (async () => {
            const { jsPath, wasmPath } = resolveIronRdpPaths()
            const mod = await importIronRdp(pathToFileURL(jsPath).href)
            const wasmBytes = fs.readFileSync(wasmPath)
            await mod.default({ module_or_path: wasmBytes })
            try {
                mod.setup('warn')
            } catch { }
            return mod
        })()
        loaded.catch(() => {
            loaded = null
        })
    }
    return loaded
}

export type {
    ClipboardData,
    DesktopSize,
    DeviceEvent,
    Extension,
    InputTransaction,
    Session,
    SessionBuilder,
    SessionTerminationInfo,
} from 'ironrdp-wasm'
