import type { Span } from './Buff'

export interface Reader {
	read(p: Span): Promise<number | null>
}

export interface Writer {
	close(): Promise<void>
}

export interface Closer {
	close(): Promise<void>
}

export interface Slicer {
	slice(start?: number, end?: number): Promise<Reader & Slicer & Closer>
}
