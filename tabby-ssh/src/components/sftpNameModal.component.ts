import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent } from 'tabby-core'

/** @hidden */
@Component({
    templateUrl: './sftpNameModal.component.pug',
})
export class SFTPNameModalComponent extends BaseComponent {
    @Input() title = ''
    @Input() label = ''
    @Input() value = ''
    @Input() confirmLabel = ''

    constructor (
        private modalInstance: NgbActiveModal,
    ) {
        super()
    }

    confirm (): void {
        this.modalInstance.close(this.value?.trim() ?? '')
    }

    cancel (): void {
        this.modalInstance.close('')
    }
}
