import io from '~/.'
import fs from '.'
import { Block } from './block'

const F = fs.OpenFlag
const D = new TextEncoder().encode('Royale with Cheese\nLe big Mac\n')

type TestCase = [string, (flag: fs.OpenFlag) => Promise<fs.File>]
const testCases: TestCase[] = [['memfs', provide(() => new fs.MemFs())]]

function provide(ctor: () => fs.Fs) {
	let fsys: fs.Fs | undefined
	return (flag: fs.OpenFlag) => {
		if (!fsys) {
			fsys = ctor()
			onTestFinished(() => {
				fsys = undefined
			})
		}

		return fsys.openFile('foo', flag)
	}
}

async function using<T extends AsyncDisposable, U>(vs: [...Promise<T>[]], f: (...vs: [...T[]]) => Promise<U>) {
	const ws = await Promise.all(vs)
	return f(...ws).finally(async () => {
		ws.reverse()
		for (const w of ws) {
			await w[Symbol.asyncDispose]()
		}
	})
}

describe.each(testCases)('%s', (_, open) => {
	test('flag Read reads an existing file from the start', async () => {
		await using([open(F.Write)], f => f.write(io.from(D)))

		const p = await using([open(F.Read)], f => io.readAll(f))
		expect([...p]).to.eql([...D])
	})
	test('flag Read fails if the file does not exist', async () => {
		const op = () => open(F.Read)
		await expect(op).rejects.toThrow(fs.ErrNotExist)
	})
	test('flag Read|Write reads an existing file from the start', async () => {
		await using([open(F.Write)], f => f.write(io.from(D)))

		const p = await using([open(F.Read | F.Write)], f => io.readAll(f))
		expect([...p]).to.eql([...D])
	})
	test('flag Read|Write fails if the file does not exist', async () => {
		const op = () => open(F.Read | F.Write)
		await expect(op).rejects.toThrow(fs.ErrNotExist)
	})
	test('flag Read|Write|Append opens an existing file with append mode', async () => {
		await using([open(F.Write)], f => f.write(io.from(D.slice(0, 2))))
		await using([open(F.Read | F.Write | F.Append)], async f => {
			await f.seek(1, io.Seek.Start)
			await f.write(io.from(D.slice(2)))
		})

		const p = await using([open(F.Read)], f => io.readAll(f))
		expect([...p]).to.eql([...D])
	})
	test('flag Read|Write|Append a non-exist file fails', async () => {
		const op = () => open(F.Read | F.Write | F.Append)
		await expect(op).rejects.toThrow(fs.ErrNotExist)
	})
	test('flag Read|Write|Trunc truncates an existing file ', async () => {
		await using([open(F.Write)], f => f.write(io.from(D)))
		await using([open(F.Read | F.Write | F.Trunc)], f => f.write(io.from(D)))

		const p = await using([open(F.Read)], f => io.readAll(f))
		expect([...p]).to.eql([...D])
	})
	test('flag Read|Write|Trunc a non-exist file fails', async () => {
		const op = () => open(F.Read | F.Write | F.Trunc)
		await expect(op).rejects.toThrow(fs.ErrNotExist)
	})
	test('flag Read|Write|AtEnd opens an existing file and seek to the end', async () => {
		await using([open(F.Write)], f => f.write(io.from(D.slice(0, 2))))
		await using([open(F.Read | F.Write | F.AtEnd)], f => f.write(io.from(D.slice(2))))

		const p = await using([open(F.Read)], f => io.readAll(f))
		expect([...p]).to.eql([...D])
	})
	test('flag Read|Write|AtEnd a non-exist file fails', async () => {
		const op = () => open(F.Read | F.Write | F.AtEnd)
		await expect(op).rejects.toThrow(fs.ErrNotExist)
	})
	test('flag Write creates a file if it does not exist', async () => {
		const op = using([open(F.Write)], async f => true)
		await expect(op).resolves.ok
	})
	test('flag Write replaces a file if it already exist', async () => {
		const d = [1, 2]

		await using([open(F.Write)], f => f.write(io.from(D)))
		await using([open(F.Write)], f => f.write(io.from(d)))

		const p = await using([open(F.Read)], f => io.readAll(f))
		expect([...p]).to.eql(d)
	})
	test('flag Write replaces a file even if the file is busy', async () => {
		const f1 = await open(F.Write)
		await f1.write(io.from([1, 2]))

		const op = open(F.Write)
		await expect(op).resolves.ok

		const f2 = await op
		await f1.write(io.from([3, 4])) // f1 still hold an old file.
		await f2.write(io.from(D))
		await f1.close()
		await f2.close()

		const p = await using([open(F.Read)], f => io.readAll(f))
		expect([...p]).to.eql([...D])
	})
	test('flag Write|NoReplace creates a file if it does not exist', async () => {
		const op = using([open(F.Write | F.NoReplace)], async f => true)
		await expect(op).resolves.ok
	})
	test('flag Write|NoReplace fails if the file already exist', async () => {
		await using([open(F.Write)], async f => true)

		const op = () => open(F.Write | F.NoReplace)
		await expect(op).rejects.toThrow(fs.ErrExist)
	})

	test('read/write data larger than the block size in multiple parts', async () => {
		const d = io.iota(Block.Size * 1.5).map(v => v % 0xff)

		await using([open(F.Write)], f => io.copy(f, io.Buff.from(d)))
		const b = await using([open(F.Read)], f => io.readAll(f))
		expect(b.data.every((v, i) => d[i] === v)).to.be.true
	})
	test('read/write data larger than the block size at once', async () => {
		const d = io.iota(Block.Size * 1.5).map(v => v % 0xff)
		const p = io.make(d.length)

		await using([open(F.Write)], f => f.write(io.Buff.from(d)))
		await using([open(F.Read)], f => f.read(p))
		expect(p.data.every((v, i) => d[i] === v)).to.be.true
	})
	test('overwrite on the existing blocks before close', async () => {
		const d = io.iota(Block.Size * 1.5).map(v => v % 0xff)

		await using([open(F.Write)], async f => {
			await io.copy(f, io.Buff.from(d))

			d.reverse()
			await f.seek(0, io.Seek.Start)
			await io.copy(f, io.Buff.from(d))
		})

		const b = await using([open(F.Read)], f => io.readAll(f))
		expect(b.data.every((v, i) => d[i] === v)).to.be.true
	})
	test('overwrite on the existing blocks after close', async () => {
		const d = io.iota(Block.Size * 1.5).map(v => v % 0xff)

		await using([open(F.Write)], f => io.copy(f, io.Buff.from(d)))
		await using([open(F.Read | F.Write)], async f => {
			d.reverse()
			await io.copy(f, io.Buff.from(d))
		})

		const b = await using([open(F.Read)], f => io.readAll(f))
		expect(b.data.every((v, i) => d[i] === v)).to.be.true
	})
})
