import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent } from 'tabby-core'
import { SFTPFile, SFTPSession } from '../session/sftp'

const BITS = [
    { label: 'Owner read', mask: 0o400 },
    { label: 'Owner write', mask: 0o200 },
    { label: 'Owner execute', mask: 0o100 },
    { label: 'Group read', mask: 0o040 },
    { label: 'Group write', mask: 0o020 },
    { label: 'Group execute', mask: 0o010 },
    { label: 'Others read', mask: 0o004 },
    { label: 'Others write', mask: 0o002 },
    { label: 'Others execute', mask: 0o001 },
]

/** @hidden */
@Component({
    templateUrl: './sftpPermissionsModal.component.pug',
    styles: [`
        .sftp-perm-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px 16px;
        }
    `],
})
export class SFTPPermissionsModalComponent extends BaseComponent {
    @Input() item: SFTPFile
    @Input() sftp: SFTPSession
    @Input() canChown = false
    bits = BITS
    mode = 0
    owner = ''
    group = ''
    recursive = false
    busy = false
    progress = ''
    error = ''

    constructor (
        private modalInstance: NgbActiveModal,
    ) {
        super()
    }

    ngOnInit (): void {
        this.mode = this.item.mode & 0o777
        this.owner = this.item.user ?? (this.item.uid != null ? String(this.item.uid) : '')
        this.group = this.item.group ?? (this.item.gid != null ? String(this.item.gid) : '')
    }

    get octal (): string {
        return this.mode.toString(8).padStart(3, '0')
    }

    set octal (value: string) {
        const parsed = parseInt(value, 8)
        if (!Number.isNaN(parsed)) {
            this.mode = parsed & 0o777
        }
    }

    hasBit (mask: number): boolean {
        return (this.mode & mask) === mask
    }

    toggleBit (mask: number): void {
        this.mode = this.hasBit(mask) ? this.mode & ~mask : this.mode | mask
    }

    async save (): Promise<void> {
        this.busy = true
        this.error = ''
        try {
            await this.apply(this.item)
            this.modalInstance.close(true)
        } catch (e) {
            this.error = e.message ?? String(e)
            this.busy = false
        }
    }

    cancel (): void {
        this.modalInstance.close(false)
    }

    private async apply (file: SFTPFile): Promise<void> {
        this.progress = file.fullPath
        await this.sftp.chmod(file.fullPath, this.mode)
        if (this.canChown && (this.owner || this.group)) {
            await this.sftp.chown(file.fullPath, this.owner || '0', this.group || undefined)
        }
        if (this.recursive && file.isDirectory) {
            for (const child of await this.sftp.readdir(file.fullPath)) {
                await this.apply(child)
            }
        }
    }
}
