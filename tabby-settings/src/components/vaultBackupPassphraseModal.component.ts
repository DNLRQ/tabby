import { Component, Input, OnDestroy } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { NotificationsService, PlatformService, TranslateService } from 'tabby-core'

/** @hidden */
@Component({
    templateUrl: './vaultBackupPassphraseModal.component.pug',
    styleUrls: ['./vaultBackupPassphraseModal.component.scss'],
})
export class VaultBackupPassphraseModalComponent implements OnDestroy {
    @Input() passphrase = ''
    @Input() profileCount = 0
    copied = false
    revealed = true

    constructor (
        private modalInstance: NgbActiveModal,
        private platform: PlatformService,
        private notifications: NotificationsService,
        private translate: TranslateService,
    ) { }

    copy (): void {
        if (!this.passphrase) {
            return
        }
        this.platform.setClipboard({ text: this.passphrase })
        this.copied = true
        this.notifications.info(this.translate.instant('Copied to clipboard'))
    }

    done (): void {
        this.wipe()
        this.revealed = false
        this.modalInstance.close(true)
    }

    ngOnDestroy (): void {
        this.wipe()
    }

    private wipe (): void {
        this.passphrase = ''
    }
}
