import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { AfterViewInit, Component, ElementRef, Injector, Input, NgZone, OnDestroy, ViewChild } from '@angular/core'
import { BaseTabComponent, BaseTabProcess, GetRecoveryTokenOptions, HotkeysService, PlatformService, RecoveryToken, TranslateService } from 'tabby-core'
import { RDPProfile, RDPScaleMode } from '../api'
import { formatRdpError, RDPSession } from '../session'
import { attachGpuPresenter } from '../gpuPresent'

/** @hidden */
@Component({
    selector: 'rdp-tab',
    templateUrl: './rdpTab.component.pug',
    styleUrls: ['./rdpTab.component.scss'],
})
export class RDPTabComponent extends BaseTabComponent implements AfterViewInit, OnDestroy {
    @Input() profile: RDPProfile
    @ViewChild('canvas') canvasRef: ElementRef<HTMLCanvasElement>
    @ViewChild('stage') stageRef: ElementRef<HTMLElement>

    session: RDPSession | null = null
    status: 'idle' | 'connecting' | 'connected' | 'closed' = 'idle'
    errorMessage: string | null = null
    scaleMode: RDPScaleMode = 'fit'
    private isDisconnectedByHand = false
    private hotkeysDisabled = false
    private sessionGeneration = 0
    private resizeObserver: ResizeObserver | null = null
    private resizeTimer: ReturnType<typeof setTimeout> | null = null
    private gpuDetach: (() => void) | null = null
    private hotkeys: HotkeysService
    private translate: TranslateService
    private platform: PlatformService
    private zone: NgZone

    constructor (private injector: Injector) {
        super(injector)
        this.hotkeys = injector.get(HotkeysService)
        this.translate = injector.get(TranslateService)
        this.platform = injector.get(PlatformService)
        this.zone = injector.get(NgZone)
        this.icon = 'fas fa-tv'
    }

    ngOnInit (): void {
        this.setTitle(this.profile.name || this.profile.options.host || 'RDP')
        this.subscribeUntilDestroyed(this.hotkeys.hotkey$, hotkey => {
            if (!this.hasFocus) {
                return
            }
            if (hotkey === 'restart-rdp-session' || hotkey === 'reconnect-tab') {
                this.reconnect()
            }
            if (hotkey === 'disconnect-tab') {
                this.disconnect()
            }
        })
        this.subscribeUntilDestroyed(this.focused$, () => this.onTabFocus())
        this.subscribeUntilDestroyed(this.blurred$, () => this.onTabBlur())
    }

    ngAfterViewInit (): void {
        this.zone.runOutsideAngular(() => {
            this.resizeObserver = new ResizeObserver(() => this.scheduleResize())
            this.resizeObserver.observe(this.stageRef.nativeElement)
        })
        this.connect()
    }

