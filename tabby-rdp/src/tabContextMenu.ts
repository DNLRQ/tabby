import { Injectable } from '@angular/core'
import { BaseTabComponent, MenuItemOptions, NotificationsService, TabContextMenuItemProvider, TranslateService } from 'tabby-core'
import { RDPTabComponent } from './components/rdpTab.component'

/** @hidden */
@Injectable()
export class RDPContextMenu extends TabContextMenuItemProvider {
    weight = 1

    constructor (
        private translate: TranslateService,
        private notifications: NotificationsService,
    ) { super() }

    async getItems (tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        if (!(tab instanceof RDPTabComponent)) {
            return []
        }
        return [
            {
                label: this.translate.instant('Disconnect'),
                click: () => {
                    tab.disconnect()
                    this.notifications.notice(this.translate.instant('Disconnect'))
                },
            },
            {
                label: this.translate.instant('Reconnect'),
                click: () => {
                    tab.reconnect()
                    this.notifications.notice(this.translate.instant('Reconnect'))
                },
            },
        ]
    }
}
