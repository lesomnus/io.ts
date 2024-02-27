import { describe, expect, it } from 'vitest'

import io from '.'

import { testReader } from './io.suite.test'

describe('Buff', () => {
	describe('constructor', () => {
		it('views over the given ArrayBuffer', () => {
			const d = Uint8Array.from(io.iota(5, 1))
			const b = new io.Buff(d.buffer, 1, 3)
			expect(b.byteOffset).toBe(1)
			expect(b.byteLength).toBe(3)
			expect(b.BYTES_PER_ELEMENT).toBe(1)
			expect(b.capacity).toBe(4)
			expect(b.data[0]).toBe(2)

			expect(b.length).toBe(b.byteLength)
		})

		it('throws RangeError if given offset is negative', () => {
			expect(() => new io.Buff(new ArrayBuffer(0), -1)).toThrowError(
				RangeError,
			)
		})

		it('throws RangeError if given length is greater than the capacity', () => {
			expect(() => new io.Buff(new ArrayBuffer(0), 2, 1)).toThrowError(
				RangeError,
			)
		})
	})

	describe('make', () => {
		it('allocates a buffer with a given size', () => {
			const b = io.Buff.make(4)
			expect(b.length).toBe(4)
			expect(b.capacity).greaterThanOrEqual(4)
		})

		it('allocates a buffer with a given capacity but only views a given length', () => {
			const b = io.Buff.make(2, 4)
			expect(b.length).toBe(2)
			expect(b.capacity).toBe(4)
		})

		it('throws if a given length is greater than a given capacity', () => {
			expect(() => io.Buff.make(4, 2)).toThrow()
		})
	})

	describe('grow', () => {
		it('does not reallocate if possible', () => {
			const d = io.iota(5, 1)
			const b = io.Buff.from(d).truncate(3)
			const buffer = b.buffer

			b.grow(2)
			expect(b.buffer).toBe(buffer)
			expect(b.length).toBe(5)
			expect([...b]).toEqual(d)
		})

		it('reallocates the buffer if necessary', () => {
			const d = io.iota(4, 1)
			const b = io.Buff.from(d)
			const buffer = b.buffer

			b.grow(2)
			expect(b.buffer).not.toBe(buffer)
			expect(b.length).toBe(4 + 2)
		})

		it('reuses the buffer if the buffer has capacity more than twice the required size', () => {
			const d = io.iota(8, 1)
			const b = io.Buff.from(d).drain(7)
			const buffer = b.buffer

			b.grow(3)
			expect(b.buffer).toBe(buffer)
			expect(b.length).toBe(8 - 7 + 3)
			expect([...b.subarray(0, 8 - 7)]).toEqual(io.iota(1, 8))
		})
	})

	describe('subarray', () => {
		it('creates a new io.Buff with different size but same buffer', () => {
			const b1 = io.Buff.from(io.iota(4, 1))
			const b2 = b1.subarray(1, 3)
			expect(b2).not.toBe(b1)
			expect(b2.buffer).toBe(b1.buffer)

			expect(b2.length).toBe(2)
			expect(b2.capacity).toBe(3)
			expect([...b2]).toEqual(io.iota(4, 1).slice(1, 3))
		})

		it('views all in the new io.Buff if no values are given', () => {
			const b1 = io.Buff.from(io.iota(4, 1))
			const b2 = b1.subarray()
			expect([...b2]).toEqual(io.iota(4, 1))
		})

		it('refers to an index from the end of the array if the given index is negative', () => {
			const b1 = io.Buff.from(io.iota(4, 1))
			const b2 = b1.subarray(-3, -2)
			expect([...b2]).toEqual(io.iota(4, 1).slice(-3, -2))
		})

		it('is limited to its length', () => {
			const b1 = io.Buff.from(io.iota(8, 1))
			const b2 = b1.subarray(1, 5).subarray(0, 42)
			expect(b2.buffer).toBe(b1.buffer)

			expect(b2.length).toBe(4)
			expect(b2.capacity).toBe(7)
			expect([...b2]).toEqual(io.iota(8, 1).slice(1, 5))
		})
	})

	describe('subbuff', () => {
		it('slices over its length', () => {
			const b1 = io.Buff.from(io.iota(8, 1))
			const b2 = b1.subarray(1, 5).subbuff(0, 7)
			expect(b2.buffer).toBe(b1.buffer)

			expect(b2.length).toBe(7)
			expect(b2.capacity).toBe(7)
			expect([...b2]).toEqual(io.iota(8, 1).slice(1))
		})

		describe('throws RangeError if out of range', () => {
			it.each([
				[-1, 0],
				[0, -1],
				[-1, -1],
				[0, 8],
				[1, 0],
			])('%d, %d', (a, b) => {
				const b1 = io.Buff.from(io.iota(8, 1))
				const b2 = b1.subarray(1, 5).subbuff(0, 6)
				expect(() => b2.subbuff(a, b)).toThrowError(RangeError)
			})
		})
	})

	describe('write', () => {
		it('grows as needed', async () => {
			const d = io.iota(42, 1)
			const b = io.Buff.make(0, 0)

			const n = await b.write(io.Buff.from(d))
			expect(n).toBe(d.length)
			expect(b.capacity).greaterThan(0)
			expect([...b]).toEqual(d)
		})
	})

	testReader(async () => {
		const d = io.iota(42, 1)
		const r = io.Buff.from(d)
		return [new Uint8Array(d), r] as const
	})
})
