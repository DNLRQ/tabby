import { Injectable } from '@angular/core'
import { MenuItemOptions, TranslateService, HostAppService, Platform } from 'tabby-core'
import { SFTPFile } from './session/sftp'
import { SFTPContextMenuItemProvider } from './api'
import { SFTPPanelComponent } from './components/sftpPanel.component'


/** @hidden */
@Injectable()
export class CommonSFTPContextMenu extends SFTPContextMenuItemProvider {
    weight = 10

    constructor (
        private translate: TranslateService,
        private hostApp: HostAppService,
    ) {
        super()
    }

    async getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]> {
        const items: MenuItemOptions[] = [
            {
                click: async () => {
                    await panel.openCreateDirectoryModal()
                },
                label: this.translate.instant('Create directory'),
            },
            {
                click: async () => {
                    await panel.openCreateFileModal()
                },
                label: this.translate.instant('New file'),
            },
            {
                click: () => panel.renameSelected(),
                label: this.translate.instant('Rename'),
            },
            {
                click: () => panel.copySelected(),
                label: this.translate.instant('Copy'),
            },
            {
                click: () => panel.cutSelected(),
                label: this.translate.instant('Cut'),
            },
            {
                click: () => panel.pasteClipboard(),
                label: this.translate.instant('Paste'),
            },
            {
                click: () => panel.openPermissions(item),
                label: this.translate.instant('Permissions'),
            },
        ]

        if (!item.isDirectory) {
            items.push({
                click: () => panel.editInTabby(item),
                label: this.translate.instant('Edit'),
            })
        }

        if (item.isDirectory && this.hostApp.platform !== Platform.Web) {
            items.push({
                click: () => panel.selectedCount > 1 ? panel.downloadSelected() : panel.downloadFolder(item),
                label: panel.selectedCount > 1
                    ? this.translate.instant('Download')
                    : this.translate.instant('Download directory'),
            })
        }

        if (!item.isDirectory) {
            items.push({
                click: () => panel.selectedCount > 1 ? panel.downloadSelected() : panel.downloadItem(item),
                label: this.translate.instant('Download'),
            })
        }

        items.push({
            click: () => panel.sendSelected(),
            label: this.translate.instant('Send to another connection'),
        })

        items.push({
            click: () => panel.deleteSelected(),
            label: this.translate.instant('Delete'),
        })

        return items
    }
}
