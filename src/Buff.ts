import type { Reader, Writer } from './types'

const SMALL_BUFFER_SIZE = 64

class SharedData {
	constructor(public buffer: ArrayBuffer) {}

	get byteLength() {
		return this.buffer.byteLength
	}
}

function mustNotNegative(n: number) {
	if (n < 0) {
		throw new RangeError('range must not negative')
	}
}

export class Buff implements Reader, Writer {
	static make(length: number, cap?: number) {
		if (cap === undefined) {
			cap = Math.max(length, SMALL_BUFFER_SIZE)
		} else if (length > cap) {
			throw new Error('length and capacity swapped')
		}

		const p = new ArrayBuffer(cap)
		return new Buff(p, 0, length)
	}

	static from(
		arrayLike: Iterable<number>,
		mapfn?: (v: number, k: number) => number,
		thisArg?: unknown,
	) {
		const p = Uint8Array.from(arrayLike, mapfn, thisArg)
		return new Buff(p.buffer)
	}

	#b: SharedData
	#o: number
	#l: number

	constructor(
		buffer: ArrayBuffer | SharedData,
		byteOffset = 0,
		byteLength?: number,
	) {
		byteOffset = Math.floor(byteOffset)
		if (byteOffset < 0) {
			throw new RangeError(
				`Start offset ${byteOffset} is outside the bounds of the buffer`,
			)
		}

		if (byteLength !== undefined) {
			byteLength = Math.floor(byteLength)
			const c = buffer.byteLength - byteOffset
			if (c < byteLength) {
				throw new RangeError(
					`span bounds out of range ${byteLength} with capacity ${c}`,
				)
			}
		}

		this.#b =
			buffer instanceof ArrayBuffer ? new SharedData(buffer) : buffer
		this.#o = byteOffset
		this.#l = byteLength ?? this.#b.byteLength - byteOffset
	}

	get buffer(): ArrayBuffer {
		return this.#b.buffer
	}

	get data() {
		return new Uint8Array(this.buffer, this.#o, this.#l)
	}

	get byteOffset() {
		return this.#o
	}

	get byteLength() {
		return this.#l
	}

	get length() {
		return this.#l
	}

	get capacity() {
		return this.buffer.byteLength - this.byteOffset
	}

	get BYTES_PER_ELEMENT() {
		return 1
	}

	[Symbol.iterator]() {
		return this.data[Symbol.iterator]()
	}

	attach(b: ArrayBuffer) {
		// if(!buffer.detached){
		// 	throw new Error('...')
		// }
		this.#b.buffer = ArrayBuffer.isView(b) ? b.buffer : b
	}

	get view() {
		return new DataView(this.buffer, this.byteOffset, this.byteLength)
	}

	#mustRange(n: number) {
		mustNotNegative(n)
		if (n > this.#l) {
			throw new RangeError('out of range')
		}
	}

	truncate(n: number): this {
		this.#mustRange(n)

		this.#l = Math.floor(n)
		return this
	}

	#drain(n: number): this {
		this.#o += n
		this.#l -= n
		return this
	}

	drain(n: number): this {
		this.#mustRange(n)

		this.#drain(Math.floor(n))
		return this
	}

	#grow(n: number): number {
		const m = this.#l
		if (m <= this.capacity - n) {
			this.#l += n
			return m
		}

		const c = this.#b.byteLength
		if (m <= c / 2 - n) {
			new Uint8Array(this.#b.buffer).set(this.data)
		} else {
			let l = this.#l + n
			if (l < 2 * c) {
				l = 2 * c
			}

			const b = new Uint8Array(l)
			b.set(this.data)
			this.#b.buffer = b.buffer
		}

		this.#o = 0
		this.#l += n
		return m
	}

	grow(n: number): this {
		mustNotNegative(n)
		this.#grow(n)
		return this
	}

	next(n: number): Buff {
		mustNotNegative(n)
		n = Math.floor(n)

		const l = Math.min(n, this.#l)
		const b = new Buff(this.#b, this.#o, l)
		this.#drain(n)

		return b
	}

	subarray(): Buff
	subarray(begin: number, end?: number): Buff
	subarray(begin?: number, end = this.#l): Buff {
		if (begin === undefined) {
			return new Buff(this.#b, this.#o, this.#l)
		}

		if (begin < 0) {
			begin = Math.max(this.#l + begin, 0)
		} else {
			begin = Math.min(begin, this.#l)
		}

		if (end < 0) {
			end = Math.max(this.#l + end, 0)
		} else {
			end = Math.min(end, this.#l)
		}

		const o = this.#o + begin
		const l = end - begin
		return new Buff(this.#b, o, l)
	}

	subbuff(begin: number, end = this.#l): Buff {
		mustNotNegative(begin)
		mustNotNegative(end)
		if (begin > end) {
			throw new RangeError(`invalid Buff indices: ${begin} < ${end}`)
		}
		if (end > this.capacity) {
			throw new RangeError(
				`span bounds out of range ${end} with capacity ${this.capacity}`,
			)
		}

		const o = this.#o + begin
		const l = end - begin
		return new Buff(this.#b, o, l)
	}

	async read(p: Span): Promise<number | null> {
		if (this.length === 0) {
			return null
		}

		// |src| <= |p|
		const src = this.data.subarray(0, p.length)
		p.data.set(src)

		this.#drain(src.length)
		return src.length
	}

	async write(p: Span): Promise<number | null> {
		const m = this.#grow(p.length)
		this.subarray(m, p.length).data.set(p.data)
		return p.length
	}
}

export type Span = Omit<
	Buff,
	'truncate' | 'drain' | 'next' | 'resize' | 'subarray' | 'subbuff' | 'read'
> & {
	subarray(): Span
	subarray(begin: number, end?: number): Span
	subarray(begin?: number, end?: number): Span
	subbuff(begin: number, end?: number): Span
}
