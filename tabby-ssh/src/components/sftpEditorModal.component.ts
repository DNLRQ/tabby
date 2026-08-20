import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent } from 'tabby-core'

/** @hidden */
@Component({
    templateUrl: './sftpEditorModal.component.pug',
    styles: [`
        textarea {
            min-height: 360px;
            font-family: var(--bs-font-monospace, monospace);
            font-size: 13px;
        }
    `],
})
export class SFTPEditorModalComponent extends BaseComponent {
    @Input() path = ''
    @Input() content = ''
    saving = false

    constructor (
        private modalInstance: NgbActiveModal,
    ) {
        super()
    }

    save (): void {
        this.modalInstance.close(this.content)
    }

    cancel (): void {
        this.modalInstance.close(null)
    }
}
