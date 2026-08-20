import { Injector } from '@angular/core'
import { Subject, Observable } from 'rxjs'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import {
    HostAppService,
    Logger,
    LogService,
    Platform,
    PlatformService,
    PromptModalComponent,
    TranslateService,
} from 'tabby-core'
import { RDPProfile } from './api'
import { attachInputHandlers } from './input'
import { loadIronRDP, IronRDPModule, Session } from './ironrdp'
import { RDCleanPathProxy } from './rdpProxy'
import { PasswordStorageService } from './services/passwordStorage.service'

export interface DesktopGeometry {
    width: number
    height: number
}

const IRON_ERROR_KIND: Record<string, string> = {
    '0': 'General RDP error',
    '1': 'Incorrect password',
    '2': 'Unable to log on',
    '3': 'Access denied',
    '4': 'RDCleanPath proxy error',
    '5': 'Could not connect to RDP proxy',
    '6': 'RDP protocol negotiation failed',
}

function dumpRdpError (err: any, label = 'error'): void {
    console.error(`[tabby-rdp] ${label}:`, err)
    console.error(`[tabby-rdp] ${label} typeof:`, typeof err, 'ctor:', err?.constructor?.name)
    if (!err || typeof err !== 'object') {
        return
    }
    try {
        console.error(`[tabby-rdp] ${label} keys:`, Object.getOwnPropertyNames(err))
    } catch { }
    try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-eval
        const { inspect } = eval('require')('util')
        console.error(`[tabby-rdp] ${label} inspect:`, inspect(err, { depth: 6, getters: true, showHidden: true }))
    } catch { }
    for (const key of ['message', 'stack', 'name', 'cause', 'code']) {
        try {
            if (err[key] != null) {
                console.error(`[tabby-rdp] ${label}.${key}:`, err[key], typeof err[key])
            }
        } catch { }
    }
    try {
        if (typeof err.kind === 'function') {
            console.error(`[tabby-rdp] ${label}.kind():`, err.kind())
        }
        if (typeof err.backtrace === 'function') {
            console.error(`[tabby-rdp] ${label}.backtrace():`, err.backtrace())
        }
        if (typeof err.rdcleanpathDetails === 'function') {
            console.error(`[tabby-rdp] ${label}.rdcleanpathDetails():`, err.rdcleanpathDetails())
        }
        if (typeof err.toString === 'function') {
            console.error(`[tabby-rdp] ${label}.toString():`, err.toString())
        }
    } catch (inspectErr) {
        console.error(`[tabby-rdp] ${label} wasm inspect failed:`, inspectErr)
    }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function formatRdpError (err: any, depth = 0): string {
    dumpRdpError(err, depth === 0 ? 'error' : `error[${depth}]`)
    if (err == null) {
        return 'Connection failed'
    }
    if (typeof err === 'string') {
        return err === '[object Object]' ? 'Connection failed' : err
    }

    try {
        if (typeof err.kind === 'function') {
            const kind = err.kind()
            const mapped = IRON_ERROR_KIND[String(kind)]
            if (mapped) {
                let extra = ''
                try {
                    extra = typeof err.backtrace === 'function' ? String(err.backtrace() ?? '') : ''
                } catch { }
                return extra ? `${mapped}: ${extra.split('\n')[0]}` : mapped
            }
        }
        if (typeof err.backtrace === 'function') {
            const backtrace = err.backtrace()
            if (backtrace) {
                return String(backtrace).split('\n')[0]
            }
        }
    } catch { }

    const nested = err.message
    if (typeof nested === 'string' && nested && nested !== '[object Object]') {
        return nested
    }
    if (nested && typeof nested === 'object' && depth < 3) {
        return formatRdpError(nested, depth + 1)
    }
    if (err.cause && typeof err.cause === 'object' && depth < 3) {
        return formatRdpError(err.cause, depth + 1)
    }

    try {
        const text = String(err)
        if (text && !text.includes('[object Object]')) {
            return text
        }
    } catch { }

    return 'Connection failed'
}

