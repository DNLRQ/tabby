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
        const host = this.profile?.options
        this.setTitle(host?.host ? `SFTP · ${host.user}@${host.host}` : 'SFTP')
        this.subscribeUntilDestroyed(this.sshSession.willDestroy$, () => {
            this.sessionReleased = true
            this.destroy()
        })
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
