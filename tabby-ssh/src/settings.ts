import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'

import { SSHSettingsTabComponent } from './components/sshSettingsTab.component'
import { SFTPSettingsTabComponent } from './components/sftpSettingsTab.component'
import { TranslateService } from 'tabby-core'

/** @hidden */
@Injectable()
export class SSHSettingsTabProvider extends SettingsTabProvider {
    id = 'ssh'
    icon = 'globe'
    title = 'SSH'

    getComponentType (): any {
        return SSHSettingsTabComponent
    }
}

/** @hidden */
@Injectable()
export class SFTPSettingsTabProvider extends SettingsTabProvider {
    id = 'sftp'
    icon = 'folder-open'
    title = this.translate.instant('SFTP')

    constructor (private translate: TranslateService) { super() }

    getComponentType (): any {
        return SFTPSettingsTabComponent
    }
}
