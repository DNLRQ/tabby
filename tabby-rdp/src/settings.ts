import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { TranslateService } from 'tabby-core'
import { RDPSettingsTabComponent } from './components/rdpSettingsTab.component'

/** @hidden */
@Injectable()
export class RDPSettingsTabProvider extends SettingsTabProvider {
    id = 'rdp'
    icon = 'tv'
    title = 'RDP'

    constructor (private translate: TranslateService) {
        super()
        this.title = this.translate.instant('RDP')
    }

    getComponentType (): any {
        return RDPSettingsTabComponent
    }
}
