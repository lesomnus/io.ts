import type { Span } from './Buff'
import type { Seek } from './constants'

export interface Reader {
	read(p: Span): Promise<number | null>
}

export interface Writer {
	write(p: Span): Promise<number | null>
}

export interface Closer extends AsyncDisposable {
	close(): Promise<void>
}

export interface Seeker {
	seek(offset: number, whence?: Seek): Promise<number>
}
