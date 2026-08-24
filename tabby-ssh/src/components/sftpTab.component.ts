import { Component, Injector, Input } from '@angular/core'
import { AppService, BaseTabComponent } from 'tabby-core'
import { SSHSession } from '../session/ssh'
import { SSHProfile } from '../api'

/** @hidden */
@Component({
    selector: 'sftp-tab',
    templateUrl: './sftpTab.component.pug',
    styleUrls: ['./sftpTab.component.scss'],
})
export class SFTPTabComponent extends BaseTabComponent {
    @Input() sshSession: SSHSession
    @Input() profile: SSHProfile
    @Input() path = '/'
    private sessionReleased = false

    constructor (
        injector: Injector,
        private app: AppService,
    ) {
        super(injector)
        this.skipRecovery = true
        this.setTitle('SFTP')
        this.icon = 'fas fa-folder-open'
    }

    async getRecoveryToken (): Promise<null> {
        return null
    }

    ngOnInit (): void {
        if (!this.sshSession) {
            return
        }
        this.sshSession.ref()
        this.setTitle(this.sftpTabTitle())
        this.subscribeUntilDestroyed(this.sshSession.willDestroy$, () => {
            this.sessionReleased = true
            this.destroy()
        })
    }

    private sftpTabTitle (): string {
        const profile = this.profile ?? this.sshSession?.profile
        const name = profile?.name?.trim()
        if (name) {
            return `SFTP · ${name}`
        }
        const host = profile?.options
        if (host?.host) {
            return `SFTP · ${host.user ? `${host.user}@${host.host}` : host.host}`
        }
        return 'SFTP'
    }

    ngOnDestroy (): void {
        this.releaseSession()
        super.ngOnDestroy()
    }

    destroy (skipDestroyedEvent = false): void {
        this.releaseSession()
        super.destroy(skipDestroyedEvent)
    }

    private releaseSession (): void {
        if (this.sshSession && !this.sessionReleased) {
            this.sessionReleased = true
            this.sshSession.unref()
        }
    }

    openAnotherWindow (): void {
        this.app.openNewTab({
            type: SFTPTabComponent,
            inputs: {
                sshSession: this.sshSession,
                profile: this.profile,
                path: this.path,
            },
        })
    }

    onClosed (): void {
        this.destroy()
    }
}
