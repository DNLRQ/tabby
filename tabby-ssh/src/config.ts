import { ConfigProvider } from 'tabby-core'

/** @hidden */
export class SSHConfigProvider extends ConfigProvider {
    defaults = {
        ssh: {
            warnOnClose: false,
            winSCPPath: null,
            agentType: 'auto',
            agentPath: null,
            x11Display: null,
            knownHosts: [],
            verifyHostKeys: true,
            sftp: {
                viewMode: 'grid',
                showHidden: false,
                openOn: 'doubleClick',
                multiSelect: true,
                dragAndDrop: true,
                showDownloadButton: true,
                startDirectory: '~',
                editorPath: '',
                editorMaxSizeMB: 5,
                transfersAutoShow: true,
            },
        },
        hotkeys: {
            'restart-ssh-session': [],
            'launch-winscp': [],
            'open-sftp': [],
        },
    }

    platformDefaults = { }
}
