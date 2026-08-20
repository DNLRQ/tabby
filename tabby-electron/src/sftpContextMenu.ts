import * as tmp from 'tmp-promise'
import * as fs from 'fs'
import { Subject, debounceTime, debounce } from 'rxjs'
import { Injectable } from '@angular/core'
import { ConfigService, MenuItemOptions, TranslateService } from 'tabby-core'
import { SFTPFile, SFTPPanelComponent, SFTPContextMenuItemProvider, SFTPSession } from 'tabby-ssh'
import { ElectronPlatformService, resolveInsideBase } from './services/platform.service'


/** @hidden */
@Injectable()
export class EditSFTPContextMenu extends SFTPContextMenuItemProvider {
    weight = 0

    constructor (
        private translate: TranslateService,
        private platform: ElectronPlatformService,
        private config: ConfigService,
    ) {
        super()
    }

    async getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]> {
        const items: MenuItemOptions[] = [
            {
                click: () => this.platform.setClipboard({
                    text: item.fullPath,
                }),
                label: this.translate.instant('Copy full path'),
            },
        ]
        if (!item.isDirectory) {
            items.push({
                click: () => this.edit(item, panel.sftp),
                label: this.translate.instant('Edit locally'),
            })
        }
        return items
    }

    private async edit (item: SFTPFile, sftp: SFTPSession) {
        const maxMB = this.config.store.ssh?.sftp?.editorMaxSizeMB ?? 5
        if (maxMB && item.size > maxMB * 1024 * 1024) {
            const proceed = (await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('This file is larger than {size} MB. Open it anyway?', { size: maxMB }),
                buttons: [
                    this.translate.instant('Open'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })).response === 0
            if (!proceed) {
                return
            }
        }

        const tempDir = (await tmp.dir({ unsafeCleanup: true })).path
        const tempPath = resolveInsideBase(tempDir, item.name)
        const transfer = await this.platform.startDownload(item.name, item.mode, item.size, tempPath)
        if (!transfer) {
            return
        }
        await sftp.download(item.fullPath, transfer)
        const openedAt = item.modified.getTime()
        const editorPath = this.config.store.ssh?.sftp?.editorPath?.trim()
        if (editorPath) {
            await this.platform.exec(editorPath, [tempPath])
        } else {
            this.platform.openPath(tempPath)
        }

        const events = new Subject<string>()
        fs.chmodSync(tempPath, 0o700)

        // skip the first burst of events
        setTimeout(() => {
            const watcher = fs.watch(tempPath, event => events.next(event))
            events.pipe(debounceTime(1000), debounce(async event => {
                if (event === 'rename') {
                    watcher.close()
                }
                try {
                    const current = await sftp.stat(item.fullPath)
                    if (current.modified.getTime() > openedAt) {
                        const overwrite = (await this.platform.showMessageBox({
                            type: 'warning',
                            message: this.translate.instant('This file changed on the server while it was open. Overwrite the remote file?'),
                            buttons: [
                                this.translate.instant('Overwrite'),
                                this.translate.instant('Cancel'),
                            ],
                            defaultId: 1,
                            cancelId: 1,
                        })).response === 0
                        if (!overwrite) {
                            return
                        }
                    }
                } catch { }
                const upload = await this.platform.startUpload({ multiple: false }, [tempPath])
                if (!upload.length) {
                    return
                }
                await sftp.upload(item.fullPath, upload[0])
                await sftp.chmod(item.fullPath, item.mode)
            })).subscribe()
            watcher.on('close', () => events.complete())
            sftp.closed$.subscribe(() => watcher.close())
        }, 1000)
    }
}
