import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { ToastrModule } from 'ngx-toastr'
import TabbyCoreModule, { ConfigProvider, TabRecoveryProvider, HotkeyProvider, TabContextMenuItemProvider, ProfileProvider } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

import { RDPProfileSettingsComponent } from './components/rdpProfileSettings.component'
import { RDPTabComponent } from './components/rdpTab.component'
import { RDPSettingsTabComponent } from './components/rdpSettingsTab.component'

import { RDPConfigProvider } from './config'
import { RDPSettingsTabProvider } from './settings'
import { RecoveryProvider } from './recoveryProvider'
import { RDPHotkeyProvider } from './hotkeys'
import { RDPProfilesService } from './profiles'
import { RDPContextMenu } from './tabContextMenu'

/** @hidden */
@NgModule({
    imports: [
        NgbModule,
        CommonModule,
        FormsModule,
        ToastrModule,
        TabbyCoreModule,
    ],
    providers: [
        { provide: ConfigProvider, useClass: RDPConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: RDPSettingsTabProvider, multi: true },
        { provide: TabRecoveryProvider, useClass: RecoveryProvider, multi: true },
        { provide: HotkeyProvider, useClass: RDPHotkeyProvider, multi: true },
        { provide: TabContextMenuItemProvider, useClass: RDPContextMenu, multi: true },
        { provide: ProfileProvider, useExisting: RDPProfilesService, multi: true },
    ],
    declarations: [
        RDPProfileSettingsComponent,
        RDPTabComponent,
        RDPSettingsTabComponent,
    ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export default class RDPModule { }

export * from './api'
export { RDPTabComponent }
export { PasswordStorageService } from './services/passwordStorage.service'
