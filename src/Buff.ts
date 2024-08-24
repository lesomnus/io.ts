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

/**
 * Variable sized buffer of bytes.
 * It uses {@link ArrayBuffer} as an underlying buffer so it simply a view over the `ArrayBuffer` like {@link Uint8Array}.
 *
 * ```
 *   offset   length
 * |<------>|<------>|
 * |........(........).....| <~ underlying buffer
 *          |<------------>|
 *              capacity
 * ```
 */
export class Buff implements Reader, Writer {
	/**
	 * Creates a new `Buff`.
	 *
	 * @example
	 * ```ts
	 * const b = Buff.make(10)
	 * console.log(b.length)   // 10
	 * console.log(b.capacity) // 64
	 * ```
	 *
	 * @param length Length of the buffer.
	 * @param cap Capacity of the buffer. Defaults to the greater of `length` or `SMALL_BUFFER_SIZE`.
	 * @throws An `Error` if `length > cap`.
	 *
	 * @see {@link Buff:constructor} to use your own underlying buffer.
	 * @see {@link Buff.from} to create a new `Buff` from an array-like or iterable object.
	 */
	static make(length: number, cap?: number) {
		if (cap === undefined) {
			cap = Math.max(length, SMALL_BUFFER_SIZE)
		} else if (length > cap) {
			throw new Error('length and capacity swapped')
		}

		const p = new ArrayBuffer(cap)
		return new Buff(p, 0, length)
	}

	/**
	 * Creates a new `Buff` from an array-like of iterable object.
	 *
	 * @param arrayLike An iterable or array-like object to convert to a `Buff`.
	 * @param mapfn A function to call on every element of the `Buff`.
	 * If provided, every value to be added to the array is first passed through this function,
	 * and `mapFn`'s return value is added to the `Buff` instead.
	 * @param thisArg Value to use as this when executing `mapFn`.
	 *
	 * @see {@link Uint8Array.from} for details.
	 */
	static from(arrayLike: Iterable<number>, mapfn?: (v: number, k: number) => number, thisArg?: unknown) {
		const p = Uint8Array.from(arrayLike, mapfn, thisArg)
		return new Buff(p.buffer)
	}

	#b: SharedData // underlying buffer
	#o: number // offset
	#l: number // length

	/**
	 * Creates new `Buff` with `buffer` as an underlying buffer, and use portion of the
	 * buffer specified by optional `offset` and `length` arguments.
	 * If `offset` and `length` is not given, all buffer is viewed.
	 * Unlike {@link Uint8Array}, it does not track length of the underlying buffer.
	 *
	 * @param buffer An underlying buffer.
	 * @param offset Offset for the buffer.
	 * @param length Length of `Buff` to create.
	 */
	constructor(buffer: ArrayBuffer | SharedData, offset = 0, length?: number) {
		offset = Math.floor(offset)
		if (offset < 0) {
			throw new RangeError(`start offset ${offset} is outside the bounds of the buffer`)
		}

		if (length !== undefined) {
			length = Math.floor(length)
			const c = buffer.byteLength - offset
			if (c < length) {
				throw new RangeError(`span bounds out of range ${length} with capacity ${c}`)
			}
		}

		this.#b = buffer instanceof ArrayBuffer ? new SharedData(buffer) : buffer
		this.#o = offset
		this.#l = length ?? this.#b.byteLength - offset
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

	get offset() {
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

	// TODO: it does not look safe
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
			//      |<--l-->|-n->|
			// |....(............)....|
			this.#l += n
			return m
		}

		const c = this.#b.byteLength
		if (m <= c / 2 - n) {
			// Reused the buffer if its capacity is more than twice the size of the required size.
			//
			//                    |<--l-->|-n->| <~ overflow
			// |..................(.......)..|
			// (............)................| <~ use same buffer
			// |<--l-->|-n->|
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
			throw new RangeError(`span bounds out of range ${end} with capacity ${this.capacity}`)
		}

		const o = this.#o + begin
		const l = end - begin
		return new Buff(this.#b, o, l)
	}

	read(p: Span): Promise<number | null> {
		if (this.length === 0) {
			return Promise.resolve(null)
		}

		// |src| <= |p|
		const src = this.data.subarray(0, p.length)
		p.data.set(src)

		this.#drain(src.length)
		return Promise.resolve(src.length)
	}

	write(p: Span): Promise<number | null> {
		const m = this.#grow(p.length)
		this.subarray(m, p.length).data.set(p.data)
		return Promise.resolve(p.length)
	}
}

export type Span = Omit<Buff, 'truncate' | 'drain' | 'next' | 'resize' | 'subarray' | 'subbuff' | 'read'> & {
	subarray(): Span
	subarray(begin: number, end?: number): Span
	subarray(begin?: number, end?: number): Span
	subbuff(begin: number, end?: number): Span
}

export function make(length: number, cap?: number): Span {
	return Buff.make(length, cap) as Span
}

export function from(arrayLike: Iterable<number>, mapfn?: (v: number, k: number) => number, thisArg?: unknown): Span {
	return Buff.from(arrayLike, mapfn, thisArg)
}