export class RDPSession {
    open = false
    get closed$ (): Observable<string> { return this.closed }
    get error$ (): Observable<string> { return this.error }

    private closed = new Subject<string>()
    private error = new Subject<string>()
    private logger: Logger
    private proxy: RDCleanPathProxy | null = null
    private ironSession: Session | null = null
    private detachInput: (() => void) | null = null
    private destroyed = false
    private passwordStorage: PasswordStorageService
    private ngbModal: NgbModal
    private hostApp: HostAppService
    private platform: PlatformService
    private translate: TranslateService
    private authUsername = ''

    constructor (
        injector: Injector,
        public profile: RDPProfile,
    ) {
        this.logger = injector.get(LogService).create(`rdp-${profile.options.host}-${profile.options.port}`)
        this.passwordStorage = injector.get(PasswordStorageService)
        this.ngbModal = injector.get(NgbModal)
        this.hostApp = injector.get(HostAppService)
        this.platform = injector.get(PlatformService)
        this.translate = injector.get(TranslateService)
    }

    async start (canvas: HTMLCanvasElement, size: DesktopGeometry, inputCanvas?: HTMLCanvasElement): Promise<void> {
        if (this.hostApp.platform === Platform.Web) {
            throw new Error(this.translate.instant('RDP is not available in the web version'))
        }

        this.destroyed = false
        this.authUsername = this.profile.options.user
        if (!this.authUsername) {
            const modal = this.ngbModal.open(PromptModalComponent)
            modal.componentInstance.prompt = this.translate.instant('Username')
            const result = await modal.result.catch(() => null)
            this.authUsername = result?.value ?? ''
            if (!this.authUsername) {
                throw new Error(this.translate.instant('Username is required'))
            }
        }

        let password = this.profile.options.password ?? ''
        if (!password) {
            password = await this.passwordStorage.loadPassword(this.profile, this.authUsername) ?? ''
        }
        if (!password) {
            const modal = this.ngbModal.open(PromptModalComponent)
            modal.componentInstance.prompt = this.translate.instant('Password for {user}@{host}', {
                user: this.authUsername,
                host: this.profile.options.host,
            })
            modal.componentInstance.password = true
            modal.componentInstance.showRememberCheckbox = true
            const result = await modal.result.catch(() => null)
            if (result?.value) {
                password = result.value
                if (result.remember) {
                    await this.passwordStorage.savePassword(this.profile, password, this.authUsername)
                }
            }
        }

        this.logger.info('Loading IronRDP WASM')
        console.log('[tabby-rdp] loading WASM')
        const iron = await loadIronRDP()
        console.log('[tabby-rdp] WASM loaded')

        this.proxy = new RDCleanPathProxy(this.logger)
        const proxyUrl = await this.proxy.start()
        console.log('[tabby-rdp] proxy started at', proxyUrl)

        const destination = this.formatDestination()
        console.log('[tabby-rdp] connecting', {
            destination,
            user: this.authUsername,
            domain: this.profile.options.domain,
            nla: this.profile.options.nla,
            size,
        })
        const desktopSize = new iron.DesktopSize(size.width, size.height)
        const builder = new iron.SessionBuilder()
        builder.username(this.authUsername)
        builder.password(password)
        if (this.profile.options.domain) {
            builder.serverDomain(this.profile.options.domain)
        }
        builder.destination(destination)
        builder.proxyAddress(proxyUrl)
        builder.authToken('none')
        builder.desktopSize(desktopSize)
        builder.renderCanvas(canvas)
        builder.extension(new iron.Extension('enable_credssp', this.profile.options.nla))
        builder.extension(new iron.Extension('display_control', true))
        const cursorTarget = inputCanvas ?? canvas
        builder.setCursorStyleCallbackContext(cursorTarget)
        builder.setCursorStyleCallback((style: string) => {
            cursorTarget.style.cursor = style || 'default'
        })

        if (this.profile.options.clipboard) {
            this.setupClipboard(builder, iron)
        }

        this.logger.info(`Connecting to ${destination} as ${this.authUsername}`)
        try {
            this.ironSession = await builder.connect()
        } catch (err) {
            const wasmMessage = formatRdpError(err)
            const proxyMessage = this.proxy.lastError
            console.error('[tabby-rdp] builder.connect() failed', { wasmMessage, proxyMessage })
            this.logger.error('builder.connect() failed:', wasmMessage, proxyMessage)
            throw new Error(proxyMessage ? `${wasmMessage} (${proxyMessage})` : wasmMessage)
        }
        console.log('[tabby-rdp] builder.connect() succeeded')

        if (this.wasDestroyed()) {
            this.teardown()
            return
        }

        const ds = this.ironSession.desktopSize()
        canvas.width = ds.width
        canvas.height = ds.height
        if (inputCanvas) {
            inputCanvas.width = ds.width
            inputCanvas.height = ds.height
        }
        this.detachInput = attachInputHandlers(inputCanvas ?? canvas, this.ironSession, iron)
        this.open = true

        this.ironSession.run().then(info => {
            const reason = info.reason()
            this.logger.info(`RDP session ended: ${reason}`)
            console.log('[tabby-rdp] session.run() ended:', reason)
            this.finish(reason)
        }).catch(err => {
            const message = formatRdpError(err)
            this.logger.error('RDP session error:', message)
            this.error.next(message)
            this.finish(message)
        })
    }

