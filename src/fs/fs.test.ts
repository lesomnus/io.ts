import io from '~/.'
import fs from '.'

type TestCase = [string, () => Promise<fs.Fs>]
const testCases: TestCase[] = [
	//
	['memfs', () => Promise.resolve(new fs.MemFs())],
]
if (expect.getState().environment === 'browser') {
	testCases.push([
		'idbfs',
		async () => {
			const name = Math.random().toString(36).substring(2, 12)
			const fsys = await fs.newIdbFs(name)
			onTestFinished(() => fsys.delete())
			return fsys
		},
	])
}

// TODO: how to make T to be variadic within Promise<T>?
async function using<T extends AsyncDisposable, U>(vs: [...Promise<T>[]], f: (...vs: [...T[]]) => Promise<U>) {
	const ws = await Promise.all(vs)
	return f(...ws).finally(async () => {
		ws.reverse()
		for (const w of ws) {
			await w[Symbol.asyncDispose]()
		}
	})
}

describe.each(testCases)('%s', (_, make) => {
	test('create', async () => {
		const fsys = await make()

		const data = [0x12, 0x34]
		await using([fsys.create('foo')], async f => f.write(io.from(data)))

		await using([fsys.open('foo')], async f => {
			const b = await io.readAll(f)
			expect([...b]).to.eql([...data])
		})
	})
	test('mkdir', async () => {
		const fsys = await make()

		await fsys.mkdir('foo', 0o750 as fs.FileMode)

		const info = await fsys.stat('foo')
		expect(info.isDir).to.be.true
	})
	test('mkdirAll', async () => {
		const fsys = await make()

		const mode = 0o750 as fs.FileMode
		await fsys.mkdir('foo', mode)
		await fsys.mkdirAll('foo/bar/baz', mode)

		const info = await fsys.stat('foo/bar/baz')
		expect(info.isDir).to.be.true
	})
	test('file is opened with the cursor at the beginning of the file', async () => {
		const fs = await make()

		const data = [0x12, 0x34]
		await using([fs.create('foo')], f => f.write(io.from(data)))

		await using([fs.open('foo')], async f => {
			const b = await io.readAll(f)
			expect([...b]).to.eql([...data])
		})
		await using([fs.open('foo')], async f => {
			const b = await io.readAll(f)
			expect([...b]).to.eql([...data])
		})
	})
	test('file is opened with its own cursor', async () => {
		const fsys = await make()

		const data = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]
		await using([fsys.create('foo')], async f => f.write(io.from(data)))

		await using(
			[
				fsys.open('foo'), //
				fsys.open('foo'),
			],
			async (f1, f2) => {
				const b1 = io.make(3)
				const b2 = io.make(2)

				await io.readFull(f1, b1)
				await io.readFull(f2, b2)
				expect([...b1]).to.eql([...data].slice(0, 3))
				expect([...b2]).to.eql([...data].slice(0, 2))

				await io.readFull(f1, b1)
				await io.readFull(f2, b2)
				expect([...b1]).to.eql([...data].slice(3, 6))
				expect([...b2]).to.eql([...data].slice(2, 4))
			},
		)
	})
	test('open a file that does not exist', async () => {
		const fsys = await make()

		const op = () => fsys.open('not-exists')
		await expect(op).rejects.toThrow(fs.ErrNotExist)
	})
	test('open a directory', async () => {
		const fsys = await make()

		await fsys.mkdir('foo')

		await using([fsys.open('foo')], async f => {
			const info = await f.stat()
			expect(info.isDir).to.be.true
		})
		await using([fsys.open('foo')], async f => {
			const op = () => f.read(io.make(2))
			await expect(op).rejects.toThrow(fs.ErrDirectory)
		})
	})
	test('readDir a directory', async () => {
		const fs = await make()

		const mode = 0o750 as fs.FileMode
		await fs.mkdirAll('foo/bar', mode)
		await fs.mkdirAll('foo/baz', mode)

		const names: string[] = []
		for await (const e of fs.readDir('foo')) {
			names.push(e.name)
		}
		expect(names).to.contain('bar')
		expect(names).to.contain('baz')
	})
	test('rename a regular file to a new name', async () => {
		const fsys = await make()

		const data = [0x12, 0x34]
		await using([fsys.create('foo')], f => f.write(io.from(data)))

		await fsys.rename('foo', 'bar')
		await expect(() => fsys.stat('foo')).rejects.toThrow(fs.ErrNotExist)

		await using([fsys.open('bar')], async f => {
			const b = await io.readAll(f)
			expect([...b]).to.eql([...data])
		})
	})
	test('rename a regular file to an existing name that is a regular file', async () => {
		const fsys = await make()

		const data = [0x12, 0x34]
		await using([fsys.create('foo')], f => f.write(io.from(data)))
		await using([fsys.create('bar')], f => f.write(io.from([0x56, 0x78])))

		await fsys.rename('foo', 'bar')
		await expect(() => fsys.stat('foo')).rejects.toThrow(fs.ErrNotExist)

		await using([fsys.open('bar')], async f => {
			const b = await io.readAll(f)
			expect([...b]).to.eql([...data])
		})
	})
	test('rename a regular file to an existing name that is a directory', async () => {
		const fsys = await make()

		const data = [0x12, 0x34]
		await using([fsys.create('foo')], f => f.write(io.from(data)))
		await fsys.mkdir('bar')

		const op = () => fsys.rename('foo', 'bar')
		await expect(op).rejects.toThrow(fs.ErrDirectory)
	})
	test('rename a directory to a new name', async () => {
		const fsys = await make()

		await fsys.mkdir('foo')

		await fsys.rename('foo', 'bar')
		await expect(() => fsys.stat('foo')).rejects.toThrow(fs.ErrNotExist)

		const info = await fsys.stat('bar')
		expect(info.isDir).to.be.true
	})
	test('rename a directory to an existing name that is a regular file', async () => {
		const fsys = await make()

		await fsys.mkdir('foo')
		await using([fsys.create('bar')], f => f.write(io.from([0x56, 0x78])))

		const op = () => fsys.rename('foo', 'bar')
		await expect(op).rejects.toThrow(fs.ErrNotDirectory)
	})
	test('rename a directory to an existing name that is an empty directory', async () => {
		const fsys = await make()

		const data = [0x12, 0x34]
		await fsys.mkdir('foo')
		await fsys.mkdir('bar')
		await using([fsys.create('foo/baz')], f => f.write(io.from(data)))

		await fsys.rename('foo', 'bar')
		await expect(() => fsys.stat('foo')).rejects.toThrow(fs.ErrNotExist)

		await using([fsys.open('bar/baz')], async f => {
			const b = await io.readAll(f)
			expect([...b]).to.eql([...data])
		})
	})
	test('rename a directory to an existing name that is a non-empty directory', async () => {
		const fsys = await make()

		const data = [0x12, 0x34]
		await fsys.mkdir('foo')
		await fsys.mkdir('bar')
		await using([fsys.create('foo/baz')], f => f.write(io.from(data)))
		await using([fsys.create('bar/qux')], f => f.write(io.from(data)))

		const op = () => fsys.rename('foo', 'bar')
		await expect(op).rejects.toThrow(fs.ErrDirectoryNotEmpty)
	})
	test('remove a regular file', async () => {
		const fsys = await make()

		const data = [0x12, 0x34]
		await using([fsys.create('foo')], f => f.write(io.from(data)))

		await fsys.remove('foo')
		await expect(() => fsys.stat('foo')).rejects.toThrow(fs.ErrNotExist)
	})
	test('remove an empty directory', async () => {
		const fsys = await make()

		await fsys.mkdir('foo')

		await fsys.remove('foo')
		await expect(() => fsys.stat('foo')).rejects.toThrow(fs.ErrNotExist)
	})
	test('remove a non-empty directory', async () => {
		const fsys = await make()

		await fsys.mkdirAll('foo/bar')

		const op = () => fsys.remove('foo')
		await expect(op).rejects.toThrow(fs.ErrDirectoryNotEmpty)
	})
	test('remove a file that does not exist', async () => {
		const fsys = await make()

		const op = () => fsys.remove('not-exists')
		await expect(op).rejects.toThrow(fs.ErrNotExist)
	})
})
