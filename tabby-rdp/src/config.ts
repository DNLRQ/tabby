import { ConfigProvider } from 'tabby-core'

/** @hidden */
export class RDPConfigProvider extends ConfigProvider {
    defaults = {
        rdp: {
            warnOnClose: false,
        },
        hotkeys: {
            'restart-rdp-session': [],
        },
    }

    platformDefaults = { }
}