    resize (width: number, height: number): void {
        if (!this.open || !this.ironSession) {
            return
        }
        try {
            this.ironSession.resize(Math.max(800, width), Math.max(600, height))
        } catch (err: any) {
            this.logger.warn('Failed to resize RDP desktop:', err?.message ?? err)
        }
    }

    async destroy (): Promise<void> {
        this.destroyed = true
        this.teardown()
    }

    private wasDestroyed (): boolean {
        return this.destroyed
    }

    private finish (reason: string): void {
        if (this.wasDestroyed()) {
            this.teardown()
            return
        }
        const wasOpen = this.open
        this.teardown()
        if (wasOpen) {
            this.closed.next(reason)
        }
    }

    private teardown (): void {
        this.open = false
        try {
            this.detachInput?.()
        } catch { }
        this.detachInput = null
        try {
            this.ironSession?.shutdown()
        } catch { }
        this.ironSession = null
        this.proxy?.stop()
        this.proxy = null
    }

    private formatDestination (): string {
        const host = this.profile.options.host
        const port = this.profile.options.port || 3389
        if (host.includes(':') && !host.startsWith('[')) {
            return `[${host}]:${port}`
        }
        return `${host}:${port}`
    }

    private setupClipboard (builder: InstanceType<IronRDPModule['SessionBuilder']>, iron: IronRDPModule): void {
        builder.remoteClipboardChangedCallback((clipboardData: InstanceType<IronRDPModule['ClipboardData']>) => {
            try {
                if (clipboardData.isEmpty()) {
                    return
                }
                for (const item of clipboardData.items()) {
                    const mime = item.mimeType()
                    if (mime.startsWith('text/')) {
                        const value = item.value()
                        if (typeof value === 'string' && value.length) {
                            this.platform.setClipboard({ text: value })
                            return
                        }
                    }
                }
            } catch (err: any) {
                this.logger.warn('Failed to read remote clipboard:', formatRdpError(err))
            }
        })

        builder.forceClipboardUpdateCallback(async () => {
            if (!this.ironSession) {
                return
            }
            try {
                const data = new iron.ClipboardData()
                const text = this.platform.readClipboard()
                if (text) {
                    data.addText('text/plain', text)
                }
                await this.ironSession.onClipboardPaste(data)
            } catch (err: any) {
                this.logger.warn('Failed to sync local clipboard:', formatRdpError(err))
            }
        })
    }

}
