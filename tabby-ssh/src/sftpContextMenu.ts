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
        ]

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
            click: () => panel.deleteSelected(),
            label: this.translate.instant('Delete'),
        })

        return items
    }
}
