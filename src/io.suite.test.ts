import { describe, expect, test } from 'vitest'

import io from '.'

type SbjGetter<T> = () => Promise<readonly [Uint8Array, T]>

export function testReader(getSubject: SbjGetter<io.Reader>) {
	describe('reader', async () => {
		test('read all at once', async () => {
			const [d, r] = await getSubject()
			const b = io.Buff.make(d.length + 1)

			await expect(r.read(b)).resolves.toBe(d.length)
			expect([...b.subarray(0, d.length)]).toEqual([...d])

			await expect(r.read(b)).resolves.toBeNull()
		})

		test('read partially', async () => {
			const [d, r] = await getSubject()
			expect(d.length).toBeGreaterThan(9)

			const n = Math.floor(d.length / 2) - 1
			const b = io.Buff.make(n)

			// Read data three times. The first two reads fill the buffer,
			// but the last read does not fill the buffer.
			//
			// Royale•with•Cheese↵Le•big•Mac↵
			// ^            ^              ^ ^
			// 0            14            28 30

			await expect(r.read(b)).resolves.toBe(n)
			expect([...b]).toEqual([...d.slice(n * 0, n * 1)])

			await expect(r.read(b)).resolves.toBe(n)
			expect([...b]).toEqual([...d.slice(n * 1, n * 2)])

			const rest = d.length % n
			await expect(r.read(b)).resolves.toBe(rest)
			expect([...b.subarray(0, rest)]).toEqual([...d.slice(n * 2)])

			await expect(r.read(b)).resolves.toBeNull()
		})
	})
}

function testSlicer_(getSubject: SbjGetter<io.Slicer>) {
	describe('slice from the beginning to the end', async () => {
		testReader(async () => {
			const [d, s] = await getSubject()
			const r = await s.slice()
			return [d, r]
		})
	})

	describe('slice from the beginning to the middle', async () => {
		testReader(async () => {
			const [d, s] = await getSubject()
			const n = d.length / 2
			const d_ = d.subarray(0, n)
			const r = await s.slice(0, n)
			return [d_, r]
		})
	})

	describe('slice from the middle to the end', async () => {
		testReader(async () => {
			const [d, s] = await getSubject()
			const d_ = d.subarray(3)
			const r = await s.slice(3)
			return [d_, r]
		})
	})

	describe('slice the middle', async () => {
		testReader(async () => {
			const [d, s] = await getSubject()
			const n = d.length - 3
			const d_ = d.subarray(3, n)
			const r = await s.slice(3, n)
			return [d_, r]
		})
	})
}

export function testSlicer(getSubject: SbjGetter<io.Slicer>) {
	describe('slicer', () => {
		testSlicer_(getSubject)

		describe('nested', () => {
			testSlicer_(async () => {
				const [d, s] = await getSubject()
				const n = d.length - 3
				const d_ = d.subarray(3, n)
				const s_ = await s.slice(3, n)
				return [d_, s_]
			})
		})
	})
}
