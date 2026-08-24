import { Injectable } from '@angular/core'
import { Subject } from 'rxjs'
import { FileTransfer } from 'tabby-core'

export type SFTPTransferDirection = 'upload' | 'download' | 'edit-load' | 'edit-save' | 'copy'
export type SFTPTransferStatus = 'success' | 'error' | 'cancelled'

export interface SFTPTransferLogChild {
    name: string
    remotePath: string
    status: SFTPTransferStatus
    bytes: number
    error?: string
}

export interface SFTPTransferLogEntry {
    id: string
    time: number
    name: string
    remotePath: string
    host: string
    direction: SFTPTransferDirection
    status: SFTPTransferStatus
    bytes: number
    error?: string
    children?: SFTPTransferLogChild[]
    startedAt?: number
    duration?: number
    sourceHost?: string
    destHost?: string
}

const STORAGE_KEY = 'sftpTransferLog'
const MAX_ENTRIES = 200

export class RemoteCopyTransfer extends FileTransfer {
    constructor (
        private label: string,
        private size: number,
    ) {
        super()
        this.pausable = true
        this.setTotalSize(size)
    }

    getName (): string {
        return this.label
    }

    getSize (): number {
        return this.size
    }

    close (): void { }
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class SFTPTransfersService {
    changed$ = new Subject<void>()
    private log: SFTPTransferLogEntry[] = []

    constructor () {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY)
            this.log = stored ? JSON.parse(stored) : []
        } catch {
            this.log = []
        }
    }

    getLog (host?: string): SFTPTransferLogEntry[] {
        if (!host) {
            return this.log
        }
        return this.log.filter(entry => entry.host === host)
    }

    record (entry: Omit<SFTPTransferLogEntry, 'id' | 'time'> & Partial<Pick<SFTPTransferLogEntry, 'id' | 'time'>>): void {
        this.log.unshift({
            id: entry.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time: entry.time ?? Date.now(),
            ...entry,
        })
        this.log = this.log.slice(0, MAX_ENTRIES)
        this.persist()
    }

    clear (host?: string): void {
        this.log = host ? this.log.filter(entry => entry.host !== host) : []
        this.persist()
    }

    exportJSON (host?: string): string {
        return JSON.stringify(this.getLog(host), null, 2)
    }

    private persist (): void {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.log))
        this.changed$.next()
    }
}
