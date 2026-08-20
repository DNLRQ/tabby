import { Injectable } from '@angular/core'
import { Subject } from 'rxjs'

export type SFTPTransferDirection = 'upload' | 'download' | 'edit-load' | 'edit-save'
export type SFTPTransferStatus = 'success' | 'error' | 'cancelled'

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
}

const STORAGE_KEY = 'sftpTransferLog'
const MAX_ENTRIES = 200

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

    getLog (): SFTPTransferLogEntry[] {
        return this.log
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

    clear (): void {
        this.log = []
        this.persist()
    }

    exportJSON (): string {
        return JSON.stringify(this.log, null, 2)
    }

    private persist (): void {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.log))
        this.changed$.next()
    }
}
