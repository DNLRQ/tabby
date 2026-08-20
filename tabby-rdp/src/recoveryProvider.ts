import { Injectable, Injector } from '@angular/core'
import { TabRecoveryProvider, NewTabParameters, RecoveryToken, ProfilesService } from 'tabby-core'
import { RDPTabComponent } from './components/rdpTab.component'

/** @hidden */
@Injectable()
export class RecoveryProvider extends TabRecoveryProvider<RDPTabComponent> {
    constructor (private injector: Injector) { super() }

    async applicableTo (recoveryToken: RecoveryToken): Promise<boolean> {
        return recoveryToken.type === 'app:rdp-tab'
    }

    async recover (recoveryToken: RecoveryToken): Promise<NewTabParameters<RDPTabComponent>> {
        return {
            type: RDPTabComponent,
            inputs: {
                profile: this.injector.get(ProfilesService).getConfigProxyForProfile(recoveryToken.profile),
            },
        }
    }
}
