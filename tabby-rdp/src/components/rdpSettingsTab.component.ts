import { Component, HostBinding } from '@angular/core'
import { ConfigService } from 'tabby-core'

/** @hidden */
@Component({
    templateUrl: './rdpSettingsTab.component.pug',
})
export class RDPSettingsTabComponent {
    @HostBinding('class.content-box') true

    constructor (
        public config: ConfigService,
    ) { }
}
