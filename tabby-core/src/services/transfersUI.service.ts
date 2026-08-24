import { Injectable, Type } from '@angular/core'
import { Subject } from 'rxjs'
import { FileTransfer } from '../api/platform'

/** @hidden */
@Injectable({ providedIn: 'root' })
export class TransfersUIService {
    transfers: FileTransfer[] = []
    pageComponent: Type<unknown> | null = null
    isFullScreen = false
    changed$ = new Subject<void>()
    openRequested$ = new Subject<void>()
    private opener: (() => void) | null = null

    get hasWindow (): boolean {
        return !!this.opener || !!this.pageComponent
    }

    registerPage (component: Type<unknown> | null): void {
        this.pageComponent = component
        this.changed$.next()
    }

    registerOpener (opener: (() => void) | null): void {
        this.opener = opener
    }

    add (transfer: FileTransfer): void {
        this.transfers.push(transfer)
        this.changed$.next()
    }

    set (transfers: FileTransfer[]): void {
        this.transfers = transfers
        this.changed$.next()
    }

    open (): void {
        this.toggleFullScreen()
    }

    openFullScreen (): void {
        this.isFullScreen = true
        this.changed$.next()
    }

    closeFullScreen (): void {
        this.isFullScreen = false
        this.changed$.next()
    }

    toggleFullScreen (): void {
        this.isFullScreen = !this.isFullScreen
        this.changed$.next()
    }

    get activeCount (): number {
        return this.transfers.filter(transfer => !transfer.isComplete() && !transfer.isCancelled()).length
    }
}
