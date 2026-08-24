import { Injectable } from '@angular/core'
import type { SFTPPanelComponent } from '../components/sftpPanel.component'

export interface SFTPConnectionRef {
    id: number
    label: string
    host: string
    path: string
    panel: SFTPPanelComponent
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class SFTPConnectionRegistry {
    private nextId = 1
    private ids = new WeakMap<SFTPPanelComponent, number>()
    private panels = new Set<SFTPPanelComponent>()

    register (panel: SFTPPanelComponent): void {
        if (!this.ids.has(panel)) {
            this.ids.set(panel, this.nextId++)
        }
        this.panels.add(panel)
    }

    unregister (panel: SFTPPanelComponent): void {
        this.panels.delete(panel)
    }

    list (except?: SFTPPanelComponent): SFTPConnectionRef[] {
        return [...this.panels]
            .filter(panel => panel !== except && panel.sftp)
            .map(panel => ({
                id: this.ids.get(panel) ?? 0,
                label: panel.connectionName,
                host: panel.hostLabel,
                path: panel.path || '/',
                panel,
            }))
    }
}
