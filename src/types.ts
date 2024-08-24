import type { Span } from './Buff'

export interface Reader {
	read(p: Span): Promise<number | null>
}

export interface Writer {
	write(p: Span): Promise<number | null>
}

export interface Closer extends AsyncDisposable {
	close(): Promise<void>
}

export interface Slicer {
	slice(start?: number, end?: number): Promise<Reader & Slicer & Closer>
}
