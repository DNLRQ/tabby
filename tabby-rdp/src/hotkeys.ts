import { Injectable } from '@angular/core'
import { HotkeyDescription, HotkeyProvider, TranslateService } from 'tabby-core'

/** @hidden */
@Injectable()
export class RDPHotkeyProvider extends HotkeyProvider {
    hotkeys: HotkeyDescription[] = [
        {
            id: 'restart-rdp-session',
            name: this.translate.instant('Restart current RDP session'),
        },
    ]

    constructor (private translate: TranslateService) { super() }

    async provide (): Promise<HotkeyDescription[]> {
        return this.hotkeys
    }
}
