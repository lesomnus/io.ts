import io from '~/.'

import { Block } from './block'

const D = new TextEncoder().encode('Royale with Cheese\nLe big Mac\n')

describe('Block', () => {
	it('reads from where the end of last read or write', async () => {
		const d = D.slice()
		const b = io.make(5)
		const block = new Block(d)
		await block.seek(0)

		// Royale•with•Cheese↵Le•big•Mac↵
		//   ^    ^    ^
		//   w    r    r

		await block.write(io.Buff.from(io.iota(3, 42)))
		await block.read(b)
		expect([...b]).to.eql([...d.slice(3, 3 + 5)])

		await block.read(b)
		expect([...b]).to.eql([...d.slice(8, 8 + 5)])
	})
	it('writes from where the end of last read or write', async () => {
		const d = D.slice()
		const b = io.make(5)
		const block = new Block(d)
		await block.seek(0)

		// Royale•with•Cheese↵Le•big•Mac↵
		//     ^  ^  ^
		//     r  w  w

		await block.read(b)
		await block.write(io.Buff.from(io.iota(3, 42)))
		expect([...d.slice(5, 5 + 3)]).to.eql([...io.iota(3, 42)])

		await block.write(io.Buff.from(io.iota(3, 36)))
		expect([...d.slice(8, 8 + 3)]).to.eql([...io.iota(3, 36)])
	})
	test('read/write data larger than the block size', async () => {
		const d = io.iota(Block.Size * 1.5).map(v => v % 0xff)
		const block = new Block()

		let n = await block.write(io.from(d))
		expect(n).to.eq(Block.Size)

		const p = io.make(d.length)
		await block.seek(0)
		n = await block.read(p)
		expect(n).to.eq(Block.Size)
		expect([...p.subbuff(0, Block.Size)]).to.eql(d.slice(0, Block.Size))
	})
})
