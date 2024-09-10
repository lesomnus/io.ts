import io from '~/.'

/**
 * `offset` cannot be greater then `length`.
 *
 * ```
 * |<------capacity------>|
 * |................).....| <~ underlying buffer
 * |<----length---->|
 * |<-offset->|     ^
 *            ^     Where the data is written.
 *            Where the data to be read/written.
 * ```
 */
export class Block implements io.Reader, io.Writer, io.Seeker {
	static Size = 64 << 10 // 64KiB

	#l: number
	#o = 0

	constructor(public data: Uint8Array = new Uint8Array()) {
		this.#l = data.length
	}

	get length(): number {
		return this.#l
	}

	get capacity(): number {
		return this.data.length
	}

	get available(): number {
		return this.capacity - this.#o
	}

	read(p: io.Span): Promise<number | null> {
		const l = this.#l
		const o = this.#o
		if (l <= o) {
			return Promise.resolve(null)
		}

		// |src| <= |p|
		const end = Math.min(l, o + p.length)
		const src = this.data.subarray(o, end)
		p.data.set(src)

		this.#o = end
		return Promise.resolve(src.length)
	}

	write(p: io.Span): Promise<number | null> {
		const o = this.#o
		if (o >= Block.Size) {
			return Promise.resolve(null)
		}

		let c = this.capacity
		let r = c - o
		if (r < p.length) {
			c = Math.min(Block.Size, o + p.length)
			const d = new Uint8Array(c)
			d.set(this.data)
			this.data = d

			r = c - o
		}

		const src = this.data.subarray(o)
		src.set(p.data.subarray(0, src.length))

		const n = Math.min(r, p.length)
		this.#l = Math.max(o + n, this.#l)
		this.#o += n
		return Promise.resolve(n)
	}

	seek(offset: number, whence: io.Seek = io.Seek.Start): Promise<number> {
		let i: number
		switch (whence) {
			case io.Seek.Start:
				i = 0
				break

			case io.Seek.Current:
				i = this.#o
				break

			case io.Seek.End:
				i = this.#l
				break

			default:
				throw new Error('unknown whence')
		}

		const o = i + offset
		if (!(0 <= o && o <= this.#l)) {
			return Promise.reject(new Error('out of range'))
		}

		this.#o = o
		return Promise.resolve(o)
	}
}
