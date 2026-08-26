import { Injectable, NgZone, OnDestroy, Type } from '@angular/core'
import { Subject } from 'rxjs'
import { FileTransfer } from '../api/platform'

function isLiveTransfer (transfer: FileTransfer): boolean {
    return !transfer.isComplete() && !transfer.isCancelled()
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class TransfersUIService implements OnDestroy {
    transfers: FileTransfer[] = []
    pageComponent: Type<unknown> | null = null
    isFullScreen = false
    changed$ = new Subject<void>()
    openRequested$ = new Subject<void>()
    private opener: (() => void) | null = null
    private sweeper: ReturnType<typeof setInterval> | null = null

    constructor (
        private zone: NgZone,
    ) { }

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
        this.ensureSweeper()
        this.changed$.next()
    }

    set (transfers: FileTransfer[]): void {
        this.transfers = transfers
        this.ensureSweeper()
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

    get activeTransfers (): FileTransfer[] {
        return this.transfers.filter(isLiveTransfer)
    }

    get activeCount (): number {
        return this.activeTransfers.length
    }

    ngOnDestroy (): void {
        this.stopSweeper()
    }

    private ensureSweeper (): void {
        if (!this.transfers.some(isLiveTransfer)) {
            this.prune()
            return
        }
        if (!this.sweeper) {
            this.sweeper = setInterval(() => this.prune(), 200)
        }
    }

    private prune (): void {
        const live = this.transfers.filter(isLiveTransfer)
        if (live.length === this.transfers.length) {
            if (!live.length) {
                this.stopSweeper()
            }
            return
        }
        this.zone.run(() => {
            this.transfers = live
            this.changed$.next()
        })
        if (!live.length) {
            this.stopSweeper()
        }
    }

    private stopSweeper (): void {
        if (this.sweeper) {
            clearInterval(this.sweeper)
            this.sweeper = null
        }
    }
}