    ngOnDestroy (): void {
        this.resizeObserver?.disconnect()
        this.resizeObserver = null
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer)
        }
        this.stopGpu()
        this.enableHotkeys()
        super.ngOnDestroy()
    }

    async connect (): Promise<void> {
        this.isDisconnectedByHand = false
        this.errorMessage = null
        this.status = 'connecting'
        this.setProgress(0.3)
        const generation = ++this.sessionGeneration

        const session = new RDPSession(this.injector, this.profile)
        this.session = session
        this.subscribeUntilDestroyed(session.closed$, reason => {
            if (this.sessionGeneration !== generation) {
                return
            }
            this.zone.run(() => this.onSessionEnded(reason, session))
        })
        this.subscribeUntilDestroyed(session.error$, message => {
            if (this.sessionGeneration !== generation) {
                return
            }
            this.zone.run(() => {
                this.errorMessage = message
            })
        })

        try {
            const size = this.desktopSize()
            this.stopGpu()
            const view = this.canvasRef.nativeElement
            view.width = size.width
            view.height = size.height
            const source = document.createElement('canvas')
            source.width = size.width
            source.height = size.height
            this.gpuDetach = attachGpuPresenter(source, view)
            const renderTarget = this.gpuDetach ? source : view
            if (!this.gpuDetach) {
                try {
                    view.getContext('2d', { alpha: false, desynchronized: true })
                } catch { }
            }
            await session.start(renderTarget, size, this.gpuDetach ? view : undefined)
            if (this.session !== session) {
                await session.destroy()
                return
            }
            this.status = 'connected'
            this.setProgress(null)
            if (!this.profile.disableDynamicTitle) {
                const user = this.profile.options.user
                const host = this.profile.options.host
                this.setTitle(user ? `${user}@${host}` : host)
            }
            this.canvasRef.nativeElement.focus()
            this.onTabFocus()
            this.fitCanvas()
        } catch (err: any) {
            console.error('[tabby-rdp] tab connect() failed')
            const message = formatRdpError(err)
            this.setProgress(null)
            this.status = 'closed'
            this.errorMessage = message
            await session.destroy()
            if (this.session === session) {
                this.session = null
                this.stopGpu()
            }
            if (this.sessionGeneration === generation) {
                this.handleSessionEndBehavior()
            }
        }
    }

    async disconnect (): Promise<void> {
        this.isDisconnectedByHand = true
        this.enableHotkeys()
        await this.session?.destroy()
        this.session = null
        this.stopGpu()
        this.status = 'closed'
        this.errorMessage = this.translate.instant(_('Disconnected'))
    }

    async reconnect (): Promise<void> {
        this.sessionGeneration++
        await this.session?.destroy()
        this.session = null
        await this.connect()
    }

    async canClose (): Promise<boolean> {
        if (!this.session?.open) {
            return true
        }
        if (!(this.profile.options.warnOnClose ?? this.config.store.rdp?.warnOnClose)) {
            return true
        }
        return (await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant(_('Disconnect from {host}?'), this.profile.options),
            buttons: [
                this.translate.instant(_('Disconnect')),
                this.translate.instant(_('Do not close')),
            ],
            defaultId: 0,
            cancelId: 1,
        })).response === 0
    }

    async getRecoveryToken (_options?: GetRecoveryTokenOptions): Promise<RecoveryToken> {
        return {
            type: 'app:rdp-tab',
            profile: this.profile,
        }
    }

    async getCurrentProcess (): Promise<BaseTabProcess | null> {
        if (!this.session?.open) {
            return null
        }
        return { name: `RDP: ${this.profile.options.host}` }
    }

    destroy (skipDestroyedEvent = false): void {
        this.enableHotkeys()
        this.stopGpu()
        this.session?.destroy()
        super.destroy(skipDestroyedEvent)
    }

    setScaleMode (mode: RDPScaleMode): void {
        this.scaleMode = mode
        this.fitCanvas()
    }

    private onSessionEnded (reason: string, session: RDPSession): void {
        if (this.session !== session) {
            return
        }
        this.enableHotkeys()
        this.session = null
        this.stopGpu()
        this.status = 'closed'
        if (!this.errorMessage) {
            this.errorMessage = reason
        }
        this.handleSessionEndBehavior()
    }

    private handleSessionEndBehavior (): void {
        if (this.isDisconnectedByHand) {
            return
        }
        if (this.profile.behaviorOnSessionEnd === 'reconnect') {
            this.reconnect()
            return
        }
        if (this.profile.behaviorOnSessionEnd === 'close') {
            this.destroy()
        }
    }

    private desktopSize (): { width: number, height: number } {
        const maxWidth = 1920
        const maxHeight = 1080
        let width: number
        let height: number
        if (!this.profile.options.adaptiveResolution) {
            width = Math.max(800, this.profile.options.width || 1280)
            height = Math.max(600, this.profile.options.height || 720)
        } else {
            const rect = this.stageRef.nativeElement.getBoundingClientRect()
            width = Math.max(800, Math.round(rect.width) || 1280)
            height = Math.max(600, Math.round(rect.height) || 720)
        }
        if (width > maxWidth || height > maxHeight) {
            const scale = Math.min(maxWidth / width, maxHeight / height)
            width = Math.max(800, Math.round(width * scale))
            height = Math.max(600, Math.round(height * scale))
        }
        return {
            width: width - width % 2,
            height: height - height % 2,
        }
    }

    private scheduleResize (): void {
        if (this.resizeTimer) {
            clearTimeout(this.resizeTimer)
        }
        this.resizeTimer = setTimeout(() => {
            this.zone.run(() => {
                this.fitCanvas()
                if (this.status === 'connected' && this.profile.options.adaptiveResolution) {
                    const size = this.desktopSize()
                    this.session?.resize(size.width, size.height)
                }
            })
        }, 250)
    }

    private fitCanvas (): void {
        const canvas = this.canvasRef.nativeElement
        const stage = this.stageRef.nativeElement
        if (this.scaleMode === 'actual') {
            canvas.style.width = `${canvas.width}px`
            canvas.style.height = `${canvas.height}px`
            stage.style.overflow = 'auto'
            return
        }
        stage.style.overflow = 'hidden'
        const rect = stage.getBoundingClientRect()
        if (!canvas.width || !canvas.height || !rect.width || !rect.height) {
            canvas.style.width = '100%'
            canvas.style.height = '100%'
            return
        }
        const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height)
        canvas.style.width = `${Math.round(canvas.width * scale)}px`
        canvas.style.height = `${Math.round(canvas.height * scale)}px`
    }

    private stopGpu (): void {
        try {
            this.gpuDetach?.()
        } catch { }
        this.gpuDetach = null
    }

    private onTabFocus (): void {
        if (this.status === 'connected') {
            this.disableHotkeys()
            this.canvasRef.nativeElement.focus()
        }
    }

    private onTabBlur (): void {
        this.enableHotkeys()
    }

    private disableHotkeys (): void {
        if (!this.hotkeysDisabled) {
            this.hotkeys.disable()
            this.hotkeysDisabled = true
        }
    }

    private enableHotkeys (): void {
        if (this.hotkeysDisabled) {
            this.hotkeys.enable()
            this.hotkeysDisabled = false
        }
    }
}
