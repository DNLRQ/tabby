import { Injectable, OnDestroy } from '@angular/core'
import { TransfersUIService } from 'tabby-core'
import { SFTPTransfersWindowComponent } from '../components/sftpTransfersWindow.component'

/** @hidden */
@Injectable({ providedIn: 'root' })
export class SFTPTransfersWindowService implements OnDestroy {
    constructor (
        private transfersUI: TransfersUIService,
    ) {
        this.transfersUI.registerPage(SFTPTransfersWindowComponent)
        this.transfersUI.registerOpener(() => this.transfersUI.toggleFullScreen())
    }

    ngOnDestroy (): void {
        this.transfersUI.registerPage(null)
        this.transfersUI.registerOpener(null)
    }
}
